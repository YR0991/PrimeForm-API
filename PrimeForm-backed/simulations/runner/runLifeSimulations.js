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
const { cycleMode: engineCycleMode, cycleConfidence: engineCycleConfidence } = require('../../services/dailyBriefService');

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
  const logs28 = dailyLogs.filter((l) => {
    const d = (l.date || '').slice(0, 10);
    return d && d >= day28Ago && d <= today;
  });
  const logs7 = dailyLogs.filter((l) => {
    const d = (l.date || '').slice(0, 10);
    return d && d >= day7Ago && d <= today;
  });

  // 7d and 28d HRV/RHR baselines (average); engine uses 28d for redFlags/hrvVsBaseline
  const hrv7 = logs7.map((l) => l.hrv != null ? Number(l.hrv) : null).filter((v) => v != null && Number.isFinite(v));
  const rhr7 = logs7.map((l) => l.rhr != null ? Number(l.rhr) : null).filter((v) => v != null && Number.isFinite(v));
  const hrv28 = logs28.map((l) => l.hrv != null ? Number(l.hrv) : null).filter((v) => v != null && Number.isFinite(v));
  const rhr28 = logs28.map((l) => l.rhr != null ? Number(l.rhr) : null).filter((v) => v != null && Number.isFinite(v));
  const hrvBaseline7 = hrv7.length ? (hrv7.reduce((s, v) => s + v, 0) / hrv7.length) : null;
  const rhrBaseline7 = rhr7.length ? (rhr7.reduce((s, v) => s + v, 0) / rhr7.length) : null;
  const hrvBaseline28 = hrv28.length ? Math.round((hrv28.reduce((s, v) => s + v, 0) / hrv28.length) * 10) / 10 : null;
  const rhrBaseline28 = rhr28.length ? Math.round(rhr28.reduce((s, v) => s + v, 0) / rhr28.length) : null;

  const todayLog = dailyLogs.find((l) => (l.date || '').slice(0, 10) === today);
  const hrvToday = todayLog && todayLog.hrv != null ? Number(todayLog.hrv) : null;
  const rhrToday = todayLog && todayLog.rhr != null ? Number(todayLog.rhr) : null;
  const sleep = todayLog && (todayLog.sleep != null || todayLog.sleepHours != null)
    ? Number(todayLog.sleep ?? todayLog.sleepHours)
    : null;
  const readiness = todayLog && todayLog.readiness != null ? Number(todayLog.readiness) : null;
  const isSick = todayLog && todayLog.isSick === true;

  const hrvVsBaseline = hrvBaseline28 != null && hrvBaseline28 > 0 && hrvToday != null
    ? Math.round((hrvToday / hrvBaseline28) * 1000) / 10
    : null;

  // ACWR: last 7 days load vs last 28 days load (sum7 / (sum28/4))
  const loadPerDate = (a) => (a.date || '').slice(0, 10);
  const getLoad = (a) => (a.prime_load != null ? Number(a.prime_load) : (a.load != null ? Number(a.load) : 0));
  const activitiesLast7 = activities.filter((a) => {
    const d = loadPerDate(a);
    return d && d >= day7Ago && d <= today;
  });
  const activitiesLast28 = activities.filter((a) => {
    const d = loadPerDate(a);
    return d && d >= day28Ago && d <= today;
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
  const statusResult = computeStatus({
    acwr,
    isSick,
    readiness,
    redFlags: redFlagsCount,
    cyclePhase,
    hrvVsBaseline,
    phaseDay,
    goalIntent
  });

  const tag = statusResult.tag;
  const signal = statusResult.signal;
  const reasons = [...(statusResult.reasons || [])];
  const instructionClass = statusResult.instructionClass;
  const prescriptionHint = statusResult.prescriptionHint ?? null;

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
    redFlags: redFlagsCount,
    readiness,
    isSick
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
      const redFlagsMinOk = expected.redFlagsMin == null || result.redFlags >= expected.redFlagsMin;
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

      if (tagOk && signalOk && phaseDayOk && acwrBandOk && cycleModeOk && cycleConfOk && redFlagsMinOk && instructionClassOk && prescriptionHintOk && reasonsContainsOk) {
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
        if (!instructionClassOk) console.log(`       got instructionClass=${result.instructionClass}, want ${expected.instructionClass}`);
        if (!prescriptionHintOk) console.log(`       got prescriptionHint=${result.prescriptionHint}, want ${expected.prescriptionHint}`);
        if (!reasonsContainsOk) console.log(`       reasons must contain (case-insensitive): ${expected.reasonsContains.join(', ')}`);
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
