/**
 * Dashboard route: GET /api/dashboard, GET /api/daily-brief
 * Returns telemetry (ACWR, phase, todayLog) for the cockpit.
 * todayLog = today's dailyLog from users/{uid}/dailyLogs (metrics, recommendation, aiMessage, cycleInfo).
 * Protected: require Firebase ID token (Authorization: Bearer); uid from req.user.uid.
 */

const crypto = require('crypto');
const express = require('express');
const cycleService = require('../services/cycleService');
const reportService = require('../services/reportService');
const dailyBriefService = require('../services/dailyBriefService');
const { isHormonallySuppressedOrNoBleed } = require('../lib/profileValidation');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const { todayAmsterdamStr, addDaysAmsterdamStr } = require('../utils/dateAmsterdam');

/** True if err is Firestore FAILED_PRECONDITION due to missing index (code 9 or message). */
function isIndexMissingError(err) {
  if (!err) return false;
  const code = err.code;
  const msg = (err.message || '').toString();
  if (code === 9) return true;
  return msg.includes('FAILED_PRECONDITION') && msg.includes('requires an index');
}

function uidHash(uid) {
  if (!uid) return 'n/a';
  return crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 12);
}

/** Normalize activity date to YYYY-MM-DD for filtering (start_date_local, start_date, date, dayKey). */
function activityDateStr(a) {
  const raw = a.start_date_local ?? a.start_date ?? a.date ?? a.dayKey;
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

/** Fetch all activities (users/{uid}/activities + root activities) in [startDay, todayIso] (Amsterdam), newest first. */
async function fetchActivitiesLast7Days(db, uid, startDay, todayIso) {
  if (!db || !uid) return [];
  try {
    const [subSnap, rootSnap] = await Promise.all([
      db.collection('users').doc(String(uid)).collection('activities').get(),
      db.collection('activities').where('userId', '==', String(uid)).get()
    ]);
    const subList = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const rootList = rootSnap.docs.map((d) => {
      const data = d.data() || {};
      return { id: d.id, ...data, source: data.source || 'manual' };
    });
    const merged = [...subList, ...rootList];
    const filtered = merged.filter((a) => {
      const dateStr = activityDateStr(a);
      return dateStr.length >= 10 && dateStr >= startDay && dateStr <= todayIso;
    });
    return filtered.sort((a, b) => activityDateStr(b).localeCompare(activityDateStr(a)));
  } catch (e) {
    console.error('Dashboard activitiesLast7Days fetch failed:', e);
    return [];
  }
}

/**
 * @param {object} deps - { db, admin, kbVersion, stravaService }
 * @returns {express.Router}
 */
function createDashboardRouter(deps) {
  const { db, admin, kbVersion, stravaService } = deps;
  const router = express.Router();
  const auth = [verifyIdToken(admin), requireUser()];

  // GET /api/dashboard — uid from verified token (req.user.uid)
  router.get('/dashboard', auth, async (req, res) => {
    try {
      const uid = req.user.uid;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const payload = await getDashboardPayload({ db, admin, stravaService }, uid);
      return res.json({ success: true, data: payload });
    } catch (error) {
      const uid = req.user && req.user.uid;
      if (isIndexMissingError(error)) {
        console.warn('[FIRESTORE_INDEX_MISSING]', uidHash(uid));
        const fallbackPayload = {
          acwr: null,
          phase: null,
          phaseDay: null,
          phaseLength: 28,
          current_phase: null,
          current_phase_day: null,
          cycle_length: 28,
          readiness_today: null,
          readiness: null,
          recent_activities: [],
          activitiesLast7Days: [],
          stravaConnected: false,
          avatarUrl: null,
          todayLog: null,
          history_logs: [],
          ghost_comparison: [],
          rhr_baseline_28d: null,
          hrv_baseline_28d: null,
          strava_meta: null,
          cycleContext: {
            phaseName: null,
            phaseDay: null,
            confidence: 'LOW',
            phaseLabelNL: null,
            source: 'INDEX_FALLBACK'
          }
        };
        return res.json({ success: true, data: fallbackPayload });
      }
      console.error('GET /api/dashboard error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load dashboard',
        message: error.message
      });
    }
  });

  // GET /api/daily-brief — uid from verified token; date from query.date (YYYY-MM-DD) or today Europe/Amsterdam
  router.get('/daily-brief', auth, async (req, res) => {
    try {
      const uid = req.user.uid;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const dateISO = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date).trim()))
        ? String(req.query.date).trim()
        : todayAmsterdamStr();
      const brief = await dailyBriefService.getDailyBrief({
        db,
        admin,
        uid,
        dateISO,
        timezone: 'Europe/Amsterdam',
        kbVersion
      });
      console.log(JSON.stringify({
        event: 'daily_brief',
        engineVersion: brief.meta.engineVersion,
        schemaVersion: brief.meta.schemaVersion,
        kbVersion: brief.meta.kbVersion
      }));
      return res.json({ success: true, data: brief });
    } catch (error) {
      console.error('GET /api/daily-brief error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load daily brief',
        message: error.message
      });
    }
  });

  return router;
}

