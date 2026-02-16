/**
 * Daily Brief Service — Single aggregator for "Today-first" athlete dashboard brief.
 * Builds PrimeFormDailyBrief from reportService, Firestore (users, dailyLogs, activities), and heuristics.
 */

const reportService = require('./reportService');
const cycleService = require('./cycleService');
const { calculateActivityLoad, calculatePrimeLoad } = require('./calculationService');
const { computeStatus, tagToSignal } = require('./statusEngine');

/** Meta-versies voor PrimeFormDailyBrief (hardcoded; zie docs/DAILY_BRIEF_SCHEMA.md) */
const ENGINE_VERSION = process.env.PRIMEFORM_ENGINE_VERSION || '1.0.0';
const SCHEMA_VERSION = process.env.PRIMEFORM_BRIEF_SCHEMA_VERSION || '1.0';
const KB_VERSION = process.env.PRIMEFORM_KB_VERSION || '1.0';

/** Add days to YYYY-MM-DD, return YYYY-MM-DD */
function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Activity date string (start_date_local or start_date) */
function activityDateString(a) {
  const raw = a.start_date_local ?? a.start_date;
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

/** Root activity date (date field) */
function toIsoDateString(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (typeof val.toDate === 'function') return val.toDate().toISOString().slice(0, 10);
  if (typeof val === 'number') return new Date(val * 1000).toISOString().slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

/** ACWR -> band: LOW | SWEET | OVERREACHING | SPIKE */
function acwrBand(acwr) {
  if (acwr == null || !Number.isFinite(acwr)) return null;
  const v = Number(acwr);
  if (v < 0.8) return 'LOW';
  if (v <= 1.3) return 'SWEET';
  if (v <= 1.5) return 'OVERREACHING';
  return 'SPIKE';
}

/** signal from tag (re-export for fallback path) */
function signalFromTag(tag) {
  return tagToSignal(tag);
}

/**
 * Cycle mode from profile. Uses canonical contraceptionMode when present (Route B); else falls back to contraception string.
 * Only NATURAL + lastPeriodDate allow phaseDay and cycle overrides (Lethargy/Elite).
 */
function cycleMode(profile) {
  const cd = profile && profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  const mode = cd.contraceptionMode;
  if (mode === 'NATURAL' || mode === 'HBC_OTHER' || mode === 'COPPER_IUD' || mode === 'HBC_LNG_IUD' || mode === 'UNKNOWN') {
    return mode;
  }
  const contraception = (cd.contraception || '').toLowerCase();
  if (contraception.includes('lng') || (contraception.includes('spiraal') && contraception.includes('hormonaal'))) return 'HBC_LNG_IUD';
  if (contraception.includes('koper')) return 'COPPER_IUD';
  if (contraception.includes('pil') || contraception.includes('patch') || contraception.includes('ring') || contraception.length > 0) return 'HBC_OTHER';
  if (contraception === '' && cd.lastPeriodDate) return 'NATURAL';
  return 'UNKNOWN';
}

/**
 * Cycle confidence: only NATURAL + lastPeriodDate => HIGH (phaseDay allowed; Lethargy/Elite overrides may apply).
 * All other modes => LOW (phaseDay absent; cycle overrides must not trigger).
 */
function cycleConfidence(mode, profile) {
  if (mode !== 'NATURAL') return 'LOW';
  const cd = profile && profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  if (!cd.lastPeriodDate) return 'MED';
  return 'HIGH';
}

/** Canonical dailyLog source enum: "checkin" | "import" | "strava". Legacy imported=true maps to source="import". */
function normalizeSource(d) {
  if (d.source === 'checkin' || d.source === 'import' || d.source === 'strava') return d.source;
  if (d.imported === true) return 'import';
  return d.source ?? undefined;
}

/**
 * Normalize a raw dailyLog doc to brief shape (metrics, source, imported).
 * Legacy: missing source + imported=true → source="import".
 */
function normalizeDailyLogDoc(d) {
  const metrics = d.metrics || {};
  const hrv = typeof metrics.hrv === 'object' && metrics.hrv && metrics.hrv.current != null ? metrics.hrv.current : (typeof metrics.hrv === 'number' ? metrics.hrv : null);
  const rhr = typeof metrics.rhr === 'object' && metrics.rhr && metrics.rhr.current != null ? metrics.rhr.current : (metrics.rhr != null ? metrics.rhr : null);
  const source = normalizeSource(d);
  return {
    metrics: { hrv, rhr, sleep: metrics.sleep != null ? metrics.sleep : null, readiness: metrics.readiness != null ? metrics.readiness : null },
    recommendation: d.recommendation || null,
    aiMessage: d.aiMessage != null ? d.aiMessage : null,
    cycleInfo: d.cycleInfo || null,
    isSick: d.isSick === true,
    source,
    imported: d.imported === true
  };
}

/**
 * Pick the daily log that should drive "today" advice. Baseline import (source="import") must NOT drive advice.
 * Eligible only if: source === "checkin" OR (legacy: readiness finite AND imported !== true).
 * @param {Array<object>} dailyLogs - Normalized logs for the date
 * @param {string} todayDate - YYYY-MM-DD
 * @returns {object|null} - Selected log or null if no valid check-in
 */
function selectTodayCheckin(dailyLogs, todayDate) {
  if (!Array.isArray(dailyLogs) || dailyLogs.length === 0) return null;
  const valid = dailyLogs.filter((log) => {
    if (log.source === 'import') return false;
    if (log.source === 'checkin') return Number.isFinite(Number(log.metrics && log.metrics.readiness));
    return log.imported !== true && Number.isFinite(Number(log.metrics && log.metrics.readiness));
  });
  if (valid.length === 0) return null;
  const checkin = valid.find((l) => l.source === 'checkin');
  return checkin != null ? checkin : valid[0];
}

/**
 * Fetch dailyLog for a single date from users/{uid}/dailyLogs.
 * Returns the log that should drive today's advice (check-in preferred; imported logs excluded).
 */
async function getDailyLogForDate(db, uid, dateISO) {
  const snap = await db
    .collection('users')
    .doc(String(uid))
    .collection('dailyLogs')
    .where('date', '==', dateISO)
    .get();
  if (snap.empty) return null;
  const logs = snap.docs.map((doc) => normalizeDailyLogDoc(doc.data() || {}));
  return selectTodayCheckin(logs, dateISO);
}

/**
 * Fetch dailyLogs in date range [startDate, endDate] (inclusive). Returns array of { date, hrv, rhr, hasCheckin, hasImport, hasStrava, readiness, sleep, isSick }.
 * Baseline: include ALL qualified metrics (checkin + import + strava); merge by date so any log with finite hrv/rhr contributes.
 * sourceSummary: hasCheckin, hasImport, hasStrava. readiness/sleep/isSick from checkin log if present, else from any log.
 */
async function getDailyLogsInRange(db, uid, startDate, endDate) {
  const snap = await db
    .collection('users')
    .doc(String(uid))
    .collection('dailyLogs')
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();
  const byDate = new Map();
  snap.docs.forEach((doc) => {
    const d = doc.data() || {};
    const date = (d.date || '').slice(0, 10);
    if (!date) return;
    const metrics = d.metrics || {};
    const hrv = typeof metrics.hrv === 'number' ? metrics.hrv : (metrics.hrv && metrics.hrv.current) ?? null;
    const rhr = metrics.rhr != null ? (typeof metrics.rhr === 'object' ? metrics.rhr.current : metrics.rhr) : null;
    const hrvNum = hrv != null && Number.isFinite(Number(hrv)) ? Number(hrv) : null;
    const rhrNum = rhr != null && Number.isFinite(Number(rhr)) ? Number(rhr) : null;
    const src = normalizeSource(d);
    const hasCheckin = src === 'checkin' || (src !== 'import' && d.imported !== true && Number.isFinite(Number(metrics.readiness)));
    const hasImport = src === 'import' || d.imported === true;
    const hasStrava = src === 'strava';
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        hrv: null,
        rhr: null,
        hasCheckin: false,
        hasImport: false,
        hasStrava: false,
        readiness: null,
        sleep: null,
        isSick: null
      });
    }
    const row = byDate.get(date);
    if (hrvNum != null) row.hrv = hrvNum;
    if (rhrNum != null) row.rhr = rhrNum;
    if (hasCheckin) row.hasCheckin = true;
    if (hasImport) row.hasImport = true;
    if (hasStrava) row.hasStrava = true;
    if (hasCheckin && metrics.readiness != null && Number.isFinite(Number(metrics.readiness))) row.readiness = Number(metrics.readiness);
    else if (row.readiness == null && metrics.readiness != null && Number.isFinite(Number(metrics.readiness))) row.readiness = Number(metrics.readiness);
    if (hasCheckin && metrics.sleep != null && Number.isFinite(Number(metrics.sleep))) row.sleep = Number(metrics.sleep);
    else if (row.sleep == null && metrics.sleep != null && Number.isFinite(Number(metrics.sleep))) row.sleep = Number(metrics.sleep);
    if (hasCheckin && d.isSick === true) row.isSick = true;
    else if (row.isSick != null && row.isSick !== true && d.isSick === true) row.isSick = true;
  });
  return Array.from(byDate.values());
}

