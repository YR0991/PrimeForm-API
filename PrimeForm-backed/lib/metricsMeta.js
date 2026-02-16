/**
 * users/{uid}.metricsMeta — load-metrics cache invalidation.
 * When activities change (delete, Strava sync), mark load metrics stale.
 * When live-load-metrics is computed (GET or refresh), clear stale and set computedAt.
 */

/** Stale reason enum for loadMetricsStaleReason */
const STALE_REASONS = {
  ADMIN_DELETE: 'ADMIN_DELETE',
  USER_DELETE: 'USER_DELETE',
  STRAVA_SYNC: 'STRAVA_SYNC'
};

/**
 * Mark user's load metrics as stale (e.g. after activity delete or Strava sync).
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} admin - Firebase admin (for Timestamp)
 * @param {string} uid - User document ID
 * @param {string} reason - One of ADMIN_DELETE | USER_DELETE | STRAVA_SYNC
 */
async function markLoadMetricsStale(db, admin, uid, reason) {
  if (!db || !uid) return;
  const ref = db.collection('users').doc(String(uid));
  const now = admin.firestore.Timestamp.now();
  await ref.set(
    {
      metricsMeta: {
        loadMetricsStale: true,
        loadMetricsStaleAt: now,
        loadMetricsStaleReason: reason
      }
    },
    { merge: true }
  );
}

/**
 * Clear stale and set computed state (after live-load-metrics has been computed).
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} admin - Firebase admin (for Timestamp)
 * @param {string} uid - User document ID
 * @param {{ windowDays: number }} opts - windowDays used for the computation
 */
async function clearLoadMetricsStale(db, admin, uid, opts = {}) {
  if (!db || !uid) return;
  const ref = db.collection('users').doc(String(uid));
  const now = admin.firestore.Timestamp.now();
  const windowDays = opts.windowDays != null ? Number(opts.windowDays) : 28;
  await ref.set(
    {
      metricsMeta: {
        loadMetricsStale: false,
        loadMetricsStaleAt: null,
        loadMetricsStaleReason: null,
        loadMetricsComputedAt: now,
        loadMetricsWindowDays: windowDays
      }
    },
    { merge: true }
  );
}

module.exports = {
  STALE_REASONS,
  markLoadMetricsStale,
  clearLoadMetricsStale
};
