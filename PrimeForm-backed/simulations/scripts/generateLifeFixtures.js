/**
 * One-time script to generate life fixtures and expected files.
 * Run from PrimeForm-backed: node simulations/scripts/generateLifeFixtures.js
 */
const fs = require('fs');
const path = require('path');

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function buildLogs(today, overrides = {}) {
  const def = { hrv: 50, rhr: 55, sleepHours: 7, readiness: 7, isSick: false };
  const logs = [];
  for (let i = -55; i <= 0; i++) {
    const date = addDays(today, i);
    const o = overrides[date] || overrides[i] || {};
    logs.push({
      date,
      hrv: o.hrv ?? def.hrv,
      rhr: o.rhr ?? def.rhr,
      sleepHours: o.sleepHours ?? def.sleepHours,
      readiness: o.readiness ?? def.readiness,
      isSick: o.isSick ?? def.isSick
    });
  }
  return logs;
}

function buildActivities(today, loadPerDayOrList) {
  if (Array.isArray(loadPerDayOrList)) return loadPerDayOrList;
  const list = [];
  for (let i = -27; i <= 0; i++) {
    const date = addDays(today, i);
    const load = loadPerDayOrList[date] ?? loadPerDayOrList[i] ?? 0;
    if (load > 0) list.push({ date, load });
  }
  return list;
}

/** Build activities so ACWR (sum7 / (sum28/4)) equals target. Window: last 7d = today-7..today (8 days), last 28d = today-28..today (29 days). sum28=400 → chronic=100. */
function activitiesForExactAcwr(today, targetAcwr) {
  const sum28 = 400;
  const chronic = sum28 / 4;
  const sum7 = Math.round(targetAcwr * chronic * 100) / 100;
  const list = [];
  const day7Ago = addDays(today, -7);
  if (targetAcwr === 1.30) {
    for (let i = 0; i < 5; i++) list.push({ date: addDays(today, -i), load: 26 });
    for (let i = 8; i < 26; i++) list.push({ date: addDays(today, -i), load: 13 });
    for (let i = 26; i <= 28; i++) list.push({ date: addDays(today, -i), load: 12 });
  } else if (targetAcwr === 1.50) {
    for (let i = 0; i < 5; i++) list.push({ date: addDays(today, -i), load: 26 });
    list.push({ date: addDays(today, -5), load: 20 });
    for (let i = 8; i < 18; i++) list.push({ date: addDays(today, -i), load: 25 });
  } else if (targetAcwr === 0.80) {
    list.push({ date: addDays(today, 0), load: 26 });
    list.push({ date: addDays(today, -1), load: 26 });
    list.push({ date: addDays(today, -2), load: 26 });
    list.push({ date: addDays(today, -3), load: 2 });
    for (let i = 8; i < 8 + 16; i++) list.push({ date: addDays(today, -i), load: 20 });
  } else {
    let rem = sum7;
    for (let i = 0; i <= 7 && rem > 0; i++) {
      const load = Math.min(26, Math.round(rem * 10) / 10);
      if (load > 0) { list.push({ date: addDays(today, -i), load }); rem -= load; }
    }
    const sum7Got = list.reduce((s, a) => s + (a.date >= day7Ago && a.date <= today ? a.load : 0), 0);
    const restSum = sum28 - sum7Got;
    for (let i = 8; i <= 28; i++) list.push({ date: addDays(today, -i), load: Math.round((restSum / 21) * 10) / 10 });
  }
  return list.filter((a) => a.load > 0);
}

/** Build logs with optional null for today's hrv/rhr (keys: { hrv: true } or { rhr: true }). */
function buildLogsWithNull(today, nullKeys, overrides = {}) {
  const logs = buildLogs(today, overrides);
  const todayStr = today.slice(0, 10);
  const entry = logs.find((l) => (l.date || '').slice(0, 10) === todayStr);
  if (entry) {
    if (nullKeys.hrv) entry.hrv = null;
    if (nullKeys.rhr) entry.rhr = null;
  }
  return logs;
}

const fixturesDir = path.join(__dirname, '../fixtures/life');
const expectedDir = path.join(__dirname, '../expected/life');
fs.mkdirSync(fixturesDir, { recursive: true });
fs.mkdirSync(expectedDir, { recursive: true });

