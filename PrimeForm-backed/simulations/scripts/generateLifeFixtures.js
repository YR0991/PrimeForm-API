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
  '13_route_b_copper_iud': 'MAINTAIN'
};

const expectedPhaseDayPresent = {
  '11_route_b_natural': true,
  '12_route_b_hbc_lng_iud': false,
  '13_route_b_copper_iud': false
};

for (const s of scenarios) {
  const fixture = { today: s.today, profile: s.profile, dailyLogs: s.dailyLogs, activities: s.activities };
  fs.writeFileSync(path.join(fixturesDir, `${s.name}.json`), JSON.stringify(fixture, null, 2));
  const tag = expectedTags[s.name];
  const signal = tag === 'PUSH' ? 'GREEN' : tag === 'MAINTAIN' ? 'ORANGE' : 'RED';
  const expected = { tag, signal };
  if (expectedPhaseDayPresent[s.name] !== undefined) expected.phaseDayPresent = expectedPhaseDayPresent[s.name];
  fs.writeFileSync(path.join(expectedDir, `${s.name}.expected.json`), JSON.stringify(expected, null, 2));
  console.log('Wrote', s.name);
}
console.log('Done.');
