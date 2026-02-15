/**
 * Acceptance tests for statusEngine.computeStatus.
 * Conflicting scenarios: high readiness + high ACWR; low readiness + low ACWR; isSick.
 * Run: node tests/statusEngine.test.js
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const { computeStatus } = require('../services/statusEngine');

function run(name, fn) {
  try {
    fn();
    console.log('  ok', name);
  } catch (e) {
    console.error('  FAIL', name, e.message);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('statusEngine acceptance tests\n');

  // 1) isSick forces RECOVER regardless of other inputs
  run('isSick true → RECOVER', () => {
    const r = computeStatus({ isSick: true, readiness: 9, acwr: 1.0, cyclePhase: 'Follicular' });
    assert.strictEqual(r.tag, 'RECOVER');
    assert.ok(r.reasons.some((s) => s.includes('Ziek') || s.includes('Herstel')));
  });

  // 2) High readiness + high ACWR → ACWR ceiling wins (RECOVER)
  run('high readiness + high ACWR → RECOVER (ACWR ceiling)', () => {
    const r = computeStatus({
      acwr: 1.4,
      isSick: false,
      readiness: 9,
      redFlags: 0,
      cyclePhase: 'Follicular',
      hrvVsBaseline: 100,
      phaseDay: 10
    });
    assert.strictEqual(r.tag, 'RECOVER');
    assert.ok(r.reasons.some((s) => s.includes('ACWR') && s.includes('grens')));
  });

  // 3) Low readiness + low ACWR → MAINTAIN or RECOVER (no PUSH)
  run('low readiness + low ACWR → no PUSH', () => {
    const r = computeStatus({
      acwr: 0.7,
      isSick: false,
      readiness: 5,
      redFlags: 0,
      cyclePhase: 'Luteal',
      hrvVsBaseline: 100,
      phaseDay: 22
    });
    assert.ok(['MAINTAIN', 'RECOVER', 'REST'].includes(r.tag));
    assert.notStrictEqual(r.tag, 'PUSH');
  });

  // 4) ACWR > 1.5 forces RECOVER even if base would be PUSH
  run('ACWR > 1.5 → RECOVER (spike ceiling)', () => {
    const r = computeStatus({
      acwr: 1.6,
      isSick: false,
      readiness: 9,
      redFlags: 0,
      cyclePhase: 'Follicular'
    });
    assert.strictEqual(r.tag, 'RECOVER');
  });

  // 5) ACWR < 0.8 blocks PUSH (base PUSH from readiness/cycle → MAINTAIN)
  run('ACWR < 0.8 blocks PUSH → MAINTAIN', () => {
    const r = computeStatus({
      acwr: 0.75,
      isSick: false,
      readiness: 8,
      redFlags: 0,
      cyclePhase: 'Follicular',
      hrvVsBaseline: 100
    });
    assert.strictEqual(r.tag, 'MAINTAIN');
    assert.ok(r.reasons.some((s) => s.includes('ACWR') && s.includes('grens')));
  });

  // 6) Sweet spot ACWR + high readiness + Follicular → PUSH
  run('sweet spot ACWR + readiness/cycle → PUSH', () => {
    const r = computeStatus({
      acwr: 1.0,
      isSick: false,
      readiness: 8,
      redFlags: 0,
      cyclePhase: 'Follicular'
    });
    assert.strictEqual(r.tag, 'PUSH');
  });

  // 7) Option B: null ACWR + base PUSH → MAINTAIN (no PUSH without ACWR)
  run('null ACWR + base PUSH → MAINTAIN (Option B)', () => {
    const r = computeStatus({
      acwr: null,
      isSick: false,
      readiness: 8,
      redFlags: 0,
      cyclePhase: 'Follicular'
    });
    assert.strictEqual(r.tag, 'MAINTAIN');
    assert.ok(r.reasons.some((s) => s.includes('NO_ACWR_NO_PUSH')));
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
