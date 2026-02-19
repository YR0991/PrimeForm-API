/**
 * Day-keys (YYYY-MM-DD) in Europe/Amsterdam. Single source for consistent "today"/"yesterday"
 * and window boundaries across dashboard, daily check-in, and report engine.
 * Uses Intl only; no extra dependencies.
 */

const TZ = 'Europe/Amsterdam';

/**
 * Current date in Europe/Amsterdam as YYYY-MM-DD.
 * @returns {string}
 */
function todayAmsterdamStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Yesterday in Europe/Amsterdam as YYYY-MM-DD.
 * @returns {string}
 */
function yesterdayAmsterdamStr() {
  return addDaysAmsterdamStr(todayAmsterdamStr(), -1);
}

/**
 * Add calendar days to an Amsterdam day-key; returns YYYY-MM-DD in Europe/Amsterdam.
 * @param {string} isoYYYYMMDD - YYYY-MM-DD (treated as calendar day in Amsterdam)
 * @param {number} deltaDays - days to add (negative for past)
 * @returns {string} YYYY-MM-DD
 */
function addDaysAmsterdamStr(isoYYYYMMDD, deltaDays) {
  if (!isoYYYYMMDD || typeof isoYYYYMMDD !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoYYYYMMDD.trim())) {
    return isoYYYYMMDD || '';
  }
  const s = isoYYYYMMDD.trim().slice(0, 10);
  const d = new Date(s + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Current instant (same as new Date(); for callers that want a named "now" in Amsterdam context).
 * For day-key use todayAmsterdamStr() / yesterdayAmsterdamStr() / addDaysAmsterdamStr.
 * @returns {Date}
 */
function nowAmsterdam() {
  return new Date();
}

module.exports = {
  todayAmsterdamStr,
  yesterdayAmsterdamStr,
  addDaysAmsterdamStr,
  nowAmsterdam
};
