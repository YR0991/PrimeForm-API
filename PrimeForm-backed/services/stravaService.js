/**
 * Strava OAuth and API helpers.
 * Credentials from .env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI
 */

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const SCOPE = 'activity:read_all';

/** Buffer: refresh if token expires within this many seconds */
const REFRESH_BUFFER_SEC = 5 * 60;

/**
 * Build the URL to send the user to Strava for authorization.
 * @param {string} [state] - Optional state (e.g. userId) returned in callback
 * @returns {string} Full authorization URL
 */
function getAuthUrl(state = '') {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('Strava: STRAVA_CLIENT_ID and STRAVA_REDIRECT_URI must be set in .env');
  }

  const params = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'activity:read_all',
    approval_prompt: 'auto'
  });
  if (state) params.set('state', state);

  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access_token and refresh_token.
 * @param {string} code - Authorization code from Strava callback
 * @returns {Promise<{ access_token: string, refresh_token: string, expires_at: number, athlete: object }>}
 */
async function exchangeToken(code) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Strava: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_REDIRECT_URI must be set in .env');
  }

  const body = new URLSearchParams({
    client_id: String(clientId),
    client_secret: clientSecret,
    code: code,
    grant_type: 'authorization_code'
  }).toString();

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.message || data.error || res.statusText;
    throw new Error(`Strava token exchange failed: ${msg}`);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete: data.athlete || {},
    scope: data.scope || SCOPE
  };
}

/**
 * Refresh access token using refresh_token. Returns new tokens; caller must persist.
 * @param {string} refreshToken
 * @returns {Promise<{ access_token: string, refresh_token: string, expires_at: number }>}
 */
