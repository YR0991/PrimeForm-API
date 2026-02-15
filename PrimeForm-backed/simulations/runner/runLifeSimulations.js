/**
 * Life simulation harness (Layer 2) v1.3.
 * For each scenario: load fixture (56d dailyLogs + activities + profile), derive same inputs as engine,
 * call computeStatus, assert expected tag/signal and optional: acwrBand, cycleMode, cycleConfidence,
 * redFlagsMin, reasonsContains, phaseDayPresent, instructionClass, prescriptionHint.
 * Option B (no PUSH when acwr null) is enforced in statusEngine.js; runner only derives and asserts.
 */

const path = require('path');
const fs = require('fs');
const cycleService = require('../../services/cycleService');
const { computeStatus } = require('../../services/statusEngine');
const { calculateACWR } = require('../../services/calculationService');
const { cycleMode: engineCycleMode, cycleConfidence: engineCycleConfidence, selectTodayCheckin } = require('../../services/dailyBriefService');

/** ACWR → band string for expected: "<0.8" | "0.8-1.3" | "1.3-1.5" | ">1.5" | "null" */
function acwrBandString(acwr) {
  if (acwr == null || !Number.isFinite(acwr)) return 'null';
  const v = Number(acwr);
  if (v < 0.8) return '<0.8';
  if (v <= 1.3) return '0.8-1.3';
  if (v <= 1.5) return '1.3-1.5';
  return '>1.5';
}

const FIXTURES_DIR = path.join(__dirname, '../fixtures/life');
const EXPECTED_DIR = path.join(__dirname, '../expected/life');

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} fixture - { profile, dailyLogs, activities, today }
 * @returns {{ tag: string, signal: string, reasons: string[], acwr: number|null, acwrWasComputable: boolean }}
 */
