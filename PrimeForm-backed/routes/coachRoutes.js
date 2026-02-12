/**
 * Coach API routes — mounted at /api/coach
 * Squadron View for coaches.
 */

const express = require('express');
const coachService = require('../services/coachService');

const ADMIN_EMAIL = 'yoramroemersma50@gmail.com';

/**
 * Middleware: require admin/coach email (zelfde als admin voor nu).
 */
function verifyToken(req, res, next) {
  const coachEmail = (
    req.headers['x-admin-email'] ||
    req.headers['x-coach-email'] ||
    req.query.coachEmail ||
    (req.body && req.body.coachEmail) ||
    ''
  ).trim();
  if (coachEmail !== ADMIN_EMAIL) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized: Coach access required',
      code: 'COACH_ACCESS_REQUIRED'
    });
  }
  next();
}

/**
 * @param {object} deps - { db, admin }
 * @returns {express.Router}
 */
function createCoachRouter(deps) {
  const { db, admin } = deps;
  const router = express.Router();

  router.use(verifyToken);

  // GET /api/coach/squadron — Squadron View data
  router.get('/squadron', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized'
        });
      }

      const squadron = await coachService.getSquadronData(db, admin);

      res.json({
        success: true,
        data: squadron
      });
    } catch (error) {
      console.error('❌ Coach squadron error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch squadron data',
        message: error.message
      });
    }
  });

  // GET /api/coach/athletes/:id — single athlete detail for deep dive
  router.get('/athletes/:id', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized',
        });
      }
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, error: 'Missing athlete id' });
      }
      const data = await coachService.getAthleteDetail(db, admin, id);
      res.json({ success: true, data });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Athlete not found' });
      }
      console.error('❌ Coach athlete detail error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch athlete detail',
        message: error.message,
      });
    }
  });

  // PUT /api/coach/athletes/:id/notes — coach logbook (Engineering Notes), persists to user.adminNotes
  router.put('/athletes/:id/notes', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const { id } = req.params;
      const { adminNotes } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, error: 'Missing athlete id' });
      }
      const userRef = db.collection('users').doc(String(id));
      const snap = await userRef.get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'Athlete not found' });
      }
      await userRef.set({ adminNotes: adminNotes != null ? String(adminNotes) : '' }, { merge: true });
      return res.json({ success: true, data: { id, adminNotes: adminNotes != null ? String(adminNotes) : '' } });
    } catch (error) {
      console.error('❌ Coach athlete notes error:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = { createCoachRouter };