/**
 * Fetch activities in date range (users/{uid}/activities + root activities), with prime load for 7d stats.
 */
async function getActivitiesInRange(db, uid, startDate, endDate, profile, admin) {
  const [userSnap, rootSnap] = await Promise.all([
    db.collection('users').doc(String(uid)).collection('activities').get(),
    db.collection('activities').where('userId', '==', String(uid)).get()
  ]);
  const list = [];
  userSnap.docs.forEach((doc) => list.push({ ...doc.data(), id: doc.id }));
  rootSnap.docs.forEach((doc) => list.push({ ...doc.data(), id: doc.id }));
  const cycleData = profile && profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  const lastPeriodDate = cycleData.lastPeriodDate || null;
  const cycleLength = Number(cycleData.avgDuration) || 28;
  const maxHr = profile && profile.max_heart_rate != null ? Number(profile.max_heart_rate) : null;
  const out = [];
  for (const a of list) {
    const dateStr = a.start_date_local != null || a.start_date != null ? activityDateString(a) : toIsoDateString(a.date);
    if (!dateStr || dateStr < startDate || dateStr > endDate) continue;
    let primeLoad = a.prime_load != null && Number.isFinite(Number(a.prime_load)) ? Number(a.prime_load) : null;
    if (primeLoad == null && (a.source === 'manual' || a.suffer_score == null) && a.prime_load != null) primeLoad = Number(a.prime_load);
    if (primeLoad == null) {
      const rawLoad = calculateActivityLoad(a, profile || {});
      const phaseInfo = lastPeriodDate && dateStr ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, dateStr) : { phaseName: null };
      const readinessScore = 10;
      const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
      primeLoad = calculatePrimeLoad(rawLoad, phaseInfo.phaseName, readinessScore, avgHr, maxHr);
    }
    const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
    const hard = maxHr && avgHr ? avgHr / maxHr >= 0.85 : (a.suffer_score != null && Number(a.suffer_score) >= 80);
    out.push({ ...a, _dateStr: dateStr, _primeLoad: primeLoad, _hard: !!hard });
  }
  return out;
}

