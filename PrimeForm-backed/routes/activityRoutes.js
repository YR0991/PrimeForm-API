/**
 * Activity API routes — mounted at /api/activities
 * - DELETE /api/activities/:id — delete a manual session (safety: only source === 'manual'). Auth: uid from token only.
 */

const express = require('express');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const logger = require('../lib/logger');

function createActivityRouter(deps) {
  const { db, admin } = deps;
  const auth = admin ? [verifyIdToken(admin), requireUser()] : [];
  const router = express.Router();

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
      return res.status(200).json({ success: true });
    } catch (err) {
      logger.error('DELETE /api/activities/:id error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createActivityRouter };
