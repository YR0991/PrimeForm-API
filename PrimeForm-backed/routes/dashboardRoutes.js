/**
 * Dashboard route: GET /api/dashboard
 * Returns telemetry (ACWR, phase, todayLog) for the cockpit.
 * todayLog = today's dailyLog from users/{uid}/dailyLogs (metrics, recommendation, aiMessage, cycleInfo).
 */

const express = require('express');
const cycleService = require('../services/cycleService');
const reportService = require('../services/reportService');

/**
 * @param {object} deps - { db, admin }
 * @returns {express.Router}
 */
function createDashboardRouter(deps) {
  const { db, admin } = deps;
  const router = express.Router();

  // GET /api/dashboard — uid from X-User-Uid header or query.uid
  router.get('/dashboard', async (req, res) => {
    try {
      const uid = (req.headers['x-user-uid'] || req.query.uid || '').toString().trim();
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing user id. Send X-User-Uid header or uid query.' });
      }
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }

      const todayIso = new Date().toISOString().slice(0, 10);

      // 1) Today's log from users/{uid}/dailyLogs (date === YYYY-MM-DD)
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

      // 2) ACWR, phase, recent_activities from reportService
      const stats = await reportService.getDashboardStats({ db, admin, uid });

      // 3) Phase from profile if no todayLog (so Bio-Clock still works)
      let phase = stats.phase;
      let phaseDay = stats.phaseDay;
      let phaseLength = stats.phaseLength || 28;
      if ((phase == null || phaseDay == null) && todayLog && todayLog.cycleInfo) {
        phase = todayLog.cycleInfo.phase || stats.phase;
        phaseDay = todayLog.cycleInfo.currentCycleDay ?? stats.phaseDay;
        phaseLength = todayLog.cycleInfo.cycleLength || phaseLength;
      }
      if (phase == null || phaseDay == null) {
        const userSnap = await db.collection('users').doc(String(uid)).get();
        const profile = userSnap.exists ? (userSnap.data() || {}).profile || {} : {};
        const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
        const lastPeriod = cycleData.lastPeriodDate || cycleData.lastPeriod || null;
        const cycleLen = Number(cycleData.avgDuration) || 28;
        if (lastPeriod) {
          const phaseInfo = cycleService.getPhaseForDate(lastPeriod, cycleLen, todayIso);
          phase = phaseInfo.phaseName;
          phaseDay = phaseInfo.currentCycleDay;
          phaseLength = cycleLen;
        }
      }

      const readiness_today = todayLog && todayLog.metrics && todayLog.metrics.readiness != null
        ? todayLog.metrics.readiness
        : null;

      const payload = {
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
        todayLog,
        history_logs: stats.history_logs || [],
        ghost_comparison: stats.ghost_comparison || [],
        rhr_baseline_28d: stats.rhr_baseline_28d ?? null,
        hrv_baseline_28d: stats.hrv_baseline_28d ?? null
      };

      return res.json({ success: true, data: payload });
    } catch (error) {
      console.error('GET /api/dashboard error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load dashboard',
        message: error.message
      });
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