/**
 * Build comparisons: HRV and RHR current 7d vs previous 7d from dailyLogs.
 * current window = [dateISO-6, dateISO], previous = [dateISO-13, dateISO-7].
 * @param {Array} logs28 - logs in [dateISO-27, dateISO]
 * @param {string} dateISO
 * @param {string[]} blindSpots - mutable array to push if insufficient data
 */
function buildComparisons(logs28, dateISO, blindSpots) {
  const WINDOW_DAYS = 7;
  const startCurrent = addDays(dateISO, -6);
  const startPrev = addDays(dateISO, -13);
  const endPrev = addDays(dateISO, -7);

  const currentLogs = (logs28 || []).filter((l) => l.date >= startCurrent && l.date <= dateISO);
  const prevLogs = (logs28 || []).filter((l) => l.date >= startPrev && l.date <= endPrev);

  const hrvCurrent = currentLogs.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(Number(v)));
  const hrvPrev = prevLogs.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(Number(v)));
  const rhrCurrent = currentLogs.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(Number(v)));
  const rhrPrev = prevLogs.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(Number(v)));

  let hrv = { windowDays: WINDOW_DAYS, currentAvg: null, prevAvg: null, delta: null, deltaPct: null };
  let rhr = { windowDays: WINDOW_DAYS, currentAvg: null, prevAvg: null, delta: null };

  if (hrvCurrent.length > 0) {
    const curAvg = hrvCurrent.reduce((s, v) => s + Number(v), 0) / hrvCurrent.length;
    hrv.currentAvg = Math.round(curAvg * 10) / 10;
  }
  if (hrvPrev.length > 0) {
    const prevAvg = hrvPrev.reduce((s, v) => s + Number(v), 0) / hrvPrev.length;
    hrv.prevAvg = Math.round(prevAvg * 10) / 10;
  }
  if (hrv.currentAvg != null && hrv.prevAvg != null && hrv.prevAvg > 0) {
    const delta = Math.round((hrv.currentAvg - hrv.prevAvg) * 10) / 10;
    hrv.delta = delta;
    hrv.deltaPct = Math.round((delta / hrv.prevAvg) * 1000) / 10;
  } else if (hrv.currentAvg != null || hrv.prevAvg != null) {
    if (hrv.currentAvg != null && hrv.prevAvg != null) hrv.delta = Math.round((hrv.currentAvg - hrv.prevAvg) * 10) / 10;
  }
  if (hrvCurrent.length === 0 && hrvPrev.length === 0) {
    blindSpots.push('Vergelijking HRV: geen data in huidige of vorige 7d.');
  }

  if (rhrCurrent.length > 0) {
    const curAvg = rhrCurrent.reduce((s, v) => s + Number(v), 0) / rhrCurrent.length;
    rhr.currentAvg = Math.round(curAvg * 10) / 10;
  }
  if (rhrPrev.length > 0) {
    const prevAvg = rhrPrev.reduce((s, v) => s + Number(v), 0) / rhrPrev.length;
    rhr.prevAvg = Math.round(prevAvg * 10) / 10;
  }
  if (rhr.currentAvg != null && rhr.prevAvg != null) {
    rhr.delta = Math.round((rhr.currentAvg - rhr.prevAvg) * 10) / 10;
  }
  if (rhrCurrent.length === 0 && rhrPrev.length === 0) {
    blindSpots.push('Vergelijking RHR: geen data in huidige of vorige 7d.');
  }

  return { hrv, rhr };
}

/** Default cycleMatch shape when disabled or no data */
function defaultCycleMatch(enabled = false, cycleDayIndex = null) {
  return {
    enabled: !!enabled,
    cycleDayIndex: cycleDayIndex != null && Number.isFinite(Number(cycleDayIndex)) ? Number(cycleDayIndex) : null,
    matchedDateISO: null,
    hrv: { current: null, matched: null, delta: null, deltaPct: null },
    rhr: { current: null, matched: null, delta: null }
  };
}

/**
 * Cycle-to-cycle comparison: same cycle day in a prior cycle (only when cycle confidence HIGH and cycleDayIndex available).
 * cycleDayIndex is the brief's phaseDay (from stats.phaseDay via reportService, same as inputs.cycle.phaseDay).
 * Searches last 120 days for a day with same cycleDayIndex (±1), uses day values from dailyLogs (hrv/rhr).
 * @param {{ db, uid, dateISO, phaseDay, cycleConf, profile, hrvToday, rhrToday, blindSpots }} opts
 */
