/**
 * Debug Timeline Service — Single source of truth for coach/admin: per-day inputs, baselines, red flags, cycle, ACWR, status.
 * Used by GET /api/admin/users/:uid/debug-history.
 */

const dailyBriefService = require('./dailyBriefService');
const cycleService = require('./cycleService');
const { calculateActivityLoad, calculatePrimeLoad, calculateACWR } = require('./calculationService');
const { computeStatus } = require('./statusEngine');

const ENGINE_VERSION = process.env.PRIMEFORM_ENGINE_VERSION || '1.0.0';
const KB_VERSION = process.env.PRIMEFORM_KB_VERSION || '1.0';

/** Add days to YYYY-MM-DD, return YYYY-MM-DD */
function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
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

/**
 * Build debug-history array for uid over the last `days` days (including today).
 * @param {{ db, admin, uid, days }} opts - days: 7|14|28|56 (default 28, clamp max 56)
 * @returns {Promise<{ profile, days: Array<object> }>}
 */
async function getDebugHistory(opts) {
  const { db, admin, uid } = opts;
  let days = parseInt(opts.days, 10);
  if (!Number.isFinite(days) || days < 7) days = 28;
  if (days > 56) days = 56;
  if (![7, 14, 28, 56].includes(days)) days = 28;

  const todayStr = new Date().toISOString().slice(0, 10);
  const firstDate = addDays(todayStr, -days + 1);
  const lastDate = todayStr;

  const logStart = addDays(firstDate, -27);
  const activityStart = addDays(firstDate, -55);

  const [userSnap, logs] = await Promise.all([
    db.collection('users').doc(String(uid)).get(),
    dailyBriefService.getDailyLogsInRange(db, uid, logStart, lastDate)
  ]);

  const userData = userSnap && userSnap.exists ? userSnap.data() : {};
  const profile = userData.profile || {};

  const activities = await dailyBriefService.getActivitiesInRange(db, uid, activityStart, lastDate, profile, admin);
  const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  const lastPeriodDate = cycleData.lastPeriodDate || null;
  const cycleLength = Number(cycleData.avgDuration) || 28;
  const mode = dailyBriefService.cycleMode(profile);
  const cycleConf = dailyBriefService.cycleConfidence(mode, profile);

  const logByDate = new Map();
  (logs || []).forEach((row) => logByDate.set(row.date, row));

  const activityByDate = new Map();
  (activities || []).forEach((a) => {
    const d = a._dateStr || (a.start_date_local && String(a.start_date_local).slice(0, 10)) || '';
    if (!d) return;
    if (!activityByDate.has(d)) activityByDate.set(d, []);
    activityByDate.get(d).push(a);
  });

  const result = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(firstDate, d);
    const merged = logByDate.get(date) || {
      date,
      hrv: null,
      rhr: null,
      hasCheckin: false,
      hasImport: false,
      hasStrava: false,
      readiness: null,
      sleep: null,
      isSick: null
    };

    const sourceSummary = {
      hasCheckin: merged.hasCheckin === true,
      hasImport: merged.hasImport === true,
      hasStrava: merged.hasStrava === true
    };

    const readiness = merged.readiness != null && Number.isFinite(Number(merged.readiness)) ? Number(merged.readiness) : null;
    const sleep = merged.sleep != null && Number.isFinite(Number(merged.sleep)) ? Number(merged.sleep) : null;
    const hrv = merged.hrv != null && Number.isFinite(Number(merged.hrv)) ? Number(merged.hrv) : null;
    const rhr = merged.rhr != null && Number.isFinite(Number(merged.rhr)) ? Number(merged.rhr) : null;
    const isSick = merged.isSick === true;

    const inputs = {
      readiness,
      sleep,
      hrv,
      rhr,
      isSick
    };

    const validCheckinForDecision = sourceSummary.hasCheckin === true && Number.isFinite(readiness);

    const logs28 = (logs || []).filter((l) => l.date >= addDays(date, -27) && l.date <= date);
    const logs7 = logs28.filter((l) => l.date >= addDays(date, -6));

    const hrv28 = logs28.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(Number(v)));
    const rhr28 = logs28.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(Number(v)));
    const hrv7 = logs7.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(Number(v)));
    const rhr7 = logs7.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(Number(v)));

    const hrv_baseline_28d = hrv28.length ? Math.round((hrv28.reduce((s, v) => s + v, 0) / hrv28.length) * 10) / 10 : null;
    const rhr_baseline_28d = rhr28.length ? Math.round(rhr28.reduce((s, v) => s + v, 0) / rhr28.length) : null;
    const hrv_baseline_7d = hrv7.length ? Math.round((hrv7.reduce((s, v) => s + v, 0) / hrv7.length) * 10) / 10 : null;
    const rhr_baseline_7d = rhr7.length ? Math.round(rhr7.reduce((s, v) => s + v, 0) / rhr7.length) : null;

    const activities7 = [];
    const activities28 = [];
    for (let i = 0; i <= 6; i++) {
      const d = addDays(date, -i);
      (activityByDate.get(d) || []).forEach((a) => activities7.push(a));
    }
    for (let i = 0; i <= 27; i++) {
      const d = addDays(date, -i);
      (activityByDate.get(d) || []).forEach((a) => activities28.push(a));
    }
    const activities7ForAcwr = activities7.filter((a) => a.includeInAcwr !== false);
    const activities28ForAcwr = activities28.filter((a) => a.includeInAcwr !== false);
    const sum7 = activities7ForAcwr.reduce((s, a) => s + (a._primeLoad || 0), 0);
    const sum28 = activities28ForAcwr.reduce((s, a) => s + (a._primeLoad || 0), 0);
    const chronic_load = sum28 / 4;
    const load_ratio = chronic_load > 0 ? calculateACWR(sum7, chronic_load) : null;
    const acwrVal = load_ratio != null && Number.isFinite(load_ratio) ? Math.round(load_ratio * 100) / 100 : null;
    const acwrBandVal = acwrBand(acwrVal);

    const activities7d = activities7.map((a) => ({
      date: a._dateStr || (a.start_date_local && String(a.start_date_local).slice(0, 10)) || '',
      type: a.type || 'Session',
      load: a._primeLoad != null ? a._primeLoad : (a.prime_load != null ? Number(a.prime_load) : null),
      source: a.source ?? null,
      id: a.id ?? null
    })).filter((a) => a.date && a.id);

    const acwrContributors7d = [...activities7ForAcwr]
      .sort((a, b) => (b._primeLoad || 0) - (a._primeLoad || 0))
      .slice(0, 5)
      .map((a) => ({
        date: a._dateStr || (a.start_date_local && String(a.start_date_local).slice(0, 10)) || '',
        type: a.type || 'Session',
        load: a._primeLoad != null ? a._primeLoad : (a.prime_load != null ? Number(a.prime_load) : null),
        source: a.source ?? null,
        id: a.id ?? null
      }));

    let redFlagsCount = null;
    let redFlagDetails = [];
    let flagsConfidence = 'LOW';
    let output;
    let needsCheckin;

    if (!validCheckinForDecision) {
      flagsConfidence = 'LOW';
      redFlagDetails = [];
      output = {
        tag: 'MAINTAIN',
        signal: 'ORANGE',
        instructionClass: 'MAINTAIN',
        prescriptionHint: null,
        reasons: [{ code: 'MISSING_CHECKIN_INPUT', text: 'Geen check-in vandaag.' }]
      };
      needsCheckin = true;
    } else {
      const phaseInfo = lastPeriodDate ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, date) : { phaseName: null, currentCycleDay: null };
      const phase = cycleConf !== 'LOW' && phaseInfo.phaseName ? phaseInfo.phaseName : null;
      const phaseDay = cycleConf !== 'LOW' && phaseInfo.currentCycleDay != null ? phaseInfo.currentCycleDay : null;

      const canComputeRedFlags =
        sleep != null && Number.isFinite(sleep) &&
        rhr != null && Number.isFinite(rhr) &&
        rhr_baseline_28d != null && Number.isFinite(rhr_baseline_28d) &&
        hrv != null && Number.isFinite(hrv) &&
        hrv_baseline_28d != null && Number.isFinite(hrv_baseline_28d);

      if (canComputeRedFlags) {
        const redResult = cycleService.calculateRedFlags(sleep, rhr, rhr_baseline_28d, hrv, hrv_baseline_28d, phase === 'Luteal');
        redFlagsCount = redResult.count;
        redFlagDetails = redResult.reasons || [];
        flagsConfidence = 'HIGH';
      } else {
        redFlagDetails = ['INSUFFICIENT_INPUT_FOR_REDFLAGS'];
      }

      const hrvVsBaseline = hrv_baseline_28d != null && hrv_baseline_28d > 0 && hrv != null
        ? Math.round((hrv / hrv_baseline_28d) * 1000) / 10
        : null;

      const statusResult = computeStatus({
        acwr: acwrVal,
        isSick,
        readiness,
        redFlags: redFlagsCount,
        cyclePhase: phase,
        hrvVsBaseline,
        phaseDay,
        goalIntent: profile?.goalIntent || profile?.intake?.goalIntent || null,
        fixedClasses: profile?.intake?.fixedClasses === true,
        fixedHiitPerWeek: profile?.intake?.fixedHiitPerWeek != null ? Number(profile.intake.fixedHiitPerWeek) : null
      });

      output = {
        tag: statusResult.tag,
        signal: statusResult.signal,
        instructionClass: statusResult.instructionClass,
        reasons: statusResult.reasons || []
      };
      needsCheckin = false;
    }

    const dayOut = {
      date,
      sourceSummary,
      inputs,
      derived: {
        baselines: {
          hrv7d: hrv_baseline_7d,
          hrv28d: hrv_baseline_28d,
          rhr7d: rhr_baseline_7d,
          rhr28d: rhr_baseline_28d
        },
        redFlags: { count: redFlagsCount, details: redFlagDetails },
        cycle: (() => {
          const phaseInfo = lastPeriodDate ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, date) : { phaseName: null, currentCycleDay: null };
          const phase = cycleConf !== 'LOW' && phaseInfo.phaseName ? phaseInfo.phaseName : null;
          const phaseDay = cycleConf !== 'LOW' && phaseInfo.currentCycleDay != null ? phaseInfo.currentCycleDay : null;
          return { mode, confidence: cycleConf, phase, phaseDay };
        })(),
        acwr: acwrVal,
        acwrBand: acwrBandVal,
        activities7d,
        acwrContributors7d
      },
      output,
      meta: {
        flagsConfidence,
        needsCheckin: !!needsCheckin,
        kbVersion: KB_VERSION,
        engineVersion: ENGINE_VERSION
      }
    };
    result.push(dayOut);
  }

  return { profile, days: result };
}

module.exports = { getDebugHistory };
