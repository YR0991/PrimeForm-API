/**
 * Deterministic Strava backfill: last 7 days → users/{uid}/activities (upsert by activity id).
 * Used after OAuth connect and by POST /api/strava/backfill.
 */

const { enrichActivityKeys } = require('../lib/activityKeys');

const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const PER_PAGE = 200;
const FIRESTORE_BATCH_SIZE = 500;

/**
 * Fetch all activities from Strava in range [afterSec, now], paginating until empty.
 * @param {string} accessToken
 * @param {number} afterSec - Unix seconds
 * @returns {Promise<object[]>} raw Strava activity objects
 */
async function fetchActivitiesPaginated(accessToken, afterSec) {
  const all = [];
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({
      after: String(afterSec),
      per_page: String(PER_PAGE),
      page: String(page)
    });
    const url = `${STRAVA_ACTIVITIES_URL}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.status === 429) {
      const e = new Error('Strava rate limit (429)');
      e.statusCode = 429;
      throw e;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const e = new Error(body.message || `Strava API error: ${res.status}`);
      e.statusCode = res.status;
      throw e;
    }
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) break;
    all.push(...list);
    if (list.length < PER_PAGE) break;
    page++;
  }
  return all;
}

/**
 * Map raw Strava activity to canonical Firestore doc. Idempotent upsert key: activity id.
 * @param {object} raw - Strava API activity
 * @returns {object} doc for users/{uid}/activities/{activityId}
 */
function mapToCanonicalDoc(raw) {
  const startDateLocal = raw.start_date_local ?? null;
  const startDate = raw.start_date ?? null;
  const dateLocal =
    typeof startDateLocal === 'string' && startDateLocal.length >= 10
      ? startDateLocal.slice(0, 10)
      : (typeof startDate === 'string' && startDate.length >= 10 ? startDate.slice(0, 10) : null);

  return {
    source: 'strava',
    activityId: raw.id,
    start_date: startDate,
    start_date_local: startDateLocal,
    timezone: raw.timezone ?? null,
    type: raw.type ?? raw.sport_type ?? 'Workout',
    name: raw.name ?? null,
    distance: raw.distance != null ? Number(raw.distance) : null,
    moving_time: raw.moving_time != null ? Number(raw.moving_time) : null,
    elapsed_time: raw.elapsed_time != null ? Number(raw.elapsed_time) : null,
    total_elevation_gain: raw.total_elevation_gain != null ? Number(raw.total_elevation_gain) : null,
    average_heartrate: raw.average_heartrate != null ? Number(raw.average_heartrate) : null,
    max_heartrate: raw.max_heartrate != null ? Number(raw.max_heartrate) : null,
    suffer_score: raw.suffer_score != null ? Number(raw.suffer_score) : null,
    dateLocal: dateLocal ?? null,
    date: dateLocal ?? null
  };
}

/**
 * Backfill last 7 days of Strava activities into users/{uid}/activities.
 * Idempotent: uses Strava activity id as document id, merge: true.
 * Batches Firestore writes (max 500 per batch).
 * @param {object} opts - { db, admin, uid, accessToken, profile }
 * @returns {Promise<{ fetched: number, upserted: number }>}
 */
async function backfillLast7Days(opts) {
  const { db, admin, uid, accessToken, profile } = opts;
  if (!db || !uid || !accessToken) {
    throw new Error('backfillLast7Days: db, uid, and accessToken are required');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const afterSec = nowSec - 7 * 24 * 60 * 60;

  const rawActivities = await fetchActivitiesPaginated(accessToken, afterSec);
  const fetched = rawActivities.length;

  const timezone =
    (profile && (profile.timezone || profile.timeZone)) || 'Europe/Amsterdam';
  const activitiesRef = db.collection('users').doc(String(uid)).collection('activities');

  const docs = [];
  for (const raw of rawActivities) {
    const id = String(raw.id);
    if (!id) continue;
    const doc = mapToCanonicalDoc(raw);
    const enriched = enrichActivityKeys(doc, timezone);
    docs.push({ id, data: enriched });
  }

  let upserted = 0;
  for (let i = 0; i < docs.length; i += FIRESTORE_BATCH_SIZE) {
    const chunk = docs.slice(i, i + FIRESTORE_BATCH_SIZE);
    const batch = db.batch();
    for (const { id, data } of chunk) {
      batch.set(activitiesRef.doc(id), data, { merge: true });
      upserted++;
    }
    await batch.commit();
  }

  return { fetched, upserted };
}

module.exports = {
  backfillLast7Days,
  fetchActivitiesPaginated,
  mapToCanonicalDoc
};
