/**
 * Canonical activity day (YYYY-MM-DD) and relative day labels for copy (vandaag/gisteren/op datum).
 * Prefer start_date_local over start_date to avoid UTC vs local day mismatch.
 */

/**
 * Return YYYY-MM-DD for an activity with priority: activity.date → start_date_local → start_date.
 * @param {object} activity - Has date?, start_date_local?, start_date?
 * @returns {string|null} YYYY-MM-DD or null
 */
function getActivityDay(activity) {
  if (!activity || typeof activity !== 'object') return null;

  if (activity.date != null) {
    const d = activity.date;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    if (typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
    if (d instanceof Date) return d.toISOString().slice(0, 10);
  }

  const fromLocal = activity.start_date_local;
  if (fromLocal != null) {
    if (typeof fromLocal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fromLocal)) return fromLocal.slice(0, 10);
    if (typeof fromLocal.toDate === 'function') return fromLocal.toDate().toISOString().slice(0, 10);
  }

  const fromUtc = activity.start_date;
  if (fromUtc != null) {
    if (typeof fromUtc === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fromUtc)) return fromUtc.slice(0, 10);
    if (typeof fromUtc.toDate === 'function') return fromUtc.toDate().toISOString().slice(0, 10);
    if (typeof fromUtc === 'number') return new Date(fromUtc * 1000).toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Add days to YYYY-MM-DD, return YYYY-MM-DD.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} delta - days to add (negative for past)
 * @returns {string} YYYY-MM-DD
 */
function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Relative day label for copy: "vandaag" | "gisteren" | "op YYYY-MM-DD".
 * @param {string|null} activityDay - YYYY-MM-DD (from getActivityDay)
 * @param {string} briefDay - YYYY-MM-DD (the day of the brief/check-in)
 * @returns {string} "vandaag" | "gisteren" | "op YYYY-MM-DD"
 */
function relativeDayLabel(activityDay, briefDay) {
  if (!activityDay || !briefDay) return activityDay ? `op ${activityDay}` : 'onbekend';
  if (activityDay === briefDay) return 'vandaag';
  const yesterday = addDays(briefDay, -1);
  if (activityDay === yesterday) return 'gisteren';
  return `op ${activityDay}`;
}

module.exports = { getActivityDay, relativeDayLabel, addDays };
