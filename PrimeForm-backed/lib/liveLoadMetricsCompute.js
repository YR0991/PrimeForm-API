/**
 * Live load metrics computation from activity list (sum7, sum28, ACWR).
 * Used by GET /api/admin/users/:uid/live-load-metrics.
 * Filtering: includeInAcwr !== false (missing => true); null/non-finite load excluded.
 */

const { addDays } = require('./activityDate');
const { calculateACWR } = require('../services/calculationService');

function acwrBandString(acwr) {
  if (acwr == null || !Number.isFinite(acwr)) return null;
  const v = Number(acwr);
  if (v < 0.8) return '<0.8';
  if (v <= 1.3) return '0.8-1.3';
  if (v <= 1.5) return '1.3-1.5';
  return '>1.5';
}

/** Canonical load for sums: loadUsed when set, else _primeLoad, else prime_load. (null/non-finite => excluded by caller). */
function getLoadUsed(a) {
  if (a.loadUsed != null && Number.isFinite(Number(a.loadUsed))) return Number(a.loadUsed);
  if (a._primeLoad != null && Number.isFinite(a._primeLoad)) return a._primeLoad;
  if (a.prime_load != null && Number.isFinite(Number(a.prime_load))) return Number(a.prime_load);
  return null;
}

/** @deprecated Use getLoadUsed; kept for backward compat. */
function loadOf(a) {
  const u = getLoadUsed(a);
  return u != null ? u : Number(a.prime_load);
}

function dayKeyStr(a) {
  return (a._dateStr || a.dayKey || (a.start_date_local && String(a.start_date_local).slice(0, 10)) || (a.start_date && String(a.start_date).slice(0, 10)) || (a.date && String(a.date).slice(0, 10)) || '').slice(0, 10);
}

/**
 * Compute live load metrics from activity list.
 * - includeInAcwr missing => treated as true; includeInAcwr === false excluded.
 * - null or non-finite load excluded (do not count as 0).
 * @param {Array<object>} activities - Each may have loadUsed, _dateStr/dayKey, _primeLoad/prime_load, loadRaw, loadSource, includeInAcwr
 * @param {{ todayStr: string, windowDays: number, timezone?: string }} opts - todayStr YYYY-MM-DD, windowDays 28 or 56
 * @returns {{ sum7, sum28, acute, chronic, acwr, acwrBand, contributors7d, counts, debug }}
 */
function computeFromActivities(activities, opts = {}) {
  const todayStr = opts.todayStr || new Date().toISOString().slice(0, 10);
  const windowDays = Math.min(56, Math.max(28, Number(opts.windowDays) || 28));
  const startDate = addDays(todayStr, -windowDays + 1);
  const sevenDaysAgoStr = addDays(todayStr, -6);
  const rawList = activities || [];

  // includeInAcwr missing => true
  const forAcwr = rawList.filter((a) => a.includeInAcwr !== false);
  const withLoad = forAcwr.filter((a) => {
    const load = getLoadUsed(a);
    return load != null && Number.isFinite(load);
  });

  const last7 = withLoad.filter((a) => dayKeyStr(a) >= sevenDaysAgoStr);
  const last28 = withLoad.filter((a) => dayKeyStr(a) >= startDate);

  const missingDayKey = rawList.filter((a) => dayKeyStr(a).length < 10).length;
  const outsideWindow = withLoad.filter((a) => {
    const d = dayKeyStr(a);
    return d.length >= 10 && (d < startDate || d > todayStr);
  }).length;

  const sum7 = last7.reduce((s, a) => s + getLoadUsed(a), 0);
  const sum28 = last28.reduce((s, a) => s + getLoadUsed(a), 0);
  const weeklyAvg28 = sum28 > 0 ? sum28 / 4 : 0;
  const chronic = weeklyAvg28;
  const acwr = chronic > 0 && Number.isFinite(sum7) ? Math.round(calculateACWR(sum7, chronic) * 100) / 100 : null;
  const band = acwrBandString(acwr);

  const contributors7d = [...last7]
    .sort((a, b) => getLoadUsed(b) - getLoadUsed(a))
    .slice(0, 5)
    .map((a) => ({
      activityId: a.id ?? null,
      dayKey: dayKeyStr(a) || null,
      loadUsed: getLoadUsed(a),
      loadRaw: a.loadRaw ?? (a.suffer_score != null ? Number(a.suffer_score) : null),
      loadSource: a.loadSource ?? a.source ?? null,
      includeInAcwr: a.includeInAcwr !== false,
      // backward compat for UI
      id: a.id ?? null,
      date: dayKeyStr(a) || null,
      type: a.type || 'Session',
      load: getLoadUsed(a),
      source: a.loadSource ?? a.source ?? null
    }));

  return {
    sum7,
    sum28,
    acute: { sum7, count7: last7.length },
    chronic: { sum28, weeklyAvg28, count28: last28.length },
    chronicRounded: chronic > 0 ? Math.round(chronic * 100) / 100 : 0,
    acwr,
    acwrBand: band,
    contributors7d,
    counts: {
      fetched: rawList.length,
      used7: last7.length,
      used28: last28.length,
      filteredOut: {
        includeInAcwrFalse: rawList.length - forAcwr.length,
        nonFiniteLoad: forAcwr.length - withLoad.length,
        missingDayKeyOrStartDateTs: missingDayKey,
        outsideWindow
      }
    },
    debug: {
      dateWindowUsed: { from: startDate, to: todayStr, sevenDaysAgoStr },
      loadFieldUsed: 'loadUsed',
      activityDayKeyUsed: '_dateStr ?? dayKey ?? start_date_local ?? start_date ?? date',
      windowDays,
      timezoneUsed: opts.timezone ?? null
    }
  };
}

module.exports = {
  computeFromActivities,
  getLoadUsed,
  loadOf,
  acwrBandString
};