const today1 = '2025-03-24';
const lastPeriodFollicular = '2025-03-15'; // day 9 = Follicular
const lastPeriodLuteal = '2025-03-01';     // day 23 = Luteal
const lastPeriodMenstrual = '2025-03-23';   // day 1 = Menstrual (Elite override 1-3)

// 1) stable base + sweet spot + good readiness => PUSH
const logs1 = buildLogs(today1, { [today1]: { readiness: 8 } });
const acts1 = [];
for (let i = -27; i <= 0; i++) {
  const date = addDays(today1, i);
  const weekly = i >= -6 ? 14.3 : 14.3;
  if (i <= -7 || (i >= -6 && i <= 0)) acts1.push({ date, load: i >= -6 ? 100 / 7 : 300 / 21 });
}
// sum7=100, sum28=400 -> acwr 1.0
acts1.length = 0;
for (let i = 0; i < 4; i++) acts1.push({ date: addDays(today1, -i * 2), load: 25 });
for (let i = 4; i < 12; i++) acts1.push({ date: addDays(today1, -7 - i * 2), load: 25 });
// sum7 = 100, sum28 = 8*25 = 200... need sum28=400 so 16 activities of 25 in 28d, 4 in 7d
acts1.length = 0;
for (let i = 0; i < 16; i++) acts1.push({ date: addDays(today1, -i), load: 25 });
// sum28 = 400, sum7 = 4*25 = 100. acwr = 100/(400/4) = 1.0

// Activity patterns: backend "last 7 days" = date >= today-7 (8 calendar days). So sum7 = load in days 0..7, sum28 = load in days 0..27.
// ACWR 1.0: sum7=100, sum28=400 → 4 activities of 25 in days 0-3 only (in 8d window), 12 of 25 in days 8-19 (outside 8d window).
const acwr1 = () => { const a = []; for (let i = 0; i < 4; i++) a.push({ date: addDays(today1, -i), load: 25 }); for (let i = 8; i < 20; i++) a.push({ date: addDays(today1, -i), load: 25 }); return a; };
// ACWR 1.6: sum7=160, sum28=400 → 4 of 40 in 0-3, 12 of 20 in 8-19.
const acwr16 = () => { const a = []; for (let i = 0; i < 4; i++) a.push({ date: addDays(today1, -i), load: 40 }); for (let i = 8; i < 20; i++) a.push({ date: addDays(today1, -i), load: 20 }); return a; };
// ACWR 0.71: sum7=25, sum28=140 → 1 of 25 on day 0, 23 of 5 on days 8-30.
const acwr07 = () => { const a = []; a.push({ date: addDays(today1, 0), load: 25 }); for (let i = 8; i < 31; i++) a.push({ date: addDays(today1, -i), load: 5 }); return a; };

