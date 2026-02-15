/**
 * Strava API and OAuth routes.
 * - Mount API router at /api/strava (disconnect, sync, activities). User-scoped routes require Firebase ID token; uid from req.user.uid.
 * - Mount auth router at /auth/strava (connect, callback).
 */

const express = require('express');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const { createState, consumeState } = require('../services/stravaOAuthState');

/**
 * @param {object} deps - { db, admin, stravaService }
 * @returns {{ apiRouter: express.Router, authRouter: express.Router }}
 */
function createStravaRoutes(deps) {
  const { db, admin, stravaService } = deps;
  const auth = [verifyIdToken(admin), requireUser()];

  const apiRouter = express.Router();
  const authRouter = express.Router();

  // --- /api/strava (mount in server: app.use('/api/strava', apiRouter)) ---

  // PUT /api/strava/disconnect — user clears connection from Settings. Protected: uid from token.
  apiRouter.put('/disconnect', auth, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      const userRef = db.collection('users').doc(String(req.user.uid));
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

  // GET /api/strava/sync/:uid — legacy: fetch last 56 days (no rate limit). Protected: only own uid.
  apiRouter.get('/sync/:uid', auth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.params.uid;
      if (uid !== req.user.uid) {
        return res.status(403).json({ success: false, error: 'Forbidden: cannot sync another user' });
      }
      const result = await stravaService.syncRecentActivities(uid, db, admin, { days: 56 });
      return res.json({ success: true, data: { newCount: result.count } });
    } catch (err) {
      console.error('Strava sync error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/strava/sync-now — manual sync: fetch activities after lastStravaSyncedAt, rate limit 1 per 10 min per user. Protected: uid from token.
  const SYNC_NOW_COOLDOWN_MS = 10 * 60 * 1000;
  apiRouter.post('/sync-now', auth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      }
      const uid = req.user.uid;
      const userRef = db.collection('users').doc(String(uid));
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const userData = userSnap.data() || {};
      if (!userData.strava?.connected || !userData.strava?.refreshToken) {
        return res.status(400).json({ success: false, error: 'Strava not connected' });
      }
      const lastSyncNowAt = userData.lastSyncNowAt;
      const now = Date.now();
      if (lastSyncNowAt != null) {
        const ts = typeof lastSyncNowAt.toMillis === 'function' ? lastSyncNowAt.toMillis() : Number(lastSyncNowAt);
        if (Number.isFinite(ts) && now - ts < SYNC_NOW_COOLDOWN_MS) {
          return res.status(429).json({
            success: false,
            error: 'Rate limit: one sync per 10 minutes',
            retryAfter: Math.ceil((SYNC_NOW_COOLDOWN_MS - (now - ts)) / 1000)
          });
        }
      }
      const lastStravaSyncedAt = userData.lastStravaSyncedAt;
      let afterTimestamp = null;
      if (lastStravaSyncedAt != null) {
        if (typeof lastStravaSyncedAt.toMillis === 'function') afterTimestamp = lastStravaSyncedAt.toMillis();
        else if (typeof lastStravaSyncedAt.toDate === 'function') afterTimestamp = lastStravaSyncedAt.toDate().getTime();
        else if (Number.isFinite(Number(lastStravaSyncedAt))) afterTimestamp = Number(lastStravaSyncedAt);
      }
      if (afterTimestamp == null) afterTimestamp = now - 30 * 24 * 60 * 60 * 1000; // 30 days ago
      const result = await stravaService.syncActivitiesAfter(uid, db, admin, { afterTimestamp });
      await userRef.set({ lastSyncNowAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return res.json({ success: true, data: { newCount: result.count } });
    } catch (err) {
      console.error('Strava sync-now error:', err);
      const status = err.message && err.message.includes('backoff') ? 429 : 500;
      return res.status(status).json({ success: false, error: err.message });
    }
  });

  // GET /api/strava/connect-url — OAuth step 1 (JSON): return Strava authorize URL; state bound to uid, TTL 10 min.
  apiRouter.get('/connect-url', auth, (req, res) => {
    try {
      const state = createState(req.user.uid);
      const url = stravaService.getAuthUrl(state);
      return res.json({ url });
    } catch (err) {
      console.error('Strava connect-url error:', err);
      return res.status(500).json({ error: err.message || 'Strava config missing' });
    }
  });

  // GET /api/strava/activities/:uid — return stored activities. Protected: only own uid.
  apiRouter.get('/activities/:uid', auth, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
      const uid = req.params.uid;
      if (uid !== req.user.uid) {
        return res.status(403).json({ success: false, error: 'Forbidden: cannot list another user\'s activities' });
      }
      const snap = await db.collection('users').doc(String(uid)).collection('activities').get();
      const activities = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return res.json({ success: true, data: activities });
    } catch (err) {
      console.error('Strava activities list error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- /auth/strava (mount in server: app.use('/auth/strava', authRouter)) ---

  // GET /auth/strava/connect — OAuth step 1 (redirect): legacy; app uses GET /api/strava/connect-url (JSON) instead.
  authRouter.get('/connect', auth, (req, res) => {
    try {
      const state = createState(req.user.uid);
      const url = stravaService.getAuthUrl(state);
      res.redirect(302, url);
    } catch (err) {
      console.error('Strava connect error:', err);
      res.status(500).send(err.message || 'Strava config missing');
    }
  });

  // GET /auth/strava/callback — OAuth step 2: resolve uid only from validated state; never trust query/body uid
  authRouter.get('/callback', async (req, res) => {
    const frontendUrl = (process.env.FRONTEND_APP_URL || 'http://localhost:9000').replace(/\/$/, '');
    const settingsPath = `${frontendUrl}/settings`;

    try {
      const { code, state, error } = req.query;
      if (error === 'access_denied') {
        return res.redirect(`${settingsPath}?status=strava_denied`);
      }

      const consumed = consumeState(state);
      if (consumed.error) {
        return res.redirect(`${settingsPath}?status=strava_error&message=state_${consumed.error}`);
      }
      const uid = consumed.uid;

      if (!code) {
        return res.redirect(`${settingsPath}?status=strava_error&message=missing_code`);
      }

      const tokens = await stravaService.exchangeToken(code);
      const athleteId = tokens.athlete?.id || null;

      if (!db) {
        return res.redirect(`${settingsPath}?status=strava_error&message=db_not_ready`);
      }

      const athlete = tokens.athlete || {};
      const athleteName = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || null;
      const userRef = db.collection('users').doc(String(uid));
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

      console.log(`✅ Strava connected for user ${uid}, athleteId ${athleteId}`);
      res.redirect(302, `${frontendUrl}/intake?status=strava_connected`);
    } catch (err) {
      console.error('Strava callback error:', err);
      res.redirect(`${settingsPath}?status=strava_error&message=${encodeURIComponent(err.message || 'unknown')}`);
    }
  });

  return { apiRouter, authRouter };
}

module.exports = { createStravaRoutes };
