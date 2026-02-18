/**
 * Activity API routes — mounted at /api/activities
 * - GET /api/activities?limit=7 — last N activities for req.user.uid (date, type, primeLoad, source)
 * - DELETE /api/activities/:id — delete a manual session (safety: only source === 'manual'). Auth: uid from token only.
 */

const express = require('express');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const { markLoadMetricsStale } = require('../lib/metricsMeta');
const reportService = require('../services/reportService');
const logger = require('../lib/logger');

function createActivityRouter(deps) {
  const { db, admin } = deps;
  const auth = admin ? [verifyIdToken(admin), requireUser()] : [];
  const router = express.Router();

  /**
   * GET /api/activities?limit=7
   * Returns last N activities for authenticated user. Same storage as coach view.
   */
  router.get('/', ...auth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore not initialized' });
      }
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 7));
      const activities = await reportService.getRecentActivitiesForUser({ db, admin, uid, limit });
      return res.json({ success: true, data: activities });
    } catch (err) {
      logger.error('GET /api/activities error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/activities/:id
   * Auth: token required. User may only delete their own manual activities (data.userId === req.user.uid).
   * query.userId / body ignored; uid from token only.
   * Response: 200 { success: true } or 404 / 403.
   */
  router.delete('/:id', ...auth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore not initialized' });
      }
      const uid = req.user && req.user.uid ? String(req.user.uid) : null;
      if (!uid) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }
      const id = (req.params.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, error: 'Missing activity id' });
      }

      const ref = db.collection('activities').doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }

      const data = snap.data() || {};
      if (data.source !== 'manual') {
        return res.status(403).json({
          success: false,
          error: 'Only manual sessions can be deleted. Strava activities are read-only.',
        });
      }

      if (data.userId !== uid) {
        return res.status(403).json({ success: false, error: 'Activity does not belong to this user' });
      }

      await ref.delete();
      await markLoadMetricsStale(db, admin, uid, 'USER_DELETE');
      return res.status(200).json({ success: true });
    } catch (err) {
      logger.error('DELETE /api/activities/:id error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createActivityRouter };