function runScenario(fixture) {
  const today = (fixture.today || '').slice(0, 10);
  if (!today) throw new Error('Fixture missing today');

  const profile = fixture.profile || {};
  const cycleData = profile.cycleData || {};
  const lastPeriodDate = cycleData.lastPeriodDate || null;
  const cycleLength = Number(cycleData.avgDuration) || Number(cycleData.cycleLength) || 28;
  const contraceptionMode = cycleData.contraceptionMode || null;
  const contraception = (cycleData.contraception || '').toLowerCase();
  const isNatural =
    contraceptionMode === 'NATURAL' ||
    (contraceptionMode == null && !contraception && !!lastPeriodDate);

  const dailyLogs = Array.isArray(fixture.dailyLogs) ? fixture.dailyLogs : [];
  const activities = Array.isArray(fixture.activities) ? fixture.activities : [];

  const day7Ago = addDays(today, -7);
  const day28Ago = addDays(today, -28);

  // Logs in last 28 days (including today)
  const logsInRange = dailyLogs.filter((l) => {
    const d = (l.date || '').slice(0, 10);
    return d && d >= day28Ago && d <= today;
  });
  // Merge by date so baseline includes ALL sources (checkin + import + strava)
  const byDate = new Map();
  logsInRange.forEach((l) => {
    const d = (l.date || '').slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, { date: d, hrv: null, rhr: null });
    const row = byDate.get(d);
    if (l.hrv != null && Number.isFinite(Number(l.hrv))) row.hrv = Number(l.hrv);
    if (l.rhr != null && Number.isFinite(Number(l.rhr))) row.rhr = Number(l.rhr);
  });
  const logs28 = Array.from(byDate.values());
  const logs7 = logs28.filter((row) => row.date >= day7Ago && row.date <= today);

  // 7d and 28d HRV/RHR baselines (average); engine uses 28d for redFlags/hrvVsBaseline
  const hrv7 = logs7.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(v));
  const rhr7 = logs7.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(v));
  const hrv28 = logs28.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(v));
  const rhr28 = logs28.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(v));
  const hrvBaseline7 = hrv7.length ? (hrv7.reduce((s, v) => s + v, 0) / hrv7.length) : null;
  const rhrBaseline7 = rhr7.length ? (rhr7.reduce((s, v) => s + v, 0) / rhr7.length) : null;
  const hrvBaseline28 = hrv28.length ? Math.round((hrv28.reduce((s, v) => s + v, 0) / hrv28.length) * 10) / 10 : null;
  const rhrBaseline28 = rhr28.length ? Math.round(rhr28.reduce((s, v) => s + v, 0) / rhr28.length) : null;

  // Only check-in logs (or non-imported with finite readiness) drive today's advice; imported-only must not
  const todayLogsRaw = dailyLogs.filter((l) => (l.date || '').slice(0, 10) === today);
  const todayLogsNormalized = todayLogsRaw.map((l) => ({
    metrics: {
      hrv: l.hrv != null ? Number(l.hrv) : null,
      rhr: l.rhr != null ? Number(l.rhr) : null,
      sleep: l.sleep != null ? l.sleep : (l.sleepHours != null ? l.sleepHours : null),
      readiness: l.readiness != null ? Number(l.readiness) : null
    },
    source: l.source,
    imported: l.imported === true
  }));
  const selectedToday = selectTodayCheckin(todayLogsNormalized, today);
  const selIdx = selectedToday ? todayLogsNormalized.findIndex((n) =>
    n.metrics.readiness === selectedToday.metrics.readiness &&
    (n.source || undefined) === (selectedToday.source || undefined) &&
    n.imported === selectedToday.imported
  ) : -1;
  const todayLog = selectedToday && selIdx >= 0 ? todayLogsRaw[selIdx] : null;
  const hrvToday = selectedToday && selectedToday.metrics.hrv != null ? Number(selectedToday.metrics.hrv) : null;
  const rhrToday = selectedToday && selectedToday.metrics.rhr != null ? Number(selectedToday.metrics.rhr) : null;
  const sleep = selectedToday && selectedToday.metrics.sleep != null ? Number(selectedToday.metrics.sleep) : null;
  const readiness = selectedToday && selectedToday.metrics.readiness != null ? Number(selectedToday.metrics.readiness) : null;
  const isSick = todayLog && todayLog.isSick === true;

  const hrvVsBaseline = hrvBaseline28 != null && hrvBaseline28 > 0 && hrvToday != null
    ? Math.round((hrvToday / hrvBaseline28) * 1000) / 10
    : null;

  // ACWR: last 7 days load vs last 28 days load (sum7 / (sum28/4)); exclude activities with includeInAcwr === false
  const loadPerDate = (a) => (a.date || '').slice(0, 10);
  const getLoad = (a) => (a.prime_load != null ? Number(a.prime_load) : (a.load != null ? Number(a.load) : 0));
  const forAcwr = (a) => a.includeInAcwr !== false;
  const activitiesLast7 = activities.filter((a) => {
    const d = loadPerDate(a);
    return d && d >= day7Ago && d <= today && forAcwr(a);
  });
  const activitiesLast28 = activities.filter((a) => {
    const d = loadPerDate(a);
    return d && d >= day28Ago && d <= today && forAcwr(a);
  });
  const sum7 = activitiesLast7.reduce((s, a) => s + getLoad(a), 0);
  const sum28 = activitiesLast28.reduce((s, a) => s + getLoad(a), 0);
  const chronic = sum28 / 4;
  let acwr = null;
  let acwrWasComputable = false;
  if (Number.isFinite(chronic) && chronic > 0 && Number.isFinite(sum7)) {
    acwr = calculateACWR(sum7, chronic);
    acwrWasComputable = true;
  }

  // Cycle phase (only if NATURAL and lastPeriodDate)
  let cyclePhase = null;
  let phaseDay = null;
  if (isNatural && lastPeriodDate) {
    const phaseInfo = cycleService.getPhaseForDate(lastPeriodDate, cycleLength, today);
    cyclePhase = phaseInfo.phaseName || null;
    phaseDay = phaseInfo.currentCycleDay ?? null;
  }

  // Red flags (same thresholds as cycleService.calculateRedFlags)
  const isLuteal = cyclePhase === 'Luteal';
  let redFlagsCount = 0;
  if (sleep != null && rhrToday != null && rhrBaseline28 != null && hrvToday != null && hrvBaseline28 != null) {
    const redFlagsResult = cycleService.calculateRedFlags(
      sleep,
      rhrToday,
      rhrBaseline28,
      hrvToday,
      hrvBaseline28,
      isLuteal
    );
    redFlagsCount = redFlagsResult.count ?? 0;
  }

  const goalIntent = profile?.goalIntent || profile?.intake?.goalIntent || null;
  const fixedClasses = profile?.intake?.fixedClasses === true;
  const fixedHiitPerWeek = profile?.intake?.fixedHiitPerWeek != null ? Number(profile.intake.fixedHiitPerWeek) : null;
  const statusResult = computeStatus({
    acwr,
    isSick,
    readiness,
    redFlags: redFlagsCount,
    cyclePhase,
    hrvVsBaseline,
    phaseDay,
    goalIntent,
    fixedClasses,
    fixedHiitPerWeek
  });

  // No valid check-in today: output must be neutral MAINTAIN; ACWR must not drive RECOVER/REST
  let tag = statusResult.tag;
  let signal = statusResult.signal;
  let reasons = [...(statusResult.reasons || [])];
  let instructionClass = statusResult.instructionClass;
  let prescriptionHint = statusResult.prescriptionHint ?? null;
  if (selectedToday === null) {
    tag = 'MAINTAIN';
    signal = 'ORANGE';
    instructionClass = 'MAINTAIN';
    prescriptionHint = null;
    reasons = ['MISSING_CHECKIN_INPUT'];
  }

  const mode = engineCycleMode(profile);
  const cycleConf = engineCycleConfidence(mode, profile);

  return {
    tag,
    signal,
    reasons,
    instructionClass,
    prescriptionHint,
    acwr,
    acwrWasComputable,
    phaseDayPresent: phaseDay != null,
    acwrBand: acwrBandString(acwr),
    cycleMode: mode,
    cycleConfidence: cycleConf,
    redFlags: selectedToday === null ? null : redFlagsCount,
    redFlagsCount: selectedToday === null ? null : redFlagsCount,
    flagsConfidence: selectedToday === null ? 'LOW' : (sleep != null && rhrToday != null && rhrBaseline28 != null && hrvToday != null && hrvBaseline28 != null ? 'HIGH' : 'LOW'),
    readiness,
    isSick,
    needsCheckin: selectedToday === null
  };
}