async function buildCycleMatch(opts) {
  const { db, uid, dateISO, phaseDay, cycleConf, profile, hrvToday, rhrToday, blindSpots } = opts;
  const cycleDayIndex = phaseDay != null && Number.isFinite(Number(phaseDay)) ? Number(phaseDay) : null;
  const enabled = cycleConf === 'HIGH' && cycleDayIndex != null;
  if (!enabled) {
    return defaultCycleMatch(false, null);
  }

  const cycleData = profile && profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  const lastPeriodDate = cycleData.lastPeriodDate || null;
  const cycleLength = Number(cycleData.avgDuration) || 28;
  if (!lastPeriodDate) {
    blindSpots.push('CycleMatch niet beschikbaar (onvoldoende cyclusdag-match data).');
    return { ...defaultCycleMatch(true, cycleDayIndex) };
  }

  const start120 = addDays(dateISO, -120);
  const endBefore = addDays(dateISO, -1);
  const logs120 = await getDailyLogsInRange(db, uid, start120, endBefore);
  const withCycleDay = logs120.map((log) => {
    const info = cycleService.getPhaseForDate(lastPeriodDate, cycleLength, log.date);
    return { ...log, _cycleDay: info.currentCycleDay };
  }).filter((r) => r._cycleDay != null);

  const exact = withCycleDay.filter((r) => r._cycleDay === cycleDayIndex);
  const minus1 = withCycleDay.filter((r) => r._cycleDay === cycleDayIndex - 1);
  const plus1 = withCycleDay.filter((r) => r._cycleDay === cycleDayIndex + 1);
  const byRecency = (a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0);
  const pick = (arr) => (arr.length ? [...arr].sort(byRecency)[0] : null);
  const matchedLog = pick(exact) || pick(minus1) || pick(plus1);

  if (!matchedLog) {
    blindSpots.push('CycleMatch niet beschikbaar (onvoldoende cyclusdag-match data).');
    return { ...defaultCycleMatch(true, cycleDayIndex) };
  }

  const hrvCurrent = hrvToday != null && Number.isFinite(Number(hrvToday)) ? Math.round(Number(hrvToday) * 10) / 10 : null;
  const rhrCurrent = rhrToday != null && Number.isFinite(Number(rhrToday)) ? Math.round(Number(rhrToday) * 10) / 10 : null;
  const hrvMatched = matchedLog.hrv != null && Number.isFinite(Number(matchedLog.hrv)) ? Math.round(Number(matchedLog.hrv) * 10) / 10 : null;
  const rhrMatched = matchedLog.rhr != null && Number.isFinite(Number(matchedLog.rhr)) ? Math.round(Number(matchedLog.rhr) * 10) / 10 : null;

  let hrvDelta = null;
  let hrvDeltaPct = null;
  if (hrvCurrent != null && hrvMatched != null) {
    hrvDelta = Math.round((hrvCurrent - hrvMatched) * 10) / 10;
    if (hrvMatched > 0) hrvDeltaPct = Math.round((hrvDelta / hrvMatched) * 1000) / 10;
  }
  const rhrDelta = (rhrCurrent != null && rhrMatched != null) ? Math.round((rhrCurrent - rhrMatched) * 10) / 10 : null;

  const hasValues = (hrvCurrent != null || hrvMatched != null) || (rhrCurrent != null || rhrMatched != null);
  if (!hasValues) {
    blindSpots.push('CycleMatch niet beschikbaar (onvoldoende cyclusdag-match data).');
  }

  return {
    enabled: true,
    cycleDayIndex,
    matchedDateISO: matchedLog.date,
    hrv: { current: hrvCurrent, matched: hrvMatched, delta: hrvDelta, deltaPct: hrvDeltaPct },
    rhr: { current: rhrCurrent, matched: rhrMatched, delta: rhrDelta }
  };
}

/**
 * Build compliance: checkins7dPct, checkins28dPct, missingHrvDays, missingRhrDays (last 28 ending dateISO).
 * @param {Array} logs28 - logs in [dateISO-27, dateISO]
 * @param {string} start7 - first day of last 7 (dateISO-6)
 */
function buildCompliance(logs28, start7) {
  const days28 = logs28.length;
  const withHrv = logs28.filter((l) => l.hrv != null && Number.isFinite(Number(l.hrv))).length;
  const withRhr = logs28.filter((l) => l.rhr != null && Number.isFinite(Number(l.rhr))).length;
  const checkinDays28 = logs28.filter((l) => l.hasCheckin === true).length;
  const checkins7 = logs28.filter((l) => l.date >= start7 && l.hasCheckin === true).length;
  const checkins7dPct = 7 > 0 ? Math.round((checkins7 / 7) * 1000) / 10 : null;
  const checkins28dPct = 28 > 0 ? Math.round((checkinDays28 / 28) * 1000) / 10 : null;
  return {
    checkins7dPct: checkins7dPct != null ? checkins7dPct : null,
    checkins28dPct: checkins28dPct != null ? checkins28dPct : null,
    missingHrvDays: Math.max(0, 28 - withHrv),
    missingRhrDays: Math.max(0, 28 - withRhr)
  };
}

