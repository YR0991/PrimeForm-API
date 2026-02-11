/**
 * AI API routes — mounted at /api/ai
 * Requires: Admin or Coach (x-admin-email or x-coach-email header).
 */

const express = require('express');
const aiService = require('../services/aiService');

const ADMIN_EMAIL = 'yoramroemersma50@gmail.com';

/**
 * Middleware: require Admin or Coach.
 * Eerst headers (x-admin-email, x-coach-email), anders req.body.adminEmail of req.body.coachEmail.
 */
function requireAdminOrCoach(req, res, next) {
  console.log('Auth Check Headers:', req.headers);

  const email = (
    req.headers['x-admin-email'] ||
    req.headers['x-coach-email'] ||
    (req.body && (req.body.adminEmail || req.body.coachEmail)) ||
    ''
  ).trim();

  if (email !== ADMIN_EMAIL) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized: Admin or Coach access required',
      code: 'ADMIN_OR_COACH_REQUIRED'
    });
  }
  next();
}

/**
 * @param {object} deps - { db, admin, openai }
 * @returns {express.Router}
 */
function createAiRouter(deps) {
  const { db, admin, openai } = deps;
  const router = express.Router();

  router.use(requireAdminOrCoach);

  // POST /api/ai/week-report — generate weekly report for an athlete
  router.post('/week-report', async (req, res) => {
    try {
      if (!db || !openai) {
        return res.status(503).json({
          success: false,
          error: 'Firestore or OpenAI not initialized'
        });
      }

      const { athleteId } = req.body;
      if (!athleteId) {
        return res.status(400).json({
          success: false,
          error: 'Missing athleteId in request body'
        });
      }

      const result = await aiService.generateWeekReport(athleteId, { db, admin, openai });
      return res.json(result);
    } catch (err) {
      console.error('[aiRoutes] week-report error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to generate weekly report'
      });
    }
  });

  return router;
}

module.exports = { createAiRouter };
