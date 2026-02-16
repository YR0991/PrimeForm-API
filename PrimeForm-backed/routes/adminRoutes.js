/**
 * Admin API routes — mounted at /api/admin
 * Protected: verifyIdToken + requireUser + requireRole('admin'). No legacy x-admin-email; break-glass in requireRole.
 * Requires: db, admin, openai, knowledgeBaseContent, reportService, stravaService, FieldValue (injected via factory).
 */

const express = require('express');
const { verifyIdToken, requireUser, requireRole, requireAnyRole, requireCoachTeamMatch } = require('../middleware/auth');
const { normalizeCycleData, getProfileCompleteReasons } = require('../lib/profileValidation');
const crypto = require('crypto');
const debugHistoryService = require('../services/debugHistoryService');
const dailyBriefService = require('../services/dailyBriefService');
const { addDays } = require('../lib/activityDate');
const { markLoadMetricsStale, clearLoadMetricsStale } = require('../lib/metricsMeta');
const { computeFromActivities } = require('../lib/liveLoadMetricsCompute');
const logger = require('../lib/logger');

/**
 * @param {object} deps - { db, admin, openai, knowledgeBaseContent, reportService, stravaService, FieldValue }
 * @returns {express.Router}
 */
function createAdminRouter(deps) {
  const { db, admin, openai, knowledgeBaseContent, reportService: report, stravaService: strava, FieldValue } = deps;
  const router = express.Router();

  router.use(verifyIdToken(admin), requireUser());

  // Coach-accessible routes (admin or coach; coach limited to same team). Must be before requireRole('admin').
  const coachOrAdmin = [requireAnyRole(['admin', 'coach']), requireCoachTeamMatch(db)];

  router.get('/users/:uid/strava-status', ...coachOrAdmin, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const userSnap = await db.collection('users').doc(String(uid)).get();
      if (!userSnap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const data = userSnap.data() || {};
      const strava = data.strava || {};
      const stravaSync = data.stravaSync || {};
      const toIso = (v) => {
        if (v == null) return null;
        if (typeof v.toDate === 'function') return v.toDate().toISOString();
        if (typeof v === 'string') return v;
        if (v instanceof Date) return v.toISOString();
        return null;
      };
      return res.json({
        connected: !!strava.connected,
        connectedAt: toIso(strava.connectedAt),
        scope: strava.scope ?? null,
        lastSuccessAt: toIso(stravaSync.lastSuccessAt),
        lastError: stravaSync.lastError ?? null,
        lastAttemptAt: toIso(stravaSync.lastAttemptAt),
        newestStoredActivityDate: stravaSync.newestStoredActivityDate ?? null,
        fetched: stravaSync.fetched ?? null,
        inserted: stravaSync.inserted ?? null,
        skipped: stravaSync.skipped ?? null
      });
    } catch (err) {
      logger.error('GET /api/admin/users/:uid/strava-status error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/users/:uid/live-load-metrics', ...coachOrAdmin, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const windowDays = Math.min(56, Math.max(28, parseInt(req.query.days, 10) || 28));
      const todayStr = new Date().toISOString().slice(0, 10);
      const startDate = addDays(todayStr, -windowDays + 1);
      const endDate = todayStr;

      const userSnap = await db.collection('users').doc(String(uid)).get();
      if (!userSnap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const userData = userSnap.data() || {};
      const profile = userData.profile || {};

      const activities = await dailyBriefService.getActivitiesInRange(db, uid, startDate, endDate, profile, admin);
      const timezone = profile?.timezone || profile?.timeZone || 'Europe/Amsterdam';
      const computed = computeFromActivities(activities, { todayStr, windowDays, timezone });

      await clearLoadMetricsStale(db, admin, uid, { windowDays });

      return res.json({
        success: true,
        uid: String(uid),
        windowDays,
        sum7: computed.sum7,
        sum28: computed.sum28,
        chronicRounded: computed.chronicRounded,
        acwr: computed.acwr,
        acwrBand: computed.acwrBand,
        contributors7d: computed.contributors7d,
        acute: computed.acute,
        chronic: { sum28: computed.chronic.sum28, weeklyAvg28: computed.chronic.weeklyAvg28, count28: computed.chronic.count28 },
        counts: computed.counts,
        debug: { ...computed.debug, timezoneUsed: timezone }
      });
    } catch (err) {
      logger.error('GET /api/admin/users/:uid/live-load-metrics error', { errMessage: err.message, errStack: err.stack });
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.use(requireRole('admin'));

  // POST /api/admin/strava/sync/:uid — sync last 30 days of Strava activities (admin only)
  router.post('/strava/sync/:uid', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const days = req.body?.days != null ? Math.min(90, Math.max(1, Number(req.body.days))) : 30;
      const result = await strava.syncRecentActivities(uid, db, admin, { days });
      await markLoadMetricsStale(db, admin, uid, 'STRAVA_SYNC');
      return res.json({ success: true, data: { count: result.count } });
    } catch (err) {
      logger.error('Admin Strava sync error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/import-history — batch import historical dailyLogs
  router.post('/import-history', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized'
        });
      }

      const { userId, entries } = req.body;

      if (!userId || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing userId or entries array'
        });
      }

      const batch = db.batch();
      const userLogsRef = db.collection('users').doc(String(userId)).collection('dailyLogs');

      let imported = 0;
      for (const entry of entries) {
        const { date, hrv, rhr } = entry;

        if (!date || hrv === undefined || rhr === undefined) {
          continue;
        }

        const entryDate = new Date(date + 'T00:00:00');
        const formattedDate = date;

        const docRef = userLogsRef.doc();
        batch.set(docRef, {
          timestamp: admin.firestore.Timestamp.fromDate(entryDate),
          date: formattedDate,
          userId: String(userId),
          source: 'import',
          metrics: {
            hrv: Number(hrv),
            rhr: { current: Number(rhr) },
            readiness: null,
            sleep: null
          },
          cycleInfo: null,
          recommendation: null,
          aiMessage: null,
          imported: true,
          importedAt: FieldValue.serverTimestamp()
        });

        imported++;
      }

      await batch.commit();

      logger.info('Batch import done', { imported });

      res.json({
        success: true,
        data: {
          imported,
          total: entries.length
        }
      });
    } catch (error) {
      logger.error('FIRESTORE FOUT', error);
      res.status(500).json({
        success: false,
        error: 'Failed to import history',
        message: error.message
      });
    }
  });

  // POST /api/admin/users/:uid/import-baseline — HRV/RHR baseline import (admin/coach only). Does not drive today decision.
  router.post('/users/:uid/import-baseline', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const { kind, entries, overwrite = false } = req.body || {};
      if (kind !== 'HRV_RHR' || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Body must include kind: "HRV_RHR" and non-empty entries array'
        });
      }
      const userLogsRef = db.collection('users').doc(String(uid)).collection('dailyLogs');
      let importedCount = 0;
      let skippedCount = 0;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      for (const entry of entries) {
        const { date, hrv, rhr } = entry;
        if (!date || !dateRegex.test(String(date).slice(0, 10))) {
          skippedCount++;
          continue;
        }
        const dateStr = String(date).slice(0, 10);
        const hrvNum = hrv != null && Number.isFinite(Number(hrv)) ? Number(hrv) : null;
        const rhrNum = rhr != null && Number.isFinite(Number(rhr)) ? Number(rhr) : null;
        if (hrvNum == null && rhrNum == null) {
          skippedCount++;
          continue;
        }
        const existingSnap = await userLogsRef.where('date', '==', dateStr).get();
        const hasCheckin = existingSnap.docs.some((doc) => (doc.data() || {}).source === 'checkin');
        if (hasCheckin) {
          skippedCount++;
          continue;
        }
        const existingImport = existingSnap.docs.find((doc) => (doc.data() || {}).source === 'import' || (doc.data() || {}).imported === true);
        if (existingImport && !overwrite) {
          skippedCount++;
          continue;
        }
        const docData = {
          timestamp: admin.firestore.Timestamp.fromDate(new Date(dateStr + 'T12:00:00Z')),
          date: dateStr,
          userId: String(uid),
          source: 'import',
          imported: true,
          metrics: {
            hrv: hrvNum,
            rhr: rhrNum != null ? { current: rhrNum } : null,
            readiness: null,
            sleep: null
          },
          cycleInfo: null,
          recommendation: null,
          aiMessage: null
        };
        if (existingImport && overwrite) {
          await existingImport.ref.set(docData, { merge: true });
        } else {
          await userLogsRef.add(docData);
        }
        importedCount++;
      }
      return res.json({
        success: true,
        importedCount,
        skippedCount
      });
    } catch (err) {
      logger.error('POST /api/admin/users/:uid/import-baseline error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/admin/users/:uid/import-coverage?days=56
  router.get('/users/:uid/import-coverage', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 56));
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startStr = startDate.toISOString().slice(0, 10);
      const endStr = endDate.toISOString().slice(0, 10);
      const snap = await db
        .collection('users')
        .doc(String(uid))
        .collection('dailyLogs')
        .where('date', '>=', startStr)
        .where('date', '<=', endStr)
        .get();
      const byDate = new Map();
      let lastImportedAt = null;
      snap.docs.forEach((doc) => {
        const d = doc.data() || {};
        const date = (d.date || '').slice(0, 10);
        if (!date) return;
        const source = d.source || (d.imported === true ? 'import' : null);
        const isCheckin = source === 'checkin';
        const isImport = source === 'import' || d.imported === true;
        if (!byDate.has(date)) byDate.set(date, { checkin: false, import: false });
        const row = byDate.get(date);
        if (isCheckin) row.checkin = true;
        if (isImport) {
          row.import = true;
          const ts = d.timestamp && typeof d.timestamp.toDate === 'function' ? d.timestamp.toDate() : null;
          if (ts && (!lastImportedAt || ts > lastImportedAt)) lastImportedAt = ts;
        }
      });
      let importedDaysCount = 0;
      let checkinDaysCount = 0;
      for (const row of byDate.values()) {
        if (row.import) importedDaysCount++;
        if (row.checkin) checkinDaysCount++;
      }
      const totalDays = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1;
      const missingDaysCount = totalDays - byDate.size;
      return res.json({
        days,
        importedDaysCount,
        checkinDaysCount,
        missingDaysCount,
        lastImportedAt: lastImportedAt ? lastImportedAt.toISOString() : null
      });
    } catch (err) {
      logger.error('GET /api/admin/users/:uid/import-coverage error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/admin/users/:uid/debug-history?days=28 — debug timeline (last X days) for coach/admin
  router.get('/users/:uid/debug-history', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const allowed = [7, 14, 28, 56];
      let days = parseInt(req.query.days, 10);
      if (!Number.isFinite(days) || !allowed.includes(days)) days = 28;
      if (days > 56) days = 56;

      const { profile, days: timeline } = await debugHistoryService.getDebugHistory({ db, admin, uid, days });
      return res.json({
        success: true,
        data: { profile: profile || null, days: timeline }
      });
    } catch (err) {
      logger.error('GET /api/admin/users/:uid/debug-history error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/admin/users/:uid/activities/:id — admin delete activity; activity must belong to uid
  router.delete('/users/:uid/activities/:id', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      const id = (req.params.id || '').trim();
      if (!uid || !id) {
        return res.status(400).json({ success: false, error: 'Missing uid or activity id' });
      }
      const docRef = db.collection('activities').doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const data = snap.data() || {};
      if (data.userId !== uid) {
        return res.status(409).json({
          success: false,
          error: 'MISMATCH',
          message: 'Activity userId does not match route uid'
        });
      }
      await docRef.delete();
      await markLoadMetricsStale(db, admin, uid, 'ADMIN_DELETE');
      return res.json({ success: true });
    } catch (err) {
      logger.error('DELETE /api/admin/users/:uid/activities/:id error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/users/:uid/strava/sync-now — admin force sync. Body: { afterDays?: number, afterTimestamp?: number }. Cold start 90d if no stored activities.
  const toIsoStrava = (v) => {
    if (v == null) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (typeof v === 'string') return v;
    if (v instanceof Date) return v.toISOString();
    return null;
  };

  router.post('/users/:uid/strava/sync-now', async (req, res) => {
    const uid = req.params.uid;
    const nowIso = () => new Date().toISOString();
    const debugPayload = (overrides = {}) => ({
      success: false,
      error: overrides.error,
      uidUsed: uid,
      now: nowIso(),
      scopeStored: overrides.scopeStored ?? null,
      connectedAtStored: overrides.connectedAtStored ?? null,
      afterTimestampUsed: overrides.afterTimestampUsed ?? null,
      afterStrategy: overrides.afterStrategy ?? null,
      stravaResponseMeta: overrides.stravaResponseMeta ?? null,
      ...overrides
    });

    try {
      if (!db) {
        return res.status(503).json(debugPayload({ error: 'Firestore is not initialized' }));
      }
      if (!uid) {
        return res.status(400).json(debugPayload({ error: 'Missing uid' }));
      }
      const userRef = db.collection('users').doc(String(uid));
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        return res.status(404).json(debugPayload({ error: 'User not found' }));
      }
      const userData = userSnap.data() || {};
      if (!userData.strava?.connected || !userData.strava?.refreshToken) {
        return res.status(400).json(
          debugPayload({
            error: 'Strava not connected',
            scopeStored: userData.strava?.scope ?? null,
            connectedAtStored: toIsoStrava(userData.strava?.connectedAt)
          })
        );
      }

      const body = req.body || {};
      const now = Date.now();
      const newestStoredActivityDate = userData.stravaSync?.newestStoredActivityDate ?? null;
      let afterTimestamp = null;
      let afterStrategy = 'explicit';

      if (body.afterTimestamp != null && Number.isFinite(Number(body.afterTimestamp))) {
        afterTimestamp = Number(body.afterTimestamp);
        afterStrategy = 'explicit';
      } else if (newestStoredActivityDate == null) {
        const afterDays = Math.min(365, Math.max(1, Number(body.afterDays) || 90));
        afterTimestamp = now - afterDays * 24 * 60 * 60 * 1000;
        afterStrategy = afterDays === 90 ? 'cold_start_90d' : `cold_start_${afterDays}d`;
      } else {
        const parsed = new Date(newestStoredActivityDate).getTime();
        if (Number.isFinite(parsed)) {
          afterTimestamp = parsed - 24 * 60 * 60 * 1000;
          afterStrategy = 'incremental_newestStored';
        } else {
          const afterDays = Math.min(365, Math.max(1, Number(body.afterDays) || 90));
          afterTimestamp = now - afterDays * 24 * 60 * 60 * 1000;
          afterStrategy = afterDays === 90 ? 'cold_start_90d' : `cold_start_${afterDays}d`;
        }
      }

      const result = await strava.syncActivitiesAfter(uid, db, admin, { afterTimestamp });

      let newestStoredActivityDateAfter = null;
      const activitiesRef = userRef.collection('activities');
      const latestSnap = await activitiesRef.orderBy('start_date', 'desc').limit(1).get();
      if (!latestSnap.empty) {
        const d = latestSnap.docs[0].data();
        const sd = d.start_date;
        if (sd && typeof sd.toDate === 'function') newestStoredActivityDateAfter = sd.toDate().toISOString();
        else if (typeof sd === 'string') newestStoredActivityDateAfter = sd;
        else if (sd instanceof Date) newestStoredActivityDateAfter = sd.toISOString();
      }

      await userRef.set(
        {
          lastSyncNowAt: admin.firestore.FieldValue.serverTimestamp(),
          stravaSync: {
            lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: admin.firestore.FieldValue.delete(),
            fetched: result.fetched,
            inserted: result.inserted,
            skipped: result.skipped,
            newestStravaStartDate: result.newestStravaActivityStartDate,
            newestStoredActivityDate: newestStoredActivityDateAfter
          }
        },
        { merge: true }
      );
      await markLoadMetricsStale(db, admin, uid, 'STRAVA_SYNC');

      return res.json({
        success: true,
        fetched: result.fetched,
        inserted: result.inserted,
        skipped: result.skipped,
        newestStravaActivityStartDate: result.newestStravaActivityStartDate,
        newestStoredActivityDate: newestStoredActivityDateAfter,
        wroteToPath: `users/${uid}/activities`,
        uidUsed: uid,
        now: nowIso(),
        scopeStored: userData.strava?.scope ?? null,
        connectedAtStored: toIsoStrava(userData.strava?.connectedAt) ?? null,
        afterTimestampUsed: afterTimestamp != null ? new Date(afterTimestamp).toISOString() : null,
        afterStrategy,
        stravaResponseMeta: result.stravaResponseMeta ?? null
      });
    } catch (err) {
      logger.error('POST /api/admin/users/:uid/strava/sync-now error', {
        errMessage: err.message,
        errStack: err.stack
      });
      try {
        const userRef = db.collection('users').doc(String(uid));
        await userRef.set(
          {
            stravaSync: {
              lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
              lastError: err.message || 'Sync failed'
            }
          },
          { merge: true }
        );
      } catch (e) {
        /* ignore */
      }
      const status = err.message && err.message.includes('backoff') ? 429 : 500;
      let userData = null;
      try {
        const snap = await db.collection('users').doc(String(uid)).get();
        userData = snap.exists ? snap.data() : null;
      } catch (e) {
        /* ignore */
      }
      const payload = debugPayload({
        error: status === 500 ? 'InternalError' : err.message,
        message: err.message,
        scopeStored: userData?.strava?.scope ?? null,
        connectedAtStored: userData?.strava?.connectedAt != null ? toIsoStrava(userData.strava.connectedAt) : null,
        stravaResponseMeta: err.stravaResponseMeta ?? null
      });
      return res.status(status).json(payload);
    }
  });

  // GET /api/admin/users/:uid/history — fetch daily logs for a user (admin only)
  router.get('/users/:uid/history', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized'
        });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const snapshot = await db
        .collection('users')
        .doc(String(uid))
        .collection('dailyLogs')
        .orderBy('timestamp', 'desc')
        .limit(28)
        .get();
      const docs = snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        const ts = data.timestamp;
        let timestamp = ts;
        if (ts && typeof ts.toDate === 'function') {
          timestamp = ts.toDate().toISOString();
        } else if (ts instanceof Date) {
          timestamp = ts.toISOString();
        }
        return { id: doc.id, ...data, timestamp };
      });
      res.json({ success: true, data: docs });
    } catch (error) {
      logger.error('GET /api/admin/users/:uid/history', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch history',
        message: error.message
      });
    }
  });

  // POST /api/admin/users/:uid/history — inject historical HRV/RHR (Cold Start / Telemetry Injector)
  router.post('/users/:uid/history', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized'
        });
      }
      const uid = req.params.uid;
      const { entries } = req.body || {};
      if (!uid || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing uid or entries array'
        });
      }
      const userLogsRef = db.collection('users').doc(String(uid)).collection('dailyLogs');
      const BATCH_SIZE = 400;
      let count = 0;
      const validEntries = [];
      for (const entry of entries) {
        const { date, hrv, rhr } = entry;
        if (!date || typeof date !== 'string' || hrv === undefined || rhr === undefined) continue;
        const dateStr = date.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        const entryDate = new Date(dateStr + 'T00:00:00');
        if (isNaN(entryDate.getTime())) continue;
        validEntries.push({ dateStr, entryDate, hrv: Number(hrv), rhr: Number(rhr) });
      }
      for (let i = 0; i < validEntries.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = validEntries.slice(i, i + BATCH_SIZE);
        for (const { dateStr, entryDate, hrv, rhr } of chunk) {
          const docRef = userLogsRef.doc(dateStr);
          batch.set(docRef, {
            date: dateStr,
            timestamp: admin.firestore.Timestamp.fromDate(entryDate),
            userId: String(uid),
            metrics: {
              hrv,
              rhr: { current: rhr },
              readiness: 7,
              sleep: 8
            },
            cycleInfo: null,
            recommendation: null,
            aiMessage: null,
            imported: true,
            importedAt: FieldValue.serverTimestamp()
          });
          count++;
        }
        await batch.commit();
      }
      logger.info('Telemetry inject done', { count });
      res.json({
        success: true,
        data: { injected: count, total: entries.length }
      });
    } catch (error) {
      logger.error('POST /users/:uid/history', error);
      res.status(500).json({
        success: false,
        error: 'Failed to inject history',
        message: error.message
      });
    }
  });

  // GET /api/admin/users — list all users with physiology (acwr, directive) for MASTER LIJST status dots
  router.get('/users', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized',
          code: 'FIRESTORE_NOT_READY'
        });
      }

      const usersSnapshot = await db.collection('users').get();
      const users = usersSnapshot.docs.map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          userId: doc.id,
          profile: data.profile || null,
          profileComplete: data.profileComplete || false,
          role: data.role ?? null,
          teamId: data.teamId ?? null,
          email: data.email ?? (data.profile && data.profile.email) ?? null,
          adminNotes: data.adminNotes ?? null,
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null
        };
      });

      // Enrich each user with acwr + directive (Belastingsbalans) for status dots
      const enriched = await Promise.all(
        users.map(async (u) => {
          try {
            const stats = await report.getDashboardStats({ db, admin, uid: u.id });
            const acwr = stats?.acwr != null && Number.isFinite(stats.acwr) ? stats.acwr : null;
            const directive =
              acwr != null
                ? (acwr > 1.5 ? 'REST' : acwr > 1.3 ? 'RECOVER' : acwr >= 0.8 && acwr <= 1.3 ? 'PUSH' : 'MAINTAIN')
                : null;
            return { ...u, acwr, directive };
          } catch (e) {
            return { ...u, acwr: null, directive: null };
          }
        })
      );

      res.json({ success: true, data: enriched });
    } catch (error) {
      logger.error('GET /api/admin/users', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch users',
        message: error.message
      });
    }
  });

  // PATCH /api/admin/users/:id — assign teamId (and optionally role) for coach assignment / stale data fix
  router.patch('/users/:id', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.id;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing user id' });
      }
      const { teamId, role } = req.body || {};
      const userRef = db.collection('users').doc(String(uid));
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (teamId !== undefined) updates.teamId = teamId === null || teamId === '' ? null : String(teamId);
      if (role !== undefined) updates.role = role === null || role === '' ? null : String(role);
      await userRef.set(updates, { merge: true });
      const data = snap.data() || {};
      return res.json({
        success: true,
        data: {
          id: uid,
          teamId: updates.teamId !== undefined ? updates.teamId : data.teamId ?? null,
          role: updates.role !== undefined ? updates.role : data.role ?? null
        }
      });
    } catch (error) {
      logger.error('PATCH /api/admin/users/:id', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/admin/users/:uid/recompute-profile-complete — set onboardingComplete/profileComplete from canonical isProfileComplete (legacy fix)
  router.post('/users/:uid/recompute-profile-complete', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = (req.params.uid || '').trim();
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const userRef = db.collection('users').doc(String(uid));
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const data = snap.data() || {};
      const email = data.email || (data.profile && data.profile.email) || null;
      const profileForComplete = { ...(data.profile || {}), email: (data.profile && data.profile.email) || email };
      const { complete, reasons } = getProfileCompleteReasons(profileForComplete);
      await userRef.set(
        { profileComplete: complete, onboardingComplete: complete, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      logger.info('Profile complete recomputed', {
        uidHash: uid ? crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 8) : null,
        profileComplete: complete,
        reasonsCount: reasons.length
      });
      return res.json({
        success: true,
        uid,
        profileComplete: complete,
        profileCompleteReasons: reasons.length ? reasons : ['complete']
      });
    } catch (err) {
      logger.error('POST /api/admin/users/:uid/recompute-profile-complete error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/admin/users/:uid — Auth record + Firestore (user doc, dailyLogs, activities)
  async function deleteSubcollection(userRef, subcollectionName, batchSize = 500) {
    const colRef = userRef.collection(subcollectionName);
    let deleted = 0;
    let snapshot = await colRef.limit(batchSize).get();
    while (!snapshot.empty) {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snapshot.size;
      snapshot = await colRef.limit(batchSize).get();
    }
    return deleted;
  }

  router.delete('/users/:uid', async (req, res) => {
    try {
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing user id' });
      }
      const confirm = req.body && req.body.confirm === true;
      if (!confirm) {
        return res.status(400).json({
          success: false,
          error: 'Nuclear delete requires confirmation. Send body: { "confirm": true }'
        });
      }

      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized'
        });
      }

      const actorUid = req.user && req.user.uid ? req.user.uid : null;
      await db.collection('admin_audit_log').add({
        action: 'user_delete',
        targetUid: uid,
        actorUid,
        at: FieldValue.serverTimestamp()
      });

      if (admin.apps.length > 0) {
        try {
          await admin.auth().deleteUser(uid);
        } catch (authErr) {
          if (authErr.code !== 'auth/user-not-found') {
            logger.warn('Auth deleteUser failed (non-fatal)', { code: authErr.code });
          }
        }
      }

      const userRef = db.collection('users').doc(String(uid));
      await deleteSubcollection(userRef, 'dailyLogs');
      await deleteSubcollection(userRef, 'activities');
      await userRef.delete();

      let rootDailyLogsDeleted = 0;
      let rootSnap = await db.collection('daily_logs').where('userId', '==', uid).limit(500).get();
      while (!rootSnap.empty) {
        const batch = db.batch();
        rootSnap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        rootDailyLogsDeleted += rootSnap.size;
        rootSnap = await db.collection('daily_logs').where('userId', '==', uid).limit(500).get();
      }

      res.json({
        success: true,
        data: { deleted: uid, rootDailyLogsDeleted }
      });
    } catch (error) {
      logger.error('Admin delete user failed', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete user',
        message: error.message
      });
    }
  });

  // GET /api/admin/stats
  router.get('/stats', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized',
          code: 'FIRESTORE_NOT_READY'
        });
      }

      const now = new Date();

      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const usersWeekSnapshot = await db
        .collection('users')
        .where('createdAt', '>=', weekAgo)
        .get();

      const newThisWeek = usersWeekSnapshot.size;

      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 1);

      const startTs = admin.firestore.Timestamp.fromDate(startOfDay);
      const endTs = admin.firestore.Timestamp.fromDate(endOfDay);

      const logsSnapshot = await db
        .collectionGroup('dailyLogs')
        .where('timestamp', '>=', startTs)
        .where('timestamp', '<', endTs)
        .get();

      const checkinsToday = logsSnapshot.size;

      return res.json({
        success: true,
        data: {
          newThisWeek,
          checkinsToday
        }
      });
    } catch (error) {
      logger.error('FIRESTORE FOUT (admin stats)', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch admin stats',
        message: error.message
      });
    }
  });

  // PUT /api/admin/profile-patch
  router.put('/profile-patch', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const { userId, profilePatch } = req.body || {};
      if (!userId || !profilePatch || typeof profilePatch !== 'object') {
        return res.status(400).json({ success: false, error: 'Missing userId or profilePatch' });
      }
      const userRef = db.collection('users').doc(String(userId));
      const snap = await userRef.get();
      const existing = snap.exists ? snap.data() : {};
      const existingProfile = existing.profile || {};

      // Extract special fields that should also live at the root level
      const {
        role: rolePatch,
        onboardingCompleted,
        onboardingComplete,
        ...restProfilePatch
      } = profilePatch;

      const mergedProfile = { ...existingProfile, ...restProfilePatch };
      if (existingProfile.cycleData || restProfilePatch.cycleData) {
        mergedProfile.cycleData = normalizeCycleData({
          ...(existingProfile.cycleData || {}),
          ...(restProfilePatch.cycleData || {})
        });
      }

      const updatePayload = {
        profile: mergedProfile,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (rolePatch != null) {
        updatePayload.role = String(rolePatch);
      }

      const onboardingFlag =
        onboardingCompleted != null ? onboardingCompleted : onboardingComplete;
      if (onboardingFlag != null) {
        updatePayload.onboardingComplete = !!onboardingFlag;
      }

      await userRef.set(updatePayload, { merge: true });

      res.json({
        success: true,
        data: {
          userId,
          profile: mergedProfile,
          role: updatePayload.role ?? existing.role ?? null,
          onboardingComplete:
            updatePayload.onboardingComplete ?? existing.onboardingComplete ?? false
        }
      });
    } catch (error) {
      logger.error('admin profile-patch', error);
      res.status(500).json({ success: false, error: 'Failed to update profile', message: error.message });
    }
  });

  // PUT /api/admin/user-notes
  router.put('/user-notes', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const { userId, adminNotes } = req.body || {};
      if (!userId) {
        return res.status(400).json({ success: false, error: 'Missing userId' });
      }
      const userRef = db.collection('users').doc(String(userId));
      await userRef.set({ adminNotes: adminNotes ?? '' }, { merge: true });
      res.json({ success: true, data: { userId, adminNotes: adminNotes ?? '' } });
    } catch (error) {
      logger.error('admin user-notes', error);
      res.status(500).json({ success: false, error: 'Failed to save notes', message: error.message });
    }
  });

  // PUT /api/admin/check-in
  router.put('/check-in', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const { userId, logId, patch } = req.body || {};
      if (!userId || !logId || !patch || typeof patch !== 'object') {
        return res.status(400).json({ success: false, error: 'Missing userId, logId, or patch' });
      }
      const logRef = db.collection('users').doc(String(userId)).collection('dailyLogs').doc(String(logId));
      const snap = await logRef.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'Check-in not found' });
      }
      const data = snap.data() || {};
      const metrics = { ...(data.metrics || {}) };
      if (patch.hrv !== undefined) metrics.hrv = Number(patch.hrv);
      if (patch.rhr !== undefined) metrics.rhr = typeof patch.rhr === 'object' ? { ...metrics.rhr, current: Number(patch.rhr) } : { current: Number(patch.rhr) };
      if (patch.sleep !== undefined) metrics.sleep = Number(patch.sleep);
      const redFlags = patch.redFlags !== undefined ? patch.redFlags : data.redFlags;
      const update = { metrics, redFlags, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      await logRef.update(update);
      res.json({ success: true, data: { userId, logId } });
    } catch (error) {
      logger.error('admin check-in update', error);
      res.status(500).json({ success: false, error: 'Failed to update check-in', message: error.message });
    }
  });

  // GET /api/admin/alerts
  router.get('/alerts', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 1);

      const startTs = admin.firestore.Timestamp.fromDate(startOfDay);
      const endTs = admin.firestore.Timestamp.fromDate(endOfDay);

      const usersSnap = await db.collection('users').get();
      const missed = [];
      const critical = [];

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data() || {};
        const profile = userData.profile || {};
        const fullName = profile.fullName || 'Geen naam';
        const userId = userDoc.id;

        const lastLogSnap = await db.collection('users').doc(userId).collection('dailyLogs').orderBy('timestamp', 'desc').limit(1).get();
        let lastCheckinAt = null;
        if (!lastLogSnap.empty) {
          const ts = lastLogSnap.docs[0].data().timestamp;
          if (ts && typeof ts.toDate === 'function') lastCheckinAt = ts.toDate().toISOString();
        }
        if (!lastCheckinAt || new Date(lastCheckinAt) < threeDaysAgo) {
          missed.push({ userId, fullName, lastCheckinAt });
        }

        const todayLogSnap = await db.collection('users').doc(userId).collection('dailyLogs').where('timestamp', '>=', startTs).where('timestamp', '<', endTs).limit(1).get();
        if (!todayLogSnap.empty) {
          const rec = todayLogSnap.docs[0].data().recommendation || {};
          const status = (rec.status || '').toUpperCase();
          if (status === 'REST' || status === 'RECOVER') {
            critical.push({ userId, fullName, status });
          }
        }
      }

      res.json({ success: true, data: { missed, critical } });
    } catch (error) {
      logger.error('FIRESTORE FOUT (admin alerts)', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch admin alerts',
        message: error.message
      });
    }
  });

  // GET /api/admin/teams
  router.get('/teams', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const snap = await db.collection('teams').get();
      const teams = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return res.json({ success: true, data: teams });
    } catch (error) {
      logger.error('GET /api/admin/teams', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/admin/teams — create team (name, coachEmail, memberLimit); backend generates inviteCode
  router.post('/teams', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const { name, coachEmail, memberLimit } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Team name is required' });
      }
      const segment = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      const inviteCode = `TEAM-${segment}`;
      const docData = {
        name: name.trim(),
        coachEmail: coachEmail != null && String(coachEmail).trim() ? String(coachEmail).trim().toLowerCase() : null,
        memberLimit: typeof memberLimit === 'number' && Number.isFinite(memberLimit) ? memberLimit : null,
        inviteCode,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const docRef = await db.collection('teams').add(docData);
      const out = { id: docRef.id, ...docData, createdAt: new Date() };
      return res.status(201).json({ success: true, data: out });
    } catch (error) {
      logger.error('POST /api/admin/teams', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // PATCH /api/admin/teams/:id — rename team
  router.patch('/teams/:id', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const teamId = req.params.id;
      const { name } = req.body || {};
      if (!teamId) return res.status(400).json({ success: false, error: 'Missing team id' });
      const nameTrim = name != null && typeof name === 'string' ? name.trim() : '';
      if (!nameTrim) return res.status(400).json({ success: false, error: 'Name is required' });
      const teamRef = db.collection('teams').doc(String(teamId));
      const snap = await teamRef.get();
      if (!snap.exists) return res.status(404).json({ success: false, error: 'Team not found' });
      await teamRef.set({ name: nameTrim, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return res.json({ success: true, data: { id: teamId, name: nameTrim } });
    } catch (error) {
      logger.error('PATCH /api/admin/teams/:id', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // DELETE /api/admin/teams/:id — delete team and orphan users (set teamId = null)
  router.delete('/teams/:id', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const teamId = req.params.id;
      if (!teamId) return res.status(400).json({ success: false, error: 'Missing team id' });
      const teamRef = db.collection('teams').doc(String(teamId));
      const snap = await teamRef.get();
      if (!snap.exists) return res.status(404).json({ success: false, error: 'Team not found' });
      const usersSnap = await db.collection('users').where('teamId', '==', teamId).get();
      const batch = db.batch();
      usersSnap.docs.forEach((doc) => batch.update(doc.ref, { teamId: null }));
      batch.delete(teamRef);
      await batch.commit();
      return res.json({ success: true, data: { deleted: teamId } });
    } catch (error) {
      logger.error('DELETE /api/admin/teams/:id', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/admin/reports/weekly/:uid?endDate=YYYY-MM-DD — report end date (default: today). Timezone from profile.
  router.get('/reports/weekly/:uid', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const endDate = req.query.endDate;
      const todayStr = endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(endDate).trim()) ? String(endDate).trim().slice(0, 10) : undefined;
      const result = await report.generateWeeklyReport({
        db,
        admin,
        openai,
        knowledgeBaseContent,
        uid,
        todayStr
      });
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Weekly report error', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate weekly report',
        message: error.message
      });
    }
  });

  // POST /api/admin/migrate-data — migrate logs and activities from one user to another
  router.post('/migrate-data', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }

      const { sourceUid, targetUid } = req.body || {};
      const sourceId = sourceUid != null ? String(sourceUid).trim() : '';
      const targetId = targetUid != null ? String(targetUid).trim() : '';

      if (!sourceId || !targetId) {
        return res.status(400).json({ success: false, error: 'sourceUid and targetUid are required' });
      }
      if (sourceId === targetId) {
        return res.status(400).json({ success: false, error: 'sourceUid and targetUid must be different' });
      }

      const sourceUserRef = db.collection('users').doc(sourceId);
      const targetUserRef = db.collection('users').doc(targetId);

      const [sourceSnap, targetSnap] = await Promise.all([sourceUserRef.get(), targetUserRef.get()]);

      if (!sourceSnap.exists) {
        return res.status(404).json({ success: false, error: 'Source user not found' });
      }
      if (!targetSnap.exists) {
        return res.status(404).json({ success: false, error: 'Target user not found' });
      }

      const [rootLogsSnap, rootActivitiesSnap, subLogsSnap, subActivitiesSnap] = await Promise.all([
        db.collection('daily_logs').where('userId', '==', sourceId).get(),
        db.collection('activities').where('userId', '==', sourceId).get(),
        sourceUserRef.collection('dailyLogs').get(),
        sourceUserRef.collection('activities').get()
      ]);

      const MAX_BATCH_WRITES = 400;
      let batch = db.batch();
      let writes = 0;
      const commitPromises = [];

      function commitBatchIfNeeded() {
        if (writes >= MAX_BATCH_WRITES) {
          commitPromises.push(batch.commit());
          batch = db.batch();
          writes = 0;
        }
      }

      function enqueueUpdate(ref, data) {
        commitBatchIfNeeded();
        batch.update(ref, data);
        writes++;
      }

      function enqueueSet(ref, data) {
        commitBatchIfNeeded();
        batch.set(ref, data, { merge: true });
        writes++;
      }

      function enqueueDelete(ref) {
        commitBatchIfNeeded();
        batch.delete(ref);
        writes++;
      }

      // 1) Root daily_logs (legacy) — reassign userId to target
      rootLogsSnap.docs.forEach((doc) => {
        enqueueUpdate(doc.ref, { userId: targetId });
      });

      // 2) Root activities collection (if used) — reassign userId to target
      rootActivitiesSnap.docs.forEach((doc) => {
        enqueueUpdate(doc.ref, { userId: targetId });
      });

      // 3) Subcollection dailyLogs: move documents from source to target and update userId
      subLogsSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const newData = { ...data, userId: targetId };
        const targetRef = targetUserRef.collection('dailyLogs').doc(doc.id);
        enqueueSet(targetRef, newData);
        enqueueDelete(doc.ref);
      });

      // 4) Subcollection activities: move documents from source to target
      subActivitiesSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const targetRef = targetUserRef.collection('activities').doc(doc.id);
        enqueueSet(targetRef, data);
        enqueueDelete(doc.ref);
      });

      if (writes > 0) {
        commitPromises.push(batch.commit());
      }

      await Promise.all(commitPromises);

      const logsMoved = rootLogsSnap.size + subLogsSnap.size;
      const activitiesMoved = rootActivitiesSnap.size + subActivitiesSnap.size;

      logger.info('Admin migrate-data done', { logsMoved, activitiesMoved });

      return res.json({
        success: true,
        data: {
          logsMoved,
          activitiesMoved
        }
      });
    } catch (error) {
      logger.error('Admin migrate-data error', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to migrate user data',
        message: error.message
      });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