/**
 * Confidence grade and blind spots from data availability.
 */
function buildConfidence(todayLog, stats, cycleConf) {
  const blindSpots = [];
  const hasHrvToday = todayLog && todayLog.metrics && todayLog.metrics.hrv != null && Number.isFinite(Number(todayLog.metrics.hrv));
  const hasRhrToday = todayLog && todayLog.metrics && todayLog.metrics.rhr != null && Number.isFinite(Number(todayLog.metrics.rhr));
  const hasBaselines = (stats.rhr_baseline_28d != null && Number.isFinite(stats.rhr_baseline_28d)) || (stats.hrv_baseline_28d != null && Number.isFinite(stats.hrv_baseline_28d));
  const hasAcwr = stats.acwr != null && Number.isFinite(stats.acwr);
  if (!hasHrvToday) blindSpots.push('HRV vandaag ontbreekt');
  if (!hasRhrToday) blindSpots.push('RHR vandaag ontbreekt');
  if (!hasBaselines) blindSpots.push('28d-baselines ontbreken');
  if (!hasAcwr) blindSpots.push('ACWR niet berekend');
  if (cycleConf === 'LOW') blindSpots.push('Cyclusvertrouwen laag (HBC/onbekend)');
  let grade = 'C';
  if (hasHrvToday && hasRhrToday && hasBaselines && hasAcwr) {
    grade = blindSpots.length === 0 ? 'A' : 'B';
  } else if (hasHrvToday && hasRhrToday && (hasBaselines || hasAcwr)) {
    grade = 'B';
  }
  return { grade, blindSpots };
}

/**
 * InternalCost: ELEVATED | NORMAL | LOW from recovery + ACWR + hard exposures. Null if missing data.
 * ELEVATED: stress signature (HRV down + RHR up) and/or stacking (3+ hard sessions) with clear explanations.
 */
function buildInternalCost(recoveryPct, rhrDelta, acwrBandVal, hardExposures7d, blindSpots) {
  if (recoveryPct == null && rhrDelta == null && acwrBandVal == null && hardExposures7d == null) return null;
  const hasRecovery = recoveryPct != null && Number.isFinite(recoveryPct);
  const hasRhrDelta = rhrDelta != null && Number.isFinite(rhrDelta);
  const hasAcwr = acwrBandVal != null;
  const hasHard = hardExposures7d != null && Number.isFinite(hardExposures7d);
  if (!hasRecovery && !hasRhrDelta && !hasHard) return null;
  const hrvLow = hasRecovery && recoveryPct < 95;
  const rhrUp = hasRhrDelta && rhrDelta >= 2;
  const hardHigh = hasHard && hardExposures7d >= 3;
  if ((hrvLow && rhrUp) || hardHigh) {
    const stressSig = hrvLow && rhrUp ? 'Stress signature: HRV down, RHR up.' : '';
    const stacking = hardHigh ? 'Stacking / hoge intensiteitsdichtheid (3+ zware sessies in 7d).' : '';
    const explanation = [stressSig, stacking].filter(Boolean).join(' ') || 'Verhoogde interne belasting.';
    return { state: 'ELEVATED', explanation };
  }
  const hrvOk = hasRecovery && recoveryPct >= 100;
  const rhrOk = hasRhrDelta && rhrDelta <= 0;
  const acwrSweet = hasAcwr && (acwrBandVal === 'LOW' || acwrBandVal === 'SWEET');
  if (hrvOk && rhrOk && acwrSweet) {
    return { state: 'LOW', explanation: 'HRV op of boven baseline, RHR stabiel, belasting in sweet spot' };
  }
  return { state: 'NORMAL', explanation: 'Geen verhoogde interne belasting' };
}

const MAX_WHY_LEN = 120;

/**
 * Build max 2 data-based "why" bullets (<= MAX_WHY_LEN each). No motivational language.
 * @param {{ recoveryPct?: number|null, rhrDelta?: number|null, last7dLoadTotal?: number|null, hardExposures7d?: number }} ctx
 */
function buildWhyBullets(ctx) {
  const why = [];
  const { recoveryPct, rhrDelta, last7dLoadTotal, hardExposures7d } = ctx;
  const hasRecovery = recoveryPct != null && Number.isFinite(recoveryPct) || rhrDelta != null && Number.isFinite(rhrDelta);
  if (hasRecovery) {
    const pctStr = recoveryPct != null && Number.isFinite(recoveryPct) ? `${recoveryPct}%` : '—';
    const rhrStr = rhrDelta != null && Number.isFinite(rhrDelta) ? (rhrDelta >= 0 ? '+' : '') + rhrDelta + ' bpm' : '—';
    let conclusion = 'herstelcapaciteit matig.';
    if (recoveryPct != null && recoveryPct < 92) conclusion = 'herstelcapaciteit lager.';
    else if (rhrDelta != null && rhrDelta > 3) conclusion = 'herstelcapaciteit lager.';
    else if (recoveryPct != null && recoveryPct >= 98 && (rhrDelta == null || rhrDelta <= 2)) conclusion = 'herstelcapaciteit goed.';
    const bullet = `HRV: ${pctStr} van 28d baseline + RHR: ${rhrStr} → ${conclusion}`;
    why.push(bullet.length > MAX_WHY_LEN ? bullet.slice(0, MAX_WHY_LEN - 3) + '...' : bullet);
  }
  if (last7dLoadTotal != null && Number.isFinite(last7dLoadTotal)) {
    const loadRounded = Math.round(last7dLoadTotal);
    const hard = (hardExposures7d != null && Number.isFinite(hardExposures7d)) ? hardExposures7d : 0;
    let conclusion = 'belasting in lijn.';
    if (last7dLoadTotal > 400 || hard >= 2) conclusion = 'niet stapelen.';
    else if (last7dLoadTotal < 200 && hard === 0) conclusion = 'ruimte om te laden.';
    const bullet = `Laatste 7 dagen: load ${loadRounded} + ${hard} hard exposures → ${conclusion}`;
    why.push(bullet.length > MAX_WHY_LEN ? bullet.slice(0, MAX_WHY_LEN - 3) + '...' : bullet);
  }
  return why.slice(0, 2);
}

