/**
 * Coach API routes — mounted at /api/coach
 * Squadron View for coaches.
 */

const express = require('express');
const crypto = require('crypto');
const coachService = require('../services/coachService');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const logger = require('../lib/logger');

/**
 * @param {object} deps - { db, admin }
 * @returns {express.Router}
 */
function createCoachRouter(deps) {
  const { db, admin } = deps;
  const router = express.Router();

  const userAuth = [verifyIdToken(admin), requireUser()];

  /**
   * Authorization middleware for all /api/coach/* routes.
   * INVARIANT:
   * - effectiveRole in ['coach','admin'] AND effectiveTeamId exists => allow
   * - Otherwise => 403 with explicit reasonCode (no PII)
   *
   * effectiveRole   = userDoc.role ?? userDoc.profile?.role ?? null
   * effectiveTeamId = userDoc.teamId ?? userDoc.profile?.teamId ?? null
   */
  async function requireCoachAuthorization(req, res, next) {
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Firestore is not initialized'
        });
      }

      const uid = req.user && req.user.uid;
      const uidHash =
        uid != null
          ? crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 8)
          : null;

      if (!uid) {
        const reasonCode = 'ROLE_MISSING';
        logger.info('COACH_FORBIDDEN', { uidHash, reasonCode });
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          reasonCode,
          gotRole: null,
          hasTeamId: false
        });
      }

      const userDocRef = db.collection('users').doc(String(uid));
      const snap = await userDocRef.get();

      if (!snap.exists) {
        const reasonCode = 'TEAM_DOC_MISSING';
        logger.info('COACH_FORBIDDEN', { uidHash, reasonCode });
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          reasonCode,
          gotRole: null,
          hasTeamId: false
        });
      }

      const userData = snap.data() || {};
      const effectiveRole = userData.role ?? userData.profile?.role ?? null;
      const effectiveTeamId = userData.teamId ?? userData.profile?.teamId ?? null;

      if (!effectiveRole) {
        const reasonCode = 'ROLE_MISSING';
        logger.info('COACH_FORBIDDEN', { uidHash, reasonCode });
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          reasonCode,
          gotRole: effectiveRole,
          hasTeamId: !!effectiveTeamId
        });
      }

      if (effectiveRole !== 'coach' && effectiveRole !== 'admin') {
        const reasonCode = 'ROLE_NOT_COACH';
        logger.info('COACH_FORBIDDEN', { uidHash, reasonCode });
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          reasonCode,
          gotRole: effectiveRole,
          hasTeamId: !!effectiveTeamId
        });
      }

      if (!effectiveTeamId) {
        const reasonCode = 'TEAM_MISSING';
        logger.info('COACH_FORBIDDEN', { uidHash, reasonCode });
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          reasonCode,
          gotRole: effectiveRole,
          hasTeamId: !!effectiveTeamId
        });
      }

      // Model A: rely on userDoc.teamId as single source of truth (no membership doc requirement).
      req.coachContext = {
        effectiveRole,
        effectiveTeamId
      };

      return next();
    } catch (err) {
      const uid = req.user && req.user.uid;
      const uidHash =
        uid != null
          ? crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 8)
          : null;
      logger.error('COACH_AUTH_ERROR', { uidHash, message: err.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to authorize coach request'
      });
    }
  }

  router.use(userAuth);
  router.use(requireCoachAuthorization);

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