const scenarios = [
  {
    name: '01_stable_sweet_spot_push',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8 } }),
    activities: acwr1()
  },
  {
    name: '02_spike_acwr_recover',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 9 } }),
    activities: acwr16()
  },
  {
    name: '03_low_load_maintain',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8 } }),
    activities: acwr07()
  },
  {
    name: '04_luteal_lethargy_maintain',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodLuteal, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 5, hrv: 58 } }),
    activities: acwr1()
  },
  {
    name: '05_elite_menstrual_push',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodMenstrual, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8, hrv: 50 } }),
    activities: acwr1()
  },
  {
    name: '06_sick_recover',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8, isSick: true } }),
    activities: acwr1()
  },
  {
    name: '07_red_flags_recover',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7, sleepHours: 5, hrv: 40, rhr: 62 } }),
    activities: acwr1()
  },
  {
    name: '08_missing_activity_no_push',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8 } }),
    activities: []
  },
  {
    name: '09_conflicting_low_readiness_no_push',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 5, hrv: 55 } }),
    activities: acwr1()
  },
  {
    name: '10_long_term_fatigue_hrv_depressed',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: (() => {
      const logs = buildLogs(today1, { [today1]: { hrv: 40 } });
      for (let i = 1; i <= 14; i++) {
        const date = addDays(today1, -i);
        const entry = logs.find((l) => l.date === date);
        if (entry) entry.hrv = 42;
      }
      return logs;
    })(),
    activities: acwr1()
  },
  // Route B: same logs/activities, different contraceptionMode; tag must not change (cycle overrides gated off).
  {
    name: '11_route_b_natural',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28, contraceptionMode: 'NATURAL' } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7 } }),
    activities: acwr1()
  },
  {
    name: '12_route_b_hbc_lng_iud',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28, contraceptionMode: 'HBC_LNG_IUD' } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7 } }),
    activities: acwr1()
  },
  {
    name: '13_route_b_copper_iud',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28, contraceptionMode: 'COPPER_IUD' } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7 } }),
    activities: acwr1()
  },
  // 14: Elite would trigger but gated (HBC_LNG_IUD)
  {
    name: '14_elite_would_trigger_but_gated_hbc',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodMenstrual, cycleLength: 28, contraceptionMode: 'HBC_LNG_IUD' } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8, hrv: 50 } }),
    activities: acwr1()
  },
  // 15: Lethargy would trigger but gated (COPPER_IUD)
  {
    name: '15_lethargy_would_trigger_but_gated_copper',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodLuteal, cycleLength: 28, contraceptionMode: 'COPPER_IUD' } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 5, hrv: 58 } }),
    activities: acwr1()
  },
  // 16: Progress intent soft rule — sweet spot, redFlags 0, readiness >= 6, goalIntent PROGRESS → prescriptionHint PROGRESSIVE_STIMULUS
  {
    name: '16_progress_intent_soft_rule',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 }, goalIntent: 'PROGRESS' },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 6 } }),
    activities: acwr1()
  },
  // 17: ACWR exactly 1.30 (inclusive upper bound for sweet spot; base PUSH → stays PUSH)
  {
    name: '17_acwr_boundary_1_30',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8 } }),
    activities: activitiesForExactAcwr(today1, 1.30)
  },
  // 18: ACWR exactly 1.50 (exclusive for spike: >1.5 → RECOVER; 1.50 is in 1.3-1.5 band, PUSH → RECOVER via >1.3)
  {
    name: '18_acwr_boundary_1_50',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8 } }),
    activities: activitiesForExactAcwr(today1, 1.50)
  },
  // 19: ACWR exactly 0.80 (inclusive lower bound for sweet spot; base PUSH → stays PUSH)
  {
    name: '19_acwr_boundary_0_80',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 8 } }),
    activities: activitiesForExactAcwr(today1, 0.80)
  },
  // 20a: 1 red flag → RECOVER
  {
    name: '20_redflags_1_recover',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7, sleepHours: 5, hrv: 50, rhr: 55 } }),
    activities: acwr1()
  },
  // 20b: 2 red flags → REST
  {
    name: '20_redflags_2_rest',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7, sleepHours: 5, hrv: 40, rhr: 62 } }),
    activities: acwr1()
  },
  // 21: today HRV null — runner does not crash; redFlags not computed → 0; expected tag per base (readiness 7 Follicular = MAINTAIN)
  {
    name: '21_missing_hrv_today',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogsWithNull(today1, { hrv: true }, { [today1]: { readiness: 7 } }),
    activities: acwr1()
  },
  // 22: today RHR null — same
  {
    name: '22_missing_rhr_today',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 } },
    dailyLogs: buildLogsWithNull(today1, { rhr: true }, { [today1]: { readiness: 7 } }),
    activities: acwr1()
  },
  // 23: NATURAL but lastPeriodDate missing → cycleConfidence LOW, phaseDayPresent false, no Elite/Lethargy
  {
    name: '23_natural_missing_lastPeriodDate',
    today: today1,
    profile: { cycleData: { contraceptionMode: 'NATURAL', cycleLength: 28 } },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7 } }),
    activities: acwr1()
  },
  // 24: goalIntent PROGRESS, sweet spot, readiness 7, but redFlags === 1 → no prescriptionHint, no GOAL_PROGRESS
  {
    name: '24_progress_intent_blocked_by_redflag',
    today: today1,
    profile: { cycleData: { lastPeriodDate: lastPeriodFollicular, cycleLength: 28 }, goalIntent: 'PROGRESS' },
    dailyLogs: buildLogs(today1, { [today1]: { readiness: 7, sleepHours: 5, hrv: 50, rhr: 55 } }),
    activities: acwr1()
  }
];