/**
 * TodayDirective: doToday, why (data-based, max 2), stopRule, detailsMarkdown (from aiMessage or template).
 */
function buildTodayDirective(opts) {
  const { statusTagVal, todayLog, blindSpots, recoveryPct, rhrDelta, last7dLoadTotal, hardExposures7d } = opts;
  const detailsMarkdown = todayLog && todayLog.aiMessage ? todayLog.aiMessage : null;
  const doToday = [];
  const stopRule = 'Bij twijfel: intensiteit omlaag. Bij pijn of ziekte: stoppen.';
  if (statusTagVal === 'PUSH') {
    doToday.push('Train volgens plan; kwaliteit voor kwantiteit.');
  } else if (statusTagVal === 'MAINTAIN') {
    doToday.push('Lichte tot gematigde training; focus op techniek of duur.');
  } else {
    doToday.push('Rust of actief herstel (Zone 1). Geen zware of lange sessies.');
  }
  if (blindSpots.length > 0) {
    doToday.push('Check dagrapport voor ontbrekende data.');
  }
  const why = buildWhyBullets({
    recoveryPct: recoveryPct ?? null,
    rhrDelta: rhrDelta ?? null,
    last7dLoadTotal: last7dLoadTotal ?? null,
    hardExposures7d: hardExposures7d ?? 0
  });
  return {
    doToday: doToday.slice(0, 5).map((s) => s.length > MAX_WHY_LEN ? s.slice(0, MAX_WHY_LEN - 3) + '...' : s),
    why,
    stopRule,
    detailsMarkdown: detailsMarkdown || (detailsMarkdown === null && todayLog ? 'Open dagrapport voor volledig advies.' : undefined)
  };
}

/**
 * Next48h: today, tomorrow, trigger (deterministic by status.tag).
 */
function buildNext48h(statusTagVal) {
  let tomorrow = 'Rust of Zone 1';
  if (statusTagVal === 'PUSH') tomorrow = 'Aerobic Flow / techniek';
  else if (statusTagVal === 'MAINTAIN') tomorrow = 'Aerobic Flow kort + mobility';
  return {
    today: 'Volg vandaag het directief hierboven.',
    tomorrow,
    trigger: 'Als HRV daalt en RHR stijgt morgen → intensiteit laag houden.'
  };
}

/**
 * Intake from user profile (goal, eventDate, constraints, etc.).
 */
function buildIntake(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const goals = profile.goals;
  const goal = Array.isArray(goals) ? (goals.length ? goals.join(', ') : null) : (goals != null ? String(goals) : null);
  const intake = profile.intake && typeof profile.intake === 'object' ? profile.intake : {};
  return {
    goal: goal || null,
    eventDate: profile.eventDate || null,
    constraints: profile.constraints || profile.injuryHistory || null,
    availabilityDaysPerWeek: profile.availabilityDaysPerWeek != null ? profile.availabilityDaysPerWeek : null,
    sportFocus: profile.sport || profile.sportFocus || null,
    oneLineNotes: profile.oneLineNotes || null,
    fixedClasses: intake.fixedClasses === true,
    fixedHiitPerWeek: intake.fixedHiitPerWeek != null && Number.isFinite(Number(intake.fixedHiitPerWeek)) ? Number(intake.fixedHiitPerWeek) : null
  };
}

/**
 * getDailyBrief — Build PrimeFormDailyBrief for dateISO.
 * @param {{ db, admin, uid, dateISO, timezone, kbVersion }} opts - kbVersion optional (SHA256 of KB at startup when provided)
 * @returns {Promise<object>} brief (PrimeFormDailyBrief)
 */