function main() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error('Fixtures dir missing:', FIXTURES_DIR);
    process.exit(1);
  }
  if (!fs.existsSync(EXPECTED_DIR)) {
    console.error('Expected dir missing:', EXPECTED_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  let passed = 0;
  let failed = 0;

  console.log('Life simulations (Layer 2)\n');

  for (const file of files.sort()) {
    const name = path.basename(file, '.json');
    const fixturePath = path.join(FIXTURES_DIR, file);
    const expectedPath = path.join(EXPECTED_DIR, `${name}.expected.json`);

    if (!fs.existsSync(expectedPath)) {
      console.log(`  SKIP ${name} (no .expected.json)`);
      continue;
    }

    try {
      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
      const result = runScenario(fixture);

      const wantTag = expected.tag != null ? expected.tag : expected.status;
      const wantSignal = expected.signal != null ? expected.signal : (result.tag === 'PUSH' ? 'GREEN' : result.tag === 'MAINTAIN' ? 'ORANGE' : 'RED');

      const tagOk = result.tag === wantTag;
      const signalOk = result.signal === wantSignal;
      const needsCheckinOk = expected.meta == null || expected.meta.needsCheckin == null ||
        (expected.meta.needsCheckin === true ? (result.needsCheckin === true && result.tag === 'MAINTAIN') : result.needsCheckin === expected.meta.needsCheckin);
      const phaseDayOk = expected.phaseDayPresent == null || result.phaseDayPresent === expected.phaseDayPresent;
      if (expected.cycleConfidence === 'LOW' && result.phaseDayPresent !== false) {
        console.log(`  FAIL ${name}`);
        console.log(`       cycleConfidence LOW requires phaseDayPresent false, got ${result.phaseDayPresent}`);
        failed++;
        continue;
      }
      const acwrBandOk = expected.acwrBand == null || result.acwrBand === expected.acwrBand;
      const cycleModeOk = expected.cycleMode == null || result.cycleMode === expected.cycleMode;
      const cycleConfOk = expected.cycleConfidence == null || result.cycleConfidence === expected.cycleConfidence;
      const redFlagsMinOk = expected.redFlagsMin == null || (result.redFlags != null && result.redFlags >= expected.redFlagsMin);
      const redFlagsCountNullOk = expected.redFlagsCount === undefined || (expected.redFlagsCount === null && result.redFlagsCount === null) || (expected.redFlagsCount !== null && result.redFlagsCount === expected.redFlagsCount);
      const flagsConfidenceOk = expected.meta == null || expected.meta.flagsConfidence == null || result.flagsConfidence === expected.meta.flagsConfidence;
      const flagsConfidenceNotLowOk = expected.flagsConfidenceNotLow == null || (expected.flagsConfidenceNotLow === true && result.flagsConfidence !== 'LOW');
      const instructionClassOk = expected.instructionClass == null || result.instructionClass === expected.instructionClass;
      const prescriptionHintOk = expected.prescriptionHint === undefined || (result.prescriptionHint === expected.prescriptionHint);
      let reasonsContainsOk = true;
      if (Array.isArray(expected.reasonsContains) && expected.reasonsContains.length > 0) {
        if (!Array.isArray(result.reasons)) {
          reasonsContainsOk = false;
        } else {
          const reasonText = result.reasons.join(' ').toLowerCase();
          for (const sub of expected.reasonsContains) {
            if (!reasonText.includes(String(sub).toLowerCase())) {
              reasonsContainsOk = false;
              break;
            }
          }
        }
      }

      if (tagOk && signalOk && needsCheckinOk && phaseDayOk && acwrBandOk && cycleModeOk && cycleConfOk && redFlagsMinOk && redFlagsCountNullOk && flagsConfidenceOk && flagsConfidenceNotLowOk && instructionClassOk && prescriptionHintOk && reasonsContainsOk) {
        const extra = [];
        if (expected.phaseDayPresent != null) extra.push(`phaseDay=${result.phaseDayPresent}`);
        if (expected.cycleConfidence != null) extra.push(`conf=${result.cycleConfidence}`);
        const extraStr = extra.length ? ' ' + extra.join(' ') : '';
        console.log(`  ok   ${name} → ${result.tag} / ${result.signal}${extraStr}`);
        passed++;
      } else {
        console.log(`  FAIL ${name}`);
        console.log(`       derived: acwr=${result.acwr} acwrBand=${result.acwrBand} cycleMode=${result.cycleMode} cycleConfidence=${result.cycleConfidence} phaseDayPresent=${result.phaseDayPresent} redFlagsCount=${result.redFlags} readiness=${result.readiness} isSick=${result.isSick}`);
        if (!tagOk || !signalOk) console.log(`       got tag=${result.tag} signal=${result.signal}, want tag=${wantTag} signal=${wantSignal}`);
        if (!phaseDayOk) console.log(`       got phaseDayPresent=${result.phaseDayPresent}, want ${expected.phaseDayPresent}`);
        if (!acwrBandOk) console.log(`       got acwrBand=${result.acwrBand}, want ${expected.acwrBand}`);
        if (!cycleModeOk) console.log(`       got cycleMode=${result.cycleMode}, want ${expected.cycleMode}`);
        if (!cycleConfOk) console.log(`       got cycleConfidence=${result.cycleConfidence}, want ${expected.cycleConfidence}`);
        if (!redFlagsMinOk) console.log(`       got redFlags=${result.redFlags}, want redFlagsMin=${expected.redFlagsMin}`);
        if (!redFlagsCountNullOk) console.log(`       got redFlagsCount=${result.redFlagsCount}, want redFlagsCount=${expected.redFlagsCount}`);
        if (!flagsConfidenceOk) console.log(`       got flagsConfidence=${result.flagsConfidence}, want meta.flagsConfidence=${expected.meta?.flagsConfidence}`);
        if (expected.flagsConfidenceNotLow && !flagsConfidenceNotLowOk) console.log(`       expected flagsConfidence not LOW, got ${result.flagsConfidence}`);
        if (!instructionClassOk) console.log(`       got instructionClass=${result.instructionClass}, want ${expected.instructionClass}`);
        if (!prescriptionHintOk) console.log(`       got prescriptionHint=${result.prescriptionHint}, want ${expected.prescriptionHint}`);
        if (!reasonsContainsOk) console.log(`       reasons must contain (case-insensitive): ${expected.reasonsContains.join(', ')}`);
        if (expected.meta && expected.meta.needsCheckin && !needsCheckinOk) console.log(`       expected meta.needsCheckin true (MAINTAIN with no check-in today), got needsCheckin=${result.needsCheckin} tag=${result.tag}`);
        if (result.reasons && result.reasons.length) console.log('       reasons:', result.reasons.join('; '));
        failed++;
      }
    } catch (err) {
      console.log(`  FAIL ${name}`, err.message);
      failed++;
    }
  }

  console.log('');
  console.log(`Done: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
