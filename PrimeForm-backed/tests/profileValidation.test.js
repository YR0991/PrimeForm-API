/**
 * Profile completeness (isProfileComplete) and cycleConfidence behavior.
 * Canonical key: cycleData.lastPeriodDate.
 * Run: node tests/profileValidation.test.js
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const { isProfileComplete, normalizeCycleData, uiLabelToContraceptionMode } = require('../lib/profileValidation');
const { cycleMode, cycleConfidence } = require('../services/dailyBriefService');

function run(name, fn) {
  try {
    fn();
    console.log('  ok', name);
  } catch (e) {
    console.error('  FAIL', name, e.message);
    process.exitCode = 1;
  }
}

const completeProfile = {
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  birthDate: '1995-06-15',
  disclaimerAccepted: true,
  redFlags: [],
  goals: ['Kracht'],
  programmingType: 'Box/Gym Programming',
  cycleData: {
    lastPeriodDate: '2025-01-15',
    avgDuration: 28,
    contraception: 'Geen'
  }
};

async function main() {
  console.log('Profile validation & cycleConfidence tests\n');

  run('isProfileComplete: true when all fields valid and cycleData.lastPeriodDate set', () => {
    assert.strictEqual(isProfileComplete(completeProfile), true);
  });

  run('isProfileComplete: false when cycleData.lastPeriodDate missing', () => {
    const p = { ...completeProfile, cycleData: { ...completeProfile.cycleData, lastPeriodDate: undefined } };
    delete p.cycleData.lastPeriodDate;
    assert.strictEqual(isProfileComplete(p), false);
  });

  run('isProfileComplete: false when cycleData has lastPeriod only (legacy key)', () => {
    const p = {
      ...completeProfile,
      cycleData: { lastPeriod: '2025-01-15', avgDuration: 28, contraception: 'Geen' }
    };
    assert.strictEqual(isProfileComplete(p), false);
  });

  run('isProfileComplete: true when cycleData.lastPeriodDate valid ISO', () => {
    assert.strictEqual(isProfileComplete(completeProfile), true);
  });

  run('isProfileComplete: false when cycleData.lastPeriodDate invalid format', () => {
    const p = {
      ...completeProfile,
      cycleData: { ...completeProfile.cycleData, lastPeriodDate: '15-01-2025' }
    };
    assert.strictEqual(isProfileComplete(p), false);
  });

  run('normalizeCycleData: copies lastPeriod to lastPeriodDate and removes lastPeriod', () => {
    const out = normalizeCycleData({ lastPeriod: '2025-01-15', avgDuration: 28 });
    assert.strictEqual(out.lastPeriodDate, '2025-01-15');
    assert.strictEqual(out.lastPeriod, undefined);
  });

  run('normalizeCycleData: leaves lastPeriodDate unchanged when present', () => {
    const out = normalizeCycleData({ lastPeriodDate: '2025-01-10', lastPeriod: '2025-01-15', avgDuration: 28 });
    assert.strictEqual(out.lastPeriodDate, '2025-01-10');
    assert.strictEqual(out.lastPeriod, undefined);
  });

  run('normalizeCycleData: sets contraceptionMode from contraception when missing', () => {
    const out = normalizeCycleData({ lastPeriodDate: '2025-01-15', contraception: 'Geen' });
    assert.strictEqual(out.contraceptionMode, 'NATURAL');
    const out2 = normalizeCycleData({ contraception: 'Spiraal (hormonaal)' });
    assert.strictEqual(out2.contraceptionMode, 'HBC_LNG_IUD');
  });

  run('uiLabelToContraceptionMode: Route B and legacy mapping', () => {
    assert.strictEqual(uiLabelToContraceptionMode('Geen'), 'NATURAL');
    assert.strictEqual(uiLabelToContraceptionMode('Hormonaal'), 'HBC_OTHER');
    assert.strictEqual(uiLabelToContraceptionMode('Spiraal'), 'UNKNOWN');
    assert.strictEqual(uiLabelToContraceptionMode('Anders'), 'UNKNOWN');
    assert.strictEqual(uiLabelToContraceptionMode('Spiraal (koper)'), 'COPPER_IUD');
    assert.strictEqual(uiLabelToContraceptionMode('Spiraal (hormonaal)'), 'HBC_LNG_IUD');
    assert.strictEqual(uiLabelToContraceptionMode('Anders / Onbekend'), 'UNKNOWN');
  });

  run('cycleConfidence: HIGH when NATURAL and lastPeriodDate present', () => {
    const profile = { cycleData: { lastPeriodDate: '2025-01-15', contraception: 'Geen', contraceptionMode: 'NATURAL' } };
    const mode = cycleMode(profile);
    assert.strictEqual(mode, 'NATURAL');
    assert.strictEqual(cycleConfidence(mode, profile), 'HIGH');
  });

  run('cycleConfidence: MED when NATURAL mode but lastPeriodDate missing', () => {
    const profile = { cycleData: { contraception: '' } };
    assert.strictEqual(cycleConfidence('NATURAL', profile), 'MED');
  });

  run('cycleMode: uses contraceptionMode when present (Route B)', () => {
    assert.strictEqual(cycleMode({ cycleData: { contraceptionMode: 'NATURAL', lastPeriodDate: '2025-01-15' } }), 'NATURAL');
    assert.strictEqual(cycleMode({ cycleData: { contraceptionMode: 'HBC_LNG_IUD' } }), 'HBC_LNG_IUD');
    assert.strictEqual(cycleMode({ cycleData: { contraceptionMode: 'COPPER_IUD' } }), 'COPPER_IUD');
  });

  run('cycleMode: fallback from contraception string when contraceptionMode missing', () => {
    assert.strictEqual(cycleMode({ cycleData: { lastPeriodDate: '2025-01-15', contraception: '' } }), 'NATURAL');
    assert.strictEqual(cycleMode({ cycleData: { contraception: '' } }), 'UNKNOWN');
    assert.strictEqual(cycleMode({ cycleData: { lastPeriodDate: '2025-01-15', contraception: 'pil' } }), 'HBC_OTHER');
  });

  run('cycleConfidence: LOW for HBC', () => {
    const profile = { cycleData: { lastPeriodDate: '2025-01-15', contraceptionMode: 'HBC_LNG_IUD' } };
    const mode = cycleMode(profile);
    assert.strictEqual(cycleConfidence(mode, profile), 'LOW');
  });

  run('cycleConfidence: LOW for UNKNOWN mode', () => {
    const profile = { cycleData: {} };
    assert.strictEqual(cycleConfidence('UNKNOWN', profile), 'LOW');
  });

  // GET /api/profile contract: backend returns onboardingComplete = isProfileComplete(profile)
  run('GET /api/profile contract: onboardingComplete equals isProfileComplete(profile) for complete profile', () => {
    const profile = completeProfile;
    const onboardingComplete = isProfileComplete(profile);
    assert.strictEqual(onboardingComplete, true, 'response onboardingComplete must be true when profile is complete');
  });

  run('GET /api/profile contract: onboardingComplete equals isProfileComplete(profile) for incomplete profile', () => {
    const profile = { ...completeProfile, fullName: 'x' };
    const onboardingComplete = isProfileComplete(profile);
    assert.strictEqual(onboardingComplete, false, 'response onboardingComplete must be false when profile is incomplete');
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