const expectedTags = {
  '01_stable_sweet_spot_push': 'PUSH',
  '02_spike_acwr_recover': 'RECOVER',
  '03_low_load_maintain': 'MAINTAIN',
  '04_luteal_lethargy_maintain': 'MAINTAIN',
  '05_elite_menstrual_push': 'PUSH',
  '06_sick_recover': 'RECOVER',
  '07_red_flags_recover': 'REST',
  '08_missing_activity_no_push': 'MAINTAIN',
  '09_conflicting_low_readiness_no_push': 'MAINTAIN',
  '10_long_term_fatigue_hrv_depressed': 'RECOVER',
  '11_route_b_natural': 'MAINTAIN',
  '12_route_b_hbc_lng_iud': 'MAINTAIN',
  '13_route_b_copper_iud': 'MAINTAIN',
  '14_elite_would_trigger_but_gated_hbc': 'MAINTAIN',
  '15_lethargy_would_trigger_but_gated_copper': 'MAINTAIN',
  '16_progress_intent_soft_rule': 'MAINTAIN',
  '17_acwr_boundary_1_30': 'PUSH',
  '18_acwr_boundary_1_50': 'RECOVER',
  '19_acwr_boundary_0_80': 'PUSH',
  '20_redflags_1_recover': 'RECOVER',
  '20_redflags_2_rest': 'REST',
  '21_missing_hrv_today': 'MAINTAIN',
  '22_missing_rhr_today': 'MAINTAIN',
  '23_natural_missing_lastPeriodDate': 'MAINTAIN',
  '24_progress_intent_blocked_by_redflag': 'RECOVER'
};

const expectedPhaseDayPresent = {
  '11_route_b_natural': true,
  '12_route_b_hbc_lng_iud': false,
  '13_route_b_copper_iud': false
};

const expectedCycleConfidence = {
  '11_route_b_natural': 'HIGH',
  '12_route_b_hbc_lng_iud': 'LOW',
  '13_route_b_copper_iud': 'LOW'
};

const expectedExtra = {
  '14_elite_would_trigger_but_gated_hbc': { cycleConfidence: 'LOW', phaseDayPresent: false },
  '15_lethargy_would_trigger_but_gated_copper': { cycleConfidence: 'LOW', phaseDayPresent: false },
  '16_progress_intent_soft_rule': { instructionClass: 'MAINTAIN', prescriptionHint: 'PROGRESSIVE_STIMULUS', reasonsContains: ['GOAL_PROGRESS'] },
  '17_acwr_boundary_1_30': { acwrBand: '0.8-1.3', instructionClass: 'HARD_PUSH' },
  '18_acwr_boundary_1_50': { acwrBand: '1.3-1.5', instructionClass: 'ACTIVE_RECOVERY', reasonsContains: ['ACWR'] },
  '19_acwr_boundary_0_80': { acwrBand: '0.8-1.3', instructionClass: 'HARD_PUSH' },
  '20_redflags_1_recover': { redFlagsMin: 1, instructionClass: 'ACTIVE_RECOVERY' },
  '20_redflags_2_rest': { redFlagsMin: 2, instructionClass: 'NO_TRAINING' },
  '21_missing_hrv_today': {},
  '22_missing_rhr_today': {},
  '23_natural_missing_lastPeriodDate': { cycleConfidence: 'MED', phaseDayPresent: false },
  '24_progress_intent_blocked_by_redflag': { redFlagsMin: 1, prescriptionHint: null }
};

for (const s of scenarios) {
  const fixture = { today: s.today, profile: s.profile, dailyLogs: s.dailyLogs, activities: s.activities };
  fs.writeFileSync(path.join(fixturesDir, `${s.name}.json`), JSON.stringify(fixture, null, 2));
  const tag = expectedTags[s.name];
  const signal = tag === 'PUSH' ? 'GREEN' : tag === 'MAINTAIN' ? 'ORANGE' : 'RED';
  const expected = { tag, signal };
  if (expectedPhaseDayPresent[s.name] !== undefined) expected.phaseDayPresent = expectedPhaseDayPresent[s.name];
  if (expectedCycleConfidence[s.name] !== undefined) expected.cycleConfidence = expectedCycleConfidence[s.name];
  if (expectedExtra[s.name]) Object.assign(expected, expectedExtra[s.name]);
  fs.writeFileSync(path.join(expectedDir, `${s.name}.expected.json`), JSON.stringify(expected, null, 2));
  console.log('Wrote', s.name);
}
console.log('Done.');
