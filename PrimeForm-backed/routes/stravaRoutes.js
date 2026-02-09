/**
 * Strava API and OAuth routes.
 * - Mount API router at /api/strava (disconnect, sync, activities).
 * - Mount auth router at /auth/strava (connect, callback).
 */

const express = require('express');

/**
 * @param {object} deps - { db, admin, stravaService }
 * @returns {{ apiRouter: express.Router, authRouter: express.Router }}
 */
function createStravaRoutes(deps) {
  const { db, admin, stravaService } = deps;

  const apiRouter = express.Router();
  const authRouter = express.Router();

  // --- /api/strava (mount in server: app.use('/api/strava', apiRouter)) ---

  // PUT /api/strava/disconnect — user clears connection from Settings
  apiRouter.put('/disconnect', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      const { userId } = req.body || {};
      if (!userId) return res.status(400).json({ success: false, error: 'Missing userId' });
      const userRef = db.collection('users').doc(String(userId));
      await userRef.set(
        {
          strava: { connected: false },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return res.json({ success: true, data: { disconnected: true } });
    } catch (err) {
      console.error('Strava disconnect error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/strava/sync/:uid — fetch last 56 days from Strava, store in users/{uid}/activities (for ACWR + Recent Telemetry)
  apiRouter.get('/sync/:uid', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'Missing uid' });
      }
      const result = await stravaService.syncRecentActivities(uid, db, admin, { days: 56 });
      return res.json({ success: true, data: { newCount: result.count } });
    } catch (err) {
      console.error('Strava sync error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/strava/activities/:uid — return stored activities (for dashboard & admin)
  apiRouter.get('/activities/:uid', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      const uid = req.params.uid;
      if (!uid) return res.status(400).json({ success: false, error: 'Missing uid' });
      const snap = await db.collection('users').doc(String(uid)).collection('activities').get();
      const activities = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return res.json({ success: true, data: activities });
    } catch (err) {
      console.error('Strava activities list error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- /auth/strava (mount in server: app.use('/auth/strava', authRouter)) ---

  // GET /auth/strava/connect — OAuth step 1: redirect to Strava
  authRouter.get('/connect', (req, res) => {
    try {
      const userId = (req.query.userId || '').toString().trim();
      if (!userId) {
        return res.status(400).send('Missing userId. Use /auth/strava/connect?userId=YOUR_USER_ID');
      }
      const url = stravaService.getAuthUrl(userId);
      res.redirect(302, url);
    } catch (err) {
      console.error('Strava connect error:', err);
      res.status(500).send(err.message || 'Strava config missing');
    }
  });

  // GET /auth/strava/callback — OAuth step 2: exchange code for tokens, save to Firestore
  // FRONTEND_APP_URL must match the deployed frontend domain (e.g. Vercel URL or app.primeform.nl)
  authRouter.get('/callback', async (req, res) => {
    const frontendUrl = (process.env.FRONTEND_APP_URL || 'http://localhost:9000').replace(/\/$/, '');
    const settingsPath = `${frontendUrl}/settings`;

    try {
      const { code, state: userId, error } = req.query;
      if (error === 'access_denied') {
        return res.redirect(`${settingsPath}?status=strava_denied`);
      }
      if (!code || !userId) {
        return res.redirect(`${settingsPath}?status=strava_error&message=missing_code_or_state`);
      }

      const tokens = await stravaService.exchangeToken(code);
      const athleteId = tokens.athlete?.id || null;

      if (!db) {
        return res.redirect(`${settingsPath}?status=strava_error&message=db_not_ready`);
      }

      const athlete = tokens.athlete || {};
      const athleteName = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || null;
      const userRef = db.collection('users').doc(String(userId));
      await userRef.set(
        {
          strava: {
            connected: true,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: tokens.expires_at,
            athleteId: athleteId,
            athleteName: athleteName
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      console.log(`✅ Strava connected for user ${userId}, athleteId ${athleteId}`);
      res.redirect(302, `${frontendUrl}/profile?status=strava_connected`);
    } catch (err) {
      console.error('Strava callback error:', err);
      res.redirect(`${settingsPath}?status=strava_error&message=${encodeURIComponent(err.message || 'unknown')}`);
    }
  });

  return { apiRouter, authRouter };
}

module.exports = { createStravaRoutes };
