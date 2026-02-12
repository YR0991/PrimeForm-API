/**
 * Activity API routes — mounted at /api/activities
 * - DELETE /api/activities/:id — delete a manual session (safety: only source === 'manual')
 */

const express = require('express');

function createActivityRouter(deps) {
  const { db } = deps;
  const router = express.Router();

  /**
   * DELETE /api/activities/:id
   * Query: userId (optional) — if provided, only delete if activity.userId matches (coach scoping).
   * Response: 200 { success: true } so frontend can refresh stats.
   */
  router.delete('/:id', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
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

      const requestedUserId = (req.query.userId || '').trim();
      if (requestedUserId && data.userId !== requestedUserId) {
        return res.status(403).json({ success: false, error: 'Activity does not belong to this user' });
      }

      await ref.delete();
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('DELETE /api/activities/:id error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createActivityRouter };