async function getDailyBrief(opts) {
  const { db, admin, uid, dateISO, timezone, kbVersion: optsKbVersion } = opts;
  const generatedAt = new Date().toISOString();
  const meta = {
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    kbVersion: optsKbVersion != null ? optsKbVersion : KB_VERSION,
    generatedAt,
    timezone: timezone || 'Europe/Amsterdam'
  };

  if (!db || !uid) {
    const fallbackTag = 'RECOVER';
    return {
      meta,
      generatedAt,
      status: { tag: fallbackTag, signal: signalFromTag(fallbackTag), oneLiner: 'Geen data', hasBlindSpot: true },
      confidence: { grade: 'C', blindSpots: ['Geen gebruiker of database'] },
      todayDirective: { doToday: [], why: [], stopRule: 'Bij twijfel: niet doorgaan.' },
      inputs: { acwr: null, recovery: null, cycle: null, activity: null },
      compliance: { checkins7dPct: null, checkins28dPct: null, missingHrvDays: null, missingRhrDays: null },
      next48h: buildNext48h(fallbackTag),
      intake: null,
      internalCost: null,
      comparisons: {
        hrv: { windowDays: 7, currentAvg: null, prevAvg: null, delta: null, deltaPct: null },
        rhr: { windowDays: 7, currentAvg: null, prevAvg: null, delta: null },
        cycleMatch: defaultCycleMatch(false, null)
      }
    };
  }

  const start28 = addDays(dateISO, -27);
  const start7 = addDays(dateISO, -6);

  const [stats, userSnap, todayLog, logs28] = await Promise.all([
    reportService.getDashboardStats({ db, admin, uid }),
    db.collection('users').doc(String(uid)).get(),
    getDailyLogForDate(db, uid, dateISO),
    getDailyLogsInRange(db, uid, start28, dateISO)
  ]);

  const userData = userSnap && userSnap.exists ? userSnap.data() : {};
  const profile = userData.profile || {};

  // No valid check-in for today (imported-only or no log): do not drive advice from imported metrics; still return cycleInfo from profile
  if (todayLog == null) {
    const maintainTag = 'MAINTAIN';
    const maintainSignal = tagToSignal(maintainTag);
    const mode = cycleMode(profile);
    const cycleConf = cycleConfidence(mode, profile);
    const phase = cycleConf !== 'LOW' && stats && stats.phase ? stats.phase : null;
    const phaseDay = cycleConf !== 'LOW' && stats && stats.phaseDay != null ? stats.phaseDay : null;
    return {
      meta: { ...meta, needsCheckin: true, flagsConfidence: 'LOW' },
      generatedAt,
      status: {
        tag: maintainTag,
        signal: maintainSignal,
        oneLiner: 'Stabiel; train met mate.',
        hasBlindSpot: true,
        instructionClass: 'MAINTAIN',
        reasons: [{ code: 'MISSING_CHECKIN_INPUT', text: 'Geen check-in vandaag. Doe eerst je check-in voor een persoonlijk advies.' }]
      },
      confidence: { grade: 'C', blindSpots: ['Geen check-in vandaag. Vul readiness (en slaap) in voor een gericht advies.'] },
      todayDirective: { doToday: [], why: [], stopRule: 'Bij twijfel: niet doorgaan.' },
      inputs: {
        acwr: stats?.acwr != null && Number.isFinite(stats.acwr) ? { value: stats.acwr, band: acwrBand(stats.acwr) } : null,
        recovery: null,
        readiness: null,
        redFlagsCount: null,
        redFlagDetails: [],
        cycle: { mode, confidence: cycleConf, phase, phaseDay, shiftInferred: false },
        activity: null
      },
      compliance: buildCompliance(logs28, start7),
      next48h: buildNext48h(maintainTag),
      intake: buildIntake(profile),
      internalCost: null,
      comparisons: {
        hrv: { windowDays: 7, currentAvg: null, prevAvg: null, delta: null, deltaPct: null },
        rhr: { windowDays: 7, currentAvg: null, prevAvg: null, delta: null },
        cycleMatch: defaultCycleMatch(false, null)
      }
    };
  }

  const activities7 = await getActivitiesInRange(db, uid, start7, dateISO, profile, admin);
  const compliance = buildCompliance(logs28, start7);

  const mode = cycleMode(profile);
  const cycleConf = cycleConfidence(mode, profile);
  const phase = cycleConf !== 'LOW' && stats.phase ? stats.phase : null;
  const phaseDay = cycleConf !== 'LOW' && stats.phaseDay != null ? stats.phaseDay : null;

  const acwrVal = stats.acwr != null && Number.isFinite(stats.acwr) ? stats.acwr : null;
  const band = acwrBand(acwrVal);
  const isSick = todayLog && todayLog.isSick === true;
  const confidence = buildConfidence(todayLog, stats, cycleConf);
  if (todayLog && todayLog.isSick !== true && profile.isSick === true) {
    confidence.blindSpots.push('Ziek/handrem niet in vandaagse log; profiel heeft isSick.');
  }
  const hasBlindSpot = confidence.blindSpots.length > 0;

  const last7dLoadTotal = activities7.reduce((s, a) => s + (a._primeLoad || 0), 0);
  const hardExposures7d = activities7.filter((a) => a._hard).length;
  const largestLoad7d = activities7.length ? Math.max(...activities7.map((a) => a._primeLoad || 0)) : null;

  const hrvToday = todayLog && todayLog.metrics && todayLog.metrics.hrv != null ? Number(todayLog.metrics.hrv) : null;
  const rhrToday = todayLog && todayLog.metrics && todayLog.metrics.rhr != null ? Number(todayLog.metrics.rhr) : null;
  const hrvBaseline = stats.hrv_baseline_28d != null ? Number(stats.hrv_baseline_28d) : null;
  const rhrBaseline = stats.rhr_baseline_28d != null ? Number(stats.rhr_baseline_28d) : null;
  const recoveryPct = hrvBaseline != null && hrvBaseline > 0 && hrvToday != null ? Math.round((hrvToday / hrvBaseline) * 1000) / 10 : null;
  const rhrDelta = rhrBaseline != null && rhrToday != null ? Math.round((rhrToday - rhrBaseline) * 10) / 10 : null;

  const sleep = todayLog?.metrics?.sleep != null ? Number(todayLog.metrics.sleep) : null;
  const canComputeRedFlags =
    sleep != null && Number.isFinite(sleep) &&
    rhrToday != null && Number.isFinite(rhrToday) &&
    rhrBaseline != null && Number.isFinite(rhrBaseline) &&
    hrvToday != null && Number.isFinite(hrvToday) &&
    hrvBaseline != null && Number.isFinite(hrvBaseline);
  const redFlagsResult = canComputeRedFlags
    ? cycleService.calculateRedFlags(sleep, rhrToday, rhrBaseline, hrvToday, hrvBaseline, phase === 'Luteal')
    : { count: null, reasons: ['INSUFFICIENT_INPUT_FOR_REDFLAGS'], details: { rhr: {}, hrv: {} } };
  const goalIntent = profile?.goalIntent || profile?.intake?.goalIntent || null;
  const fixedClasses = profile?.intake?.fixedClasses === true;
  const fixedHiitPerWeek = profile?.intake?.fixedHiitPerWeek != null ? Number(profile.intake.fixedHiitPerWeek) : null;
  const statusResult = computeStatus({
    acwr: acwrVal,
    isSick,
    readiness: todayLog?.metrics?.readiness != null ? Number(todayLog.metrics.readiness) : null,
    redFlags: redFlagsResult.count,
    cyclePhase: phase,
    hrvVsBaseline: recoveryPct,
    phaseDay,
    goalIntent,
    fixedClasses,
    fixedHiitPerWeek
  });
  const tag = statusResult.tag;
  const signal = statusResult.signal;
  const instructionClass = statusResult.instructionClass;
  const prescriptionHint = statusResult.prescriptionHint ?? null;
  const oneLiner = tag === 'PUSH' ? 'Groen licht voor kwaliteit.' : tag === 'MAINTAIN' ? 'Stabiel; train met mate.' : 'Herstel voorop.';

  const internalCost = buildInternalCost(recoveryPct, rhrDelta, band, hardExposures7d, confidence.blindSpots);
  if (internalCost == null) {
    confidence.blindSpots.push('InternalCost niet berekend (ontbrekende data).');
  }

  const todayDirective = buildTodayDirective({
    statusTagVal: tag,
    todayLog,
    blindSpots: confidence.blindSpots,
    recoveryPct,
    rhrDelta,
    last7dLoadTotal,
    hardExposures7d
  });
  if (!todayDirective.detailsMarkdown && todayLog) {
    todayDirective.detailsMarkdown = 'Open dagrapport voor volledig advies.';
  }
  const next48h = buildNext48h(tag);
  const intake = buildIntake(profile);
  const comparisons = buildComparisons(logs28, dateISO, confidence.blindSpots);
  comparisons.cycleMatch = await buildCycleMatch({
    db,
    uid,
    dateISO,
    phaseDay,
    cycleConf,
    profile,
    hrvToday,
    rhrToday,
    blindSpots: confidence.blindSpots
  });

  // next48h is always present (required); deterministic from status.tag
  const brief = {
    meta: { ...meta, needsCheckin: false, flagsConfidence: canComputeRedFlags ? 'HIGH' : 'LOW' },
    generatedAt,
    status: {
      tag,
      signal,
      oneLiner,
      hasBlindSpot,
      instructionClass,
      prescriptionHint
    },
    confidence: {
      grade: confidence.grade,
      blindSpots: confidence.blindSpots
    },
    todayDirective: {
      doToday: todayDirective.doToday,
      why: todayDirective.why,
      stopRule: todayDirective.stopRule,
      ...(todayDirective.detailsMarkdown ? { detailsMarkdown: todayDirective.detailsMarkdown } : {})
    },
    inputs: {
      acwr: acwrVal != null ? { value: acwrVal, band } : null,
      recovery: (recoveryPct != null || rhrDelta != null) ? { hrvVs28dPct: recoveryPct, rhrDelta } : null,
      readiness: todayLog?.metrics?.readiness != null ? Number(todayLog.metrics.readiness) : null,
      redFlagsCount: redFlagsResult.count,
      redFlagDetails: canComputeRedFlags ? (redFlagsResult.reasons || []) : [],
      cycle: {
        mode,
        confidence: cycleConf,
        phase,
        phaseDay,
        shiftInferred: false
      },
      activity: {
        last7dLoadTotal: Math.round(last7dLoadTotal * 10) / 10,
        hardExposures7d,
        largestLoad7d: largestLoad7d != null ? Math.round(largestLoad7d * 10) / 10 : null
      }
    },
    compliance,
    next48h,
    intake,
    internalCost,
    comparisons
  };

  return brief;
}

module.exports = {
  getDailyBrief,
  getDailyLogsInRange,
  getActivitiesInRange,
  cycleMode,
  cycleConfidence,
  selectTodayCheckin
};
