/**
 * Strava API and OAuth routes.
 * - Mount API router at /api/strava (disconnect, sync, activities). User-scoped routes require Firebase ID token; uid from req.user.uid.
 * - Mount auth router at /auth/strava (connect, callback).
 */

const express = require('express');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const { createState, consumeState } = require('../services/stravaOAuthState');
const { markLoadMetricsStale } = require('../lib/metricsMeta');
const logger = require('../lib/logger');

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
      logger.error('Strava disconnect error', err);
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
      logger.error('Strava sync error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/strava/sync-now — manual sync; cold start 30d if no stored activities, else incremental (newestStored - 1d). Rate limit 1 per 10 min.
  const SYNC_NOW_COOLDOWN_MS = 10 * 60 * 1000;
  const toIso = (v) => {
    if (v == null) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (typeof v === 'string') return v;
    if (v instanceof Date) return v.toISOString();
    return null;
  };

  apiRouter.post('/sync-now', auth, async (req, res) => {
    const uid = req.user.uid;
    const nowIso = () => new Date().toISOString();
    let userRef;
    let userData;
    let afterTimestamp = null;
    let afterStrategy = null;
    const debugPayload = (overrides = {}) => ({
      success: false,
      error: overrides.error,
      message: overrides.message ?? overrides.error,
      uidUsed: uid,
      now: nowIso(),
      scopeStored: overrides.scopeStored ?? null,
      connectedAtStored: overrides.connectedAtStored ?? null,
      afterTimestampUsed: overrides.afterTimestampUsed ?? null,
      afterStrategy: overrides.afterStrategy ?? null,
      stravaResponseMeta: overrides.stravaResponseMeta ?? null,
      ...overrides
    });

    try {
      if (!db) return res.status(503).json(debugPayload({ error: 'Firestore is not initialized' }));
      userRef = db.collection('users').doc(String(uid));
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json(debugPayload({ error: 'User not found' }));
      userData = userSnap.data() || {};
      if (!userData.strava?.connected || !userData.strava?.refreshToken) {
        return res.status(400).json(debugPayload({ error: 'Strava not connected', scopeStored: userData.strava?.scope ?? null, connectedAtStored: toIso(userData.strava?.connectedAt) ?? null }));
      }
      const lastSyncNowAt = userData.lastSyncNowAt;
      const now = Date.now();
      if (lastSyncNowAt != null) {
        const ts = typeof lastSyncNowAt.toMillis === 'function' ? lastSyncNowAt.toMillis() : Number(lastSyncNowAt);
        if (Number.isFinite(ts) && now - ts < SYNC_NOW_COOLDOWN_MS) {
          return res.status(429).json({
            ...debugPayload({ error: 'Rate limit: one sync per 10 minutes', message: 'Rate limit: one sync per 10 minutes' }),
            retryAfter: Math.ceil((SYNC_NOW_COOLDOWN_MS - (now - ts)) / 1000)
          });
        }
      }

      const newestStoredActivityDate = userData.stravaSync?.newestStoredActivityDate ?? null;
      afterStrategy = 'explicit';
      if (newestStoredActivityDate == null) {
        afterTimestamp = now - 30 * 24 * 60 * 60 * 1000;
        afterStrategy = 'cold_start_30d';
      } else {
        const parsed = new Date(newestStoredActivityDate).getTime();
        if (Number.isFinite(parsed)) {
          afterTimestamp = parsed - 24 * 60 * 60 * 1000;
          afterStrategy = 'incremental_newestStored';
        } else {
          afterTimestamp = now - 30 * 24 * 60 * 60 * 1000;
          afterStrategy = 'cold_start_30d';
        }
      }

      let result;
      try {
        result = await stravaService.syncActivitiesAfter(uid, db, admin, { afterTimestamp });
      } catch (syncErr) {
        const statusCode = syncErr.statusCode;
        if (statusCode === 401 || statusCode === 403) {
          await userRef.set(
            {
              stravaSync: {
                lastError: 'STRAVA_REAUTH_REQUIRED',
                reauthRequired: true,
                lastErrorStatusCode: statusCode,
                lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
                lastErrorSource: 'sync_now'
              }
            },
            { merge: true }
          );
          return res.status(409).json({
            ok: false,
            code: 'STRAVA_REAUTH_REQUIRED',
            message: 'Strava-koppeling verlopen. Koppel opnieuw.'
          });
        }
        throw syncErr;
      }
      let newestStoredActivityDateAfter = null;
      const activitiesRef = userRef.collection('activities');
      const latestSnap = await activitiesRef.orderBy('start_date', 'desc').limit(1).get();
      if (!latestSnap.empty) {
        const d = latestSnap.docs[0].data();
        const sd = d.start_date;
        if (sd && typeof sd.toDate === 'function') newestStoredActivityDateAfter = sd.toDate().toISOString();
        else if (typeof sd === 'string') newestStoredActivityDateAfter = sd;
        else if (sd instanceof Date) newestStoredActivityDateAfter = sd.toISOString();
      }

      await userRef.set(
        {
          lastSyncNowAt: admin.firestore.FieldValue.serverTimestamp(),
          stravaSync: {
            lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: admin.firestore.FieldValue.delete(),
            fetched: result.fetched,
            inserted: result.inserted,
            skipped: result.skipped,
            newestStravaStartDate: result.newestStravaActivityStartDate,
            newestStoredActivityDate: newestStoredActivityDateAfter
          }
        },
        { merge: true }
      );
      await markLoadMetricsStale(db, admin, uid, 'STRAVA_SYNC');

      return res.json({
        success: true,
        fetched: result.fetched,
        inserted: result.inserted,
        skipped: result.skipped,
        newestStravaActivityStartDate: result.newestStravaActivityStartDate,
        newestStoredActivityDate: newestStoredActivityDateAfter,
        wroteToPath: `users/${uid}/activities`,
        uidUsed: uid,
        now: nowIso(),
        scopeStored: userData.strava?.scope ?? null,
        connectedAtStored: toIso(userData.strava?.connectedAt) ?? null,
        afterTimestampUsed: afterTimestamp != null ? new Date(afterTimestamp).toISOString() : null,
        afterStrategy,
        stravaResponseMeta: result.stravaResponseMeta ?? null
      });
    } catch (err) {
      logger.error('Strava sync-now error', err);
      try {
        await userRef.set(
          {
            stravaSync: {
              lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
              lastError: err.message || 'Sync failed'
            }
          },
          { merge: true }
        );
      } catch (e) {
        /* ignore */
      }
      const status = err.message && err.message.includes('backoff') ? 429 : 500;
      return res.status(status).json(
        debugPayload({
          error: err.message,
          message: err.message,
          scopeStored: userData?.strava?.scope ?? null,
          connectedAtStored: userData?.strava?.connectedAt != null ? toIso(userData.strava.connectedAt) : null,
          afterTimestampUsed: afterTimestamp != null ? new Date(afterTimestamp).toISOString() : null,
          afterStrategy,
          stravaResponseMeta: err.stravaResponseMeta ?? null
        })
      );
    }
  });

  // GET /api/strava/connect-url — OAuth step 1 (JSON): return Strava authorize URL; state bound to uid, TTL 10 min.
  apiRouter.get('/connect-url', auth, (req, res) => {
    try {
      const state = createState(req.user.uid);
      const url = stravaService.getAuthUrl(state);
      return res.json({ url });
    } catch (err) {
      logger.error('Strava connect-url error', err);
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
      logger.error('Strava activities list error', err);
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
      logger.error('Strava connect error', err);
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
            connectedAt: admin.firestore.FieldValue.serverTimestamp(),
            athleteId: athleteId,
            scope: tokens.scope || 'activity:read_all',
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: tokens.expires_at,
            athleteName: athleteName
          },
          stravaSync: {
            lastSuccessAt: null,
            lastError: null,
            lastAttemptAt: null
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      logger.info('Strava connected');
      res.redirect(302, `${frontendUrl}/loading?status=strava_connected`);
    } catch (err) {
      logger.error('Strava callback error', err);
      res.redirect(`${settingsPath}?status=strava_error&message=${encodeURIComponent(err.message || 'unknown')}`);
    }
  });

  return { apiRouter, authRouter };
}

module.exports = { createStravaRoutes };
