/**
 * Queryable activity fields: startDateTs (ms UTC), dayKey (YYYY-MM-DD in athlete timezone).
 * Used for range queries and ACWR windowing. includeInAcwr default true when missing.
 */

let timezoneDefaultLogged = false;

/**
 * Derive start timestamp in milliseconds (UTC epoch) from activity.
 * Prefer start_date_local or start_date (ISO string or Unix seconds).
 * @param {object} activity - Has start_date_local?, start_date?, date?
 * @returns {number} ms since epoch, or 0 if unparseable
 */
function deriveStartDateTs(activity) {
  if (!activity || typeof activity !== 'object') return 0;
  if (activity.startDateTs != null && Number.isFinite(Number(activity.startDateTs))) return Number(activity.startDateTs);
  const fromLocal = activity.start_date_local;
  const fromUtc = activity.start_date;
  const fromDate = activity.date;

  let ms = NaN;
  if (fromLocal != null) {
    if (typeof fromLocal === 'string') ms = new Date(fromLocal).getTime();
    else if (typeof fromLocal.toDate === 'function') ms = fromLocal.toDate().getTime();
    else if (typeof fromLocal === 'number') ms = fromLocal * 1000;
  }
  if (!Number.isFinite(ms) && fromUtc != null) {
    if (typeof fromUtc === 'string') ms = new Date(fromUtc).getTime();
    else if (typeof fromUtc.toDate === 'function') ms = fromUtc.toDate().getTime();
    else if (typeof fromUtc === 'number') ms = fromUtc * 1000;
  }
  if (!Number.isFinite(ms) && fromDate != null) {
    if (typeof fromDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fromDate)) ms = new Date(fromDate + 'T12:00:00Z').getTime();
    else if (typeof fromDate.toDate === 'function') ms = fromDate.toDate().getTime();
    else if (fromDate instanceof Date) ms = fromDate.getTime();
  }
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Derive day key YYYY-MM-DD in athlete timezone. Used for ACWR windowing.
 * Prefer start_date_local (Strava/local already in athlete TZ); else convert startDateTs with timezone.
 * Missing timezone => UTC (log once).
 * @param {object} activity - Has start_date_local?, start_date?, date?
 * @param {string} [timezone] - IANA timezone (e.g. 'Europe/Amsterdam'). Omit => UTC.
 * @returns {string} YYYY-MM-DD
 */
function deriveDayKey(activity, timezone) {
  if (!activity || typeof activity !== 'object') return '';

  // Prefer start_date_local (already in athlete's local time)
  const fromLocal = activity.start_date_local;
  if (fromLocal != null) {
    if (typeof fromLocal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fromLocal)) return fromLocal.slice(0, 10);
    if (typeof fromLocal.toDate === 'function') return fromLocal.toDate().toISOString().slice(0, 10);
  }

  const ts = deriveStartDateTs(activity);
  if (!ts) return '';

  const tz = timezone && String(timezone).trim() ? String(timezone).trim() : null;
  if (!tz) {
    if (!timezoneDefaultLogged) {
      timezoneDefaultLogged = true;
      console.warn('[activityKeys] timezone missing for deriveDayKey, using UTC');
    }
    return new Date(ts).toISOString().slice(0, 10);
  }

  try {
    const d = new Date(ts);
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = formatter.formatToParts(d);
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const day = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${day}`;
  } catch (e) {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

/**
 * Enrich activity payload with startDateTs, dayKey, includeInAcwr for Firestore writes.
 * @param {object} payload - Activity fields (e.g. from mapActivity or buildActivityDoc)
 * @param {string} [timezone] - IANA timezone for dayKey
 * @returns {object} payload with startDateTs (number), dayKey (string), includeInAcwr (default true)
 */
function enrichActivityKeys(payload, timezone) {
  if (!payload || typeof payload !== 'object') return payload;
  const startDateTs = deriveStartDateTs(payload);
  const dayKey = deriveDayKey(payload, timezone);
  return {
    ...payload,
    startDateTs: startDateTs || undefined,
    dayKey: dayKey || undefined,
    includeInAcwr: payload.includeInAcwr === false ? false : true
  };
}

module.exports = {
  deriveStartDateTs,
  deriveDayKey,
  enrichActivityKeys
};