/**
 * Build dashboard payload for a given uid. Used by GET /api/dashboard and GET /api/admin/users/:uid/dashboard.
 * @param {object} deps - { db, admin, stravaService (optional) }
 * @param {string} uid - User id
 * @returns {Promise<object>} Same shape as GET /api/dashboard data
 */
async function getDashboardPayload(deps, uid) {
  const { db, admin, stravaService } = deps;
  if (!db || !uid) {
    throw new Error('db and uid required');
  }
  const todayIso = todayAmsterdamStr();
  const startDay = addDaysAmsterdamStr(todayIso, -6);

  let todayLog = null;
  try {
    const todaySnap = await db
      .collection('users')
      .doc(String(uid))
      .collection('dailyLogs')
      .where('date', '==', todayIso)
      .limit(1)
      .get();
    if (!todaySnap.empty) {
      const doc = todaySnap.docs[0];
      const d = doc.data() || {};
      const metrics = d.metrics || {};
      const hrv = typeof metrics.hrv === 'object' && metrics.hrv && metrics.hrv.current != null
        ? metrics.hrv.current
        : (typeof metrics.hrv === 'number' ? metrics.hrv : null);
      const rhr = typeof metrics.rhr === 'object' && metrics.rhr && metrics.rhr.current != null
        ? metrics.rhr.current
        : (metrics.rhr != null ? metrics.rhr : null);
      todayLog = {
        metrics: {
          hrv,
          rhr,
          sleep: metrics.sleep != null ? metrics.sleep : null,
          readiness: metrics.readiness != null ? metrics.readiness : null
        },
        recommendation: d.recommendation || null,
        aiMessage: d.aiMessage != null ? d.aiMessage : null,
        cycleInfo: d.cycleInfo || null
      };
    }
  } catch (e) {
    console.error('Dashboard todayLog fetch failed:', e);
  }

  const [stats, activitiesLast7Days] = await Promise.all([
    reportService.getDashboardStats({ db, admin, uid }),
    fetchActivitiesLast7Days(db, uid, startDay, todayIso)
  ]);

  const userSnap = await db.collection('users').doc(String(uid)).get();
  const profile = userSnap.exists ? (userSnap.data() || {}).profile || {} : {};
  const cycleGated = isHormonallySuppressedOrNoBleed(profile);

  let cycleContext;
  if (cycleGated) {
    cycleContext = {
      phaseName: null,
      phaseDay: null,
      confidence: 'LOW',
      mode: dailyBriefService.cycleMode(profile) || 'UNKNOWN',
      phaseLabelNL: null,
      source: 'GATED'
    };
  } else {
    cycleContext = dailyBriefService.buildCycleContext({
      profile,
      stats,
      cycleInfo: todayLog && todayLog.cycleInfo ? todayLog.cycleInfo : null,
      dateISO: todayIso
    });
  }

  const phase = cycleContext.confidence === 'HIGH' ? cycleContext.phaseName : null;
  const phaseDay = cycleContext.confidence === 'HIGH' ? cycleContext.phaseDay : null;
  let phaseLength = stats.phaseLength || 28;
  if (todayLog && todayLog.cycleInfo && todayLog.cycleInfo.cycleLength) {
    phaseLength = todayLog.cycleInfo.cycleLength;
  }

  const readiness_today = todayLog && todayLog.metrics && todayLog.metrics.readiness != null
    ? todayLog.metrics.readiness
    : null;

  let strava_meta = null;
  let stravaConnected = false;
  let avatarUrl = null;
  try {
    if (userSnap.exists) {
      const u = userSnap.data() || {};
      stravaConnected = u.strava?.connected === true;
      avatarUrl = u.profile?.avatar || u.profile?.avatarUrl || null;
      const toIso = (v) => {
        if (v == null) return null;
        if (typeof v.toDate === 'function') return v.toDate().toISOString();
        if (typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString();
        if (v.seconds != null) return new Date(v.seconds * 1000).toISOString();
        if (Number.isFinite(Number(v))) return new Date(Number(v)).toISOString();
        return null;
      };
      strava_meta = {
        lastWebhookAt: toIso(u.stravaLastWebhookAt),
        lastWebhookEvent: u.stravaLastWebhookEvent || null,
        lastSyncedAt: toIso(u.lastStravaSyncedAt),
        lastSyncNowAt: toIso(u.lastSyncNowAt),
        backoffUntil: u.stravaBackoffUntil != null ? new Date(Number(u.stravaBackoffUntil)).toISOString() : null,
        lastError: u.stravaLastError || null
      };
      if (stravaService && stravaConnected && !avatarUrl) {
        const syncedAt = u.stravaProfileSyncedAt;
        let shouldSync = true;
        if (syncedAt != null) {
          const ms = typeof syncedAt.toMillis === 'function' ? syncedAt.toMillis() : (Number(syncedAt) || 0);
          if (Number.isFinite(ms) && Date.now() - ms < 24 * 60 * 60 * 1000) shouldSync = false;
        }
        if (shouldSync) {
          stravaService.syncStravaAthleteProfile(uid, db, admin)
            .then((r) => { if (r.ok && r.avatarUrl) { avatarUrl = r.avatarUrl; } })
            .catch((e) => console.warn('Dashboard avatar sync failed:', e.message));
        }
      }
    }
  } catch (e) {
    console.error('Dashboard strava_meta:', e);
  }

  const isGated = cycleContext.source === 'GATED' || cycleContext.confidence !== 'HIGH';
  const historyLogs = (stats.history_logs || []).map((row) =>
    isGated ? { ...row, cycleDay: null } : row
  );
  const ghostComparison = (stats.ghost_comparison || []).map((row) =>
    isGated ? { ...row, cycleDay: null } : row
  );

  return {
    acwr: stats.acwr,
    phase,
    phaseDay,
    phaseLength,
    current_phase: phase,
    current_phase_day: phaseDay,
    cycle_length: phaseLength,
    readiness_today,
    readiness: readiness_today,
    recent_activities: stats.recent_activities || [],
    activitiesLast7Days: activitiesLast7Days || [],
    stravaConnected,
    avatarUrl,
    todayLog,
    history_logs: historyLogs,
    ghost_comparison: ghostComparison,
    rhr_baseline_28d: stats.rhr_baseline_28d ?? null,
    hrv_baseline_28d: stats.hrv_baseline_28d ?? null,
    strava_meta,
    cycleContext
  };
}

module.exports = { createDashboardRouter, getDashboardPayload };
