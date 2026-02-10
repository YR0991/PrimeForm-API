/**
 * Admin API routes — mounted at /api/admin
 * Requires: db, admin, openai, knowledgeBaseContent, reportService, stravaService, FieldValue (injected via factory).
 */

const express = require('express');

const ADMIN_EMAIL = 'yoramroemersma50@gmail.com';

/**
 * Middleware: require admin email (x-admin-email header, query.adminEmail, or body.adminEmail).
 */
function checkAdminAuth(req, res, next) {
  const adminEmail = (
    req.headers['x-admin-email'] ||
    req.query.adminEmail ||
    (req.body && req.body.adminEmail) ||
    ''
  ).trim();
  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized: Admin access required',
      code: 'ADMIN_EMAIL_MISMATCH'
    });
  }
  next();
}

/**
 * @param {object} deps - { db, admin, openai, knowledgeBaseContent, reportService, stravaService, FieldValue }
 * @returns {express.Router}
 */
function createAdminRouter(deps) {
  const { db, admin, openai, knowledgeBaseContent, reportService: report, stravaService: strava, FieldValue } = deps;
  const router = express.Router();

  router.use(checkAdminAuth);

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
      return res.json({ success: true, data: { count: result.count } });
    } catch (err) {
      console.error('Admin Strava sync error:', err);
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

      console.log(`✅ Batch import: ${imported} entries for userId ${userId}`);

      res.json({
        success: true,
        data: {
          imported,
          total: entries.length
        }
      });
    } catch (error) {
      console.error('❌ FIRESTORE FOUT:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to import history',
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
      console.log(`✅ Telemetry inject: ${count} logs for uid ${uid}`);
      res.json({
        success: true,
        data: { injected: count, total: entries.length }
      });
    } catch (error) {
      console.error('❌ POST /users/:uid/history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to inject history',
        message: error.message
      });
    }
  });

  // GET /api/admin/users
  router.get('/users', async (req, res) => {
    const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || '').trim();
    console.log('Admin request ontvangen voor users. adminEmail aanwezig:', !!adminEmail, 'match:', adminEmail === ADMIN_EMAIL);
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized',
          code: 'FIRESTORE_NOT_READY'
        });
      }

      const usersSnapshot = await db.collection('users').get();
      console.log('Aantal gevonden documenten:', usersSnapshot.size);

      const users = usersSnapshot.docs.map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          userId: doc.id,
          profile: data.profile || null,
          profileComplete: data.profileComplete || false,
          adminNotes: data.adminNotes ?? null,
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null
        };
      });

      console.log(`✅ Admin users query: ${users.length} users fetched`);

      res.json({
        success: true,
        data: users
      });
    } catch (error) {
      console.error('❌ FIRESTORE FOUT:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch users',
        message: error.message
      });
    }
  });

  // DELETE /api/admin/users/:uid
  router.delete('/users/:uid', async (req, res) => {
    try {
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing user id' });
      }

      if (admin.apps.length > 0) {
        try {
          await admin.auth().deleteUser(uid);
          console.log('✅ Auth user deleted:', uid);
        } catch (authErr) {
          if (authErr.code !== 'auth/user-not-found') {
            console.warn('Auth deleteUser failed (non-fatal):', authErr.message);
          }
        }
      }

      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized'
        });
      }

      const userRef = db.collection('users').doc(String(uid));
      const dailyLogsRef = userRef.collection('dailyLogs');
      const snap = await dailyLogsRef.limit(500).get();

      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      await userRef.delete();
      console.log('✅ Firestore user deleted:', uid);

      res.json({
        success: true,
        data: { deleted: uid }
      });
    } catch (error) {
      console.error('❌ Admin delete user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete user',
        message: error.message
      });
    }
  });

  // GET /api/admin/stats
  router.get('/stats', async (req, res) => {
    const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || '').trim();
    console.log('Admin stats request. adminEmail match:', adminEmail === ADMIN_EMAIL);
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
      console.error('❌ FIRESTORE FOUT (admin stats):', error);
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
      const mergedProfile = { ...existingProfile, ...profilePatch };
      if (existingProfile.cycleData || profilePatch.cycleData) {
        mergedProfile.cycleData = {
          ...(existingProfile.cycleData || {}),
          ...(profilePatch.cycleData || {})
        };
      }
      await userRef.set(
        {
          profile: mergedProfile,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      res.json({ success: true, data: { userId, profile: mergedProfile } });
    } catch (error) {
      console.error('❌ admin profile-patch:', error);
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
      console.error('❌ admin user-notes:', error);
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
      console.error('❌ admin check-in update:', error);
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
      console.error('❌ FIRESTORE FOUT (admin alerts):', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch admin alerts',
        message: error.message
      });
    }
  });

  // GET /api/admin/reports/weekly/:uid
  router.get('/reports/weekly/:uid', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const result = await report.generateWeeklyReport({
        db,
        admin,
        openai,
        knowledgeBaseContent,
        uid
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('❌ Weekly report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate weekly report',
        message: error.message
      });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