async function refreshAccessToken(refreshToken) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Strava: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set');
  }
  const body = new URLSearchParams({
    client_id: String(clientId),
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }).toString();
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || res.statusText;
    throw new Error(`Strava refresh failed: ${msg}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at
  };
}

/**
 * Ensure user has a valid access token; refresh and persist if expired.
 * @param {object} userData - Firestore user doc data (must have strava object)
 * @param {object} db - Firestore instance
 * @param {object} admin - firebase-admin (for FieldValue)
 * @param {string} userId
 * @returns {Promise<string>} access token to use
 */
async function ensureValidToken(userData, db, admin, userId) {
  const strava = userData.strava;
  if (!strava || !strava.connected || !strava.refreshToken) {
    throw new Error('User has no Strava connection or refresh token');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = Number(strava.expiresAt) || 0;
  if (expiresAt - REFRESH_BUFFER_SEC > nowSec && strava.accessToken) {
    return strava.accessToken;
  }
  const tokens = await refreshAccessToken(strava.refreshToken);
  const userRef = db.collection('users').doc(String(userId));
  await userRef.set(
    {
      strava: {
        ...strava,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_at
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  return tokens.access_token;
}

/**
 * Map Strava activity to our stored shape (only fields we need).
 */
function mapActivity(raw) {
  return {
    id: raw.id,
    type: raw.type || raw.sport_type || 'Workout',
    distance: raw.distance != null ? Number(raw.distance) : null,
    moving_time: raw.moving_time != null ? Number(raw.moving_time) : null,
    average_heartrate: raw.average_heartrate != null ? Number(raw.average_heartrate) : null,
    max_heartrate: raw.max_heartrate != null ? Number(raw.max_heartrate) : null,
    suffer_score: raw.suffer_score != null ? Number(raw.suffer_score) : null,
    start_date: raw.start_date || null,
    start_date_local: raw.start_date_local || null,
    calories: raw.calories != null ? Number(raw.calories) : null
  };
}

/**
 * Fetch last 3 days of activities from Strava and store in users/{uid}/activities.
 * Uses Strava activity id as document id to avoid duplicates.
 * @param {string} userId
 * @param {object} db - Firestore
 * @param {object} admin - firebase-admin
 * @returns {Promise<{ count: number }>} number of activities stored (after sync)
 */
async function getRecentActivities(userId, db, admin) {
  if (!db) throw new Error('Firestore is not initialized');
  const userRef = db.collection('users').doc(String(userId));
  const snap = await userRef.get();
  if (!snap.exists) throw new Error('User not found');
  const userData = snap.data() || {};
  const accessToken = await ensureValidToken(userData, db, admin, userId);

  const nowSec = Math.floor(Date.now() / 1000);
  const threeDaysAgoSec = nowSec - 3 * 24 * 60 * 60;
  const params = new URLSearchParams({
    after: String(threeDaysAgoSec),
    before: String(nowSec),
    per_page: '100'
  });
  const url = `${STRAVA_ACTIVITIES_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Strava API error: ${res.status}`);
  }
  const activities = await res.json();
  if (!Array.isArray(activities)) return { count: 0 };

  const activitiesRef = userRef.collection('activities');
  let stored = 0;
  for (const raw of activities) {
    const id = String(raw.id);
    if (!id) continue;
    const mapped = mapActivity(raw);
    await activitiesRef.doc(id).set(mapped, { merge: true });
    stored++;
  }
  return { count: stored };
}

/**
 * Sync historische activiteiten van Strava (bijv. laatste 30 dagen) naar Firestore.
 * Zelfde formaat als getRecentActivities (mapActivity); voor gebruik na koppelen of in admin.
 * @param {string} userId
 * @param {object} db - Firestore
 * @param {object} admin - firebase-admin
 * @param {{ days?: number }} options - options.days = aantal dagen terug (default 30)
 * @returns {Promise<{ count: number }>} aantal opgeslagen activiteiten
 */
async function syncRecentActivities(userId, db, admin, options = {}) {
  const days = options.days ?? 30;
  if (!db) throw new Error('Firestore is not initialized');
  const userRef = db.collection('users').doc(String(userId));
  const snap = await userRef.get();
  if (!snap.exists) throw new Error('User not found');
  const userData = snap.data() || {};
  const accessToken = await ensureValidToken(userData, db, admin, userId);

  const nowSec = Math.floor(Date.now() / 1000);
  const afterSec = nowSec - days * 24 * 60 * 60;
  const params = new URLSearchParams({
    after: String(afterSec),
    per_page: '100'
  });
  const url = `${STRAVA_ACTIVITIES_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Strava API error: ${res.status}`);
  }
  const activities = await res.json();
  if (!Array.isArray(activities)) return { count: 0 };

  const activitiesRef = userRef.collection('activities');
  let stored = 0;
  for (const raw of activities) {
    const id = String(raw.id);
    if (!id) continue;
    const mapped = mapActivity(raw);
    await activitiesRef.doc(id).set(mapped, { merge: true });
    stored++;
  }
  return { count: stored };
}

const BACKOFF_MS = 15 * 60 * 1000; // 15 min (align with webhook)

/**
 * Sync activities from Strava after a given timestamp. Used by manual sync and fallback job.
 * Sets lastStravaSyncedAt on user; writes ingested_from: 'manual_sync' on each activity.
 * Respects stravaBackoffUntil; on 429 sets backoff and throws.
 * @param {string} userId
 * @param {object} db - Firestore
 * @param {object} admin - firebase-admin
 * @param {{ afterTimestamp?: number|object }} options - afterTimestamp: ms (number) or Firestore Timestamp
 * @returns {Promise<{ count: number }>}
 */
async function syncActivitiesAfter(userId, db, admin, options = {}) {
  if (!db) throw new Error('Firestore is not initialized');
  const userRef = db.collection('users').doc(String(userId));
  const snap = await userRef.get();
  if (!snap.exists) throw new Error('User not found');
  const userData = snap.data() || {};

  const backoffUntil = userData.stravaBackoffUntil;
  if (typeof backoffUntil === 'number' && backoffUntil > Date.now()) {
    throw new Error('Strava backoff active; try again later');
  }

  const accessToken = await ensureValidToken(userData, db, admin, userId);

  let afterSec = 0;
  const at = options.afterTimestamp;
  if (at != null) {
    if (typeof at === 'number') afterSec = Math.floor(at / 1000);
    else if (at && typeof at.toMillis === 'function') afterSec = Math.floor(at.toMillis() / 1000);
    else if (at && typeof at.toDate === 'function') afterSec = Math.floor(at.toDate().getTime() / 1000);
  }

  const params = new URLSearchParams({
    after: String(afterSec),
    per_page: '100'
  });
  const url = `${STRAVA_ACTIVITIES_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const statusCode = res.status;

  if (res.status === 429) {
    const backoffUntilMs = Date.now() + BACKOFF_MS;
    await userRef.set(
      {
        stravaLastError: 'Strava 429',
        stravaBackoffUntil: backoffUntilMs
      },
      { merge: true }
    );
    throw new Error('Strava rate limit (429); try again in 15 minutes');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Strava API error: ${res.status}`);
  }

  const activities = await res.json();
  const isArray = Array.isArray(activities);
  const stravaResponseMeta = { statusCode, isArray, length: isArray ? activities.length : 0 };

  if (!isArray) {
    await userRef.set({ lastStravaSyncedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { count: 0, fetched: 0, inserted: 0, skipped: 0, newestStravaActivityStartDate: null, stravaResponseMeta };
  }

  const fetched = activities.length;
  let maxStart = null;
  const activitiesRef = userRef.collection('activities');
  let stored = 0;
  for (const raw of activities) {
    const sd = raw.start_date;
    if (sd && (!maxStart || sd > maxStart)) maxStart = sd;
    const id = String(raw.id);
    if (!id) continue;
    const mapped = mapActivity(raw);
    mapped.ingested_from = 'manual_sync';
    mapped.updated_at = admin.firestore.FieldValue.serverTimestamp();
    await activitiesRef.doc(id).set(mapped, { merge: true });
    stored++;
  }
  await userRef.set(
    {
      lastStravaSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      stravaLastError: admin.firestore.FieldValue.delete()
    },
    { merge: true }
  );
  return {
    count: stored,
    fetched,
    inserted: stored,
    skipped: fetched - stored,
    newestStravaActivityStartDate: maxStart || null,
    stravaResponseMeta
  };
}

module.exports = {
  getAuthUrl,
  exchangeToken,
  refreshAccessToken,
  getRecentActivities,
  syncRecentActivities,
  syncActivitiesAfter
};
