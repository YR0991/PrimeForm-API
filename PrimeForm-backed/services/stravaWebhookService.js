/**
 * Strava Webhook event handling: resolve user by athlete_id, refresh token, fetch activity, upsert to users/{uid}/activities.
 * Observability: one log line per event; user stravaLastWebhookAt/stravaLastWebhookEvent/stravaLastError; activity ingestion.
 */

const stravaService = require('./stravaService');
const { markLoadMetricsStale } = require('../lib/metricsMeta');
const { enrichActivityKeys } = require('../lib/activityKeys');

const STRAVA_ACTIVITY_URL = 'https://www.strava.com/api/v3/activities';

/**
 * Find Firestore uid by Strava athlete (owner) id.
 * Requires Firestore index on users: strava.athleteId (asc).
 * @param {object} db - Firestore
 * @param {number|string} ownerId - Strava athlete id
 * @returns {Promise<string|null>} uid or null
 */
async function findUidByStravaAthleteId(db, ownerId) {
  if (ownerId == null || ownerId === '') return null;
  const num = Number(ownerId);
  if (!Number.isFinite(num)) return null;
  const snap = await db.collection('users').where('strava.athleteId', '==', num).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

/**
 * Fetch single activity from Strava API.
 * @param {string} accessToken
 * @param {number|string} activityId
 * @returns {Promise<object>} raw activity
 */
async function fetchStravaActivity(accessToken, activityId) {
  const url = `${STRAVA_ACTIVITY_URL}/${activityId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (res.status === 429) {
    const e = new Error('Strava rate limit (429)');
    e.status = 429;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.errors?.[0]?.message || res.statusText;
    const e = new Error(`Strava API: ${msg}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/**
 * Build activity document for Firestore (create/update). Idempotent upsert keyed by object_id.
 * Caller adds ingestion + imported_at/updated_at with serverTimestamp() when writing.
 */
function buildActivityDoc(raw, ownerId) {
  const movingTime = raw.moving_time != null ? Number(raw.moving_time) : null;
  const elapsedTime = raw.elapsed_time != null ? Number(raw.elapsed_time) : null;
  const durationMinutes =
    elapsedTime != null ? Math.round((elapsedTime / 60) * 10) / 10 : (movingTime != null ? Math.round((movingTime / 60) * 10) / 10 : null);

  const startDateLocal = raw.start_date_local || null;
  const startDate = raw.start_date || null;
  const dateCanonical =
    (startDateLocal && typeof startDateLocal === 'string' && startDateLocal.slice(0, 10)) ||
    (startDate && typeof startDate === 'string' && startDate.slice(0, 10)) ||
    null;

  return {
    source: 'strava',
    strava_id: raw.id != null ? Number(raw.id) : null,
    athlete_id: ownerId != null ? Number(ownerId) : null,
    name: typeof raw.name === 'string' ? raw.name : null,
    type: raw.type || raw.sport_type || 'Workout',
    start_date: startDate,
    start_date_local: startDateLocal,
    date: dateCanonical,
    moving_time: movingTime,
    elapsed_time: elapsedTime,
    distance: raw.distance != null ? Number(raw.distance) : null,
    duration_minutes: durationMinutes,
    suffer_score: raw.suffer_score != null ? Number(raw.suffer_score) : null,
    average_heartrate: raw.average_heartrate != null ? Number(raw.average_heartrate) : null,
    max_heartrate: raw.max_heartrate != null ? Number(raw.max_heartrate) : null,
    raw: {
      type: raw.type || raw.sport_type,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 200) : undefined
    }
  };
}

/**
 * Handle one Strava webhook event. Only object_type === 'activity' is processed.
 * @param {object} opts - { db, admin, payload }
 * @returns {Promise<{ ok: boolean }>}
 */
async function handleStravaWebhookEvent({ db, admin, payload }) {
  const start = Date.now();
  let uid = null;
  const owner_id = payload?.owner_id;
  const object_id = payload?.object_id;
  const object_type = payload?.object_type;
  const aspect_type = payload?.aspect_type;

  const logLine = (ok) => {
    const ms = Date.now() - start;
    console.log(
      `[STRAVA_WEBHOOK] uid=${uid ?? 'none'} athlete=${owner_id ?? '-'} act=${object_id ?? '-'} type=${aspect_type ?? '-'} ok=${ok} ms=${ms}`
    );
  };

  if (!payload || typeof payload !== 'object') {
    logLine(false);
    return { ok: false };
  }

  if (object_type !== 'activity') {
    logLine(true); // ignore athlete events etc.; still "ok"
    return { ok: true };
  }

  if (object_id == null || owner_id == null) {
    logLine(false);
    return { ok: false };
  }

  uid = await findUidByStravaAthleteId(db, owner_id);
  if (!uid) {
    console.warn(`[STRAVA_WEBHOOK] unmapped owner_id=${owner_id}`);
    logLine(false);
    return { ok: false };
  }

  const userRef = db.collection('users').doc(String(uid));
  const activityRef = userRef.collection('activities').doc(String(object_id));
  const receivedAt = admin.firestore.FieldValue.serverTimestamp();

  /** 429 backoff: do not call Strava API while backoff active. */
  const BACKOFF_MS = 15 * 60 * 1000; // 15 min

  const updateUserWebhookMeta = (eventType, errorStr = null, backoffUntilMs = null) => {
    const patch = {
      stravaLastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
      stravaLastWebhookEvent: { event_type: eventType, object_id: Number(object_id) }
    };
    if (errorStr != null) patch.stravaLastError = String(errorStr).slice(0, 500);
    if (backoffUntilMs != null) patch.stravaBackoffUntil = backoffUntilMs;
    return userRef.set(patch, { merge: true });
  };

  try {
    if (aspect_type === 'delete') {
      await activityRef.set(
        {
          deleted: true,
          deleted_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      await markLoadMetricsStale(db, admin, uid, 'STRAVA_SYNC');
      await updateUserWebhookMeta('delete');
      logLine(true);
      return { ok: true };
    }

    if (aspect_type !== 'create' && aspect_type !== 'update') {
      logLine(true);
      return { ok: true };
    }

    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      await updateUserWebhookMeta(aspect_type, 'User doc not found');
      logLine(false);
      return { ok: false };
    }
    const userData = userSnap.data() || {};
    const backoffUntil = userData.stravaBackoffUntil;
    if (typeof backoffUntil === 'number' && backoffUntil > Date.now()) {
      console.warn('[STRAVA_WEBHOOK] backoff active, skipping fetch');
      await updateUserWebhookMeta(aspect_type, 'Skipped (backoff)');
      logLine(false);
      return { ok: false };
    }
    let accessToken;
    try {
      accessToken = await stravaService.ensureValidToken(userData, db, admin, uid);
    } catch (err) {
      const errMsg = err.message || 'Token refresh failed';
      await updateUserWebhookMeta(aspect_type, errMsg);
      logLine(false);
      return { ok: false };
    }

    let raw;
    const fetchedAt = admin.firestore.FieldValue.serverTimestamp();
    try {
      raw = await fetchStravaActivity(accessToken, object_id);
    } catch (err) {
      if (err.status === 429) {
        const backoffUntilMs = Date.now() + BACKOFF_MS;
        console.warn('[STRAVA_WEBHOOK] Strava 429 rate limit, setting backoff until', new Date(backoffUntilMs).toISOString());
        await updateUserWebhookMeta(aspect_type, 'Strava 429', backoffUntilMs);
      } else {
        await updateUserWebhookMeta(aspect_type, err.message || 'Strava API failed');
      }
      logLine(false);
      return { ok: false };
    }

    const nowTs = admin.firestore.FieldValue.serverTimestamp();
    const ingestion = {
      source: 'webhook',
      received_at: receivedAt,
      fetched_at: fetchedAt,
      upserted_at: nowTs
    };
    const doc = buildActivityDoc(raw, owner_id);
    doc.imported_at = nowTs;
    doc.updated_at = nowTs;
    doc.ingestion = ingestion;
    const timezone = userData.profile?.timezone || userData.profile?.timeZone || 'Europe/Amsterdam';
    const withKeys = enrichActivityKeys(doc, timezone);
    await activityRef.set(withKeys, { merge: true });
    await markLoadMetricsStale(db, admin, uid, 'STRAVA_SYNC');
    await updateUserWebhookMeta(aspect_type);
    logLine(true);
    return { ok: true };
  } catch (err) {
    console.error('[STRAVA_WEBHOOK]', err.message);
    const errStr = err.message || 'Unknown error';
    await userRef.set({ stravaLastError: errStr.slice(0, 500) }, { merge: true }).catch(() => {});
    logLine(false);
    return { ok: false };
  }
}

module.exports = { handleStravaWebhookEvent, findUidByStravaAthleteId, fetchStravaActivity, buildActivityDoc };
