/**
 * Unit tests for lib/activityKeys: deriveStartDateTs, deriveDayKey.
 * Edge case: timezone day boundary (late evening UTC => next day in Europe/Amsterdam).
 * Run: NODE_ENV=test node tests/activityKeys.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const { deriveStartDateTs, deriveDayKey } = require('../lib/activityKeys');

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
  console.log('activityKeys tests\n');

  run('deriveStartDateTs from ISO string', () => {
    const ms = deriveStartDateTs({ start_date_local: '2025-02-15T08:30:00' });
    assert.ok(Number.isFinite(ms));
    assert.strictEqual(new Date(ms).toISOString().slice(0, 10), '2025-02-15');
  });

  run('deriveStartDateTs from date YYYY-MM-DD', () => {
    const ms = deriveStartDateTs({ date: '2025-02-14' });
    assert.ok(Number.isFinite(ms));
    assert.strictEqual(new Date(ms).toISOString().slice(0, 10), '2025-02-14');
  });

  run('deriveDayKey prefers start_date_local (no timezone needed)', () => {
    const key = deriveDayKey({ start_date_local: '2025-02-15T23:00:00' });
    assert.strictEqual(key, '2025-02-15');
  });

  run('deriveDayKey timezone edge: late evening UTC => next day in Europe/Amsterdam', () => {
    // 2025-02-14 22:00 UTC = 2025-02-14 23:00 in Amsterdam (CET+1) => still 14th
    // 2025-02-14 23:00 UTC = 2025-02-15 00:00 in Amsterdam => 15th
    const ts = new Date('2025-02-14T23:00:00Z').getTime();
    const key = deriveDayKey({ startDateTs: ts }, 'Europe/Amsterdam');
    assert.strictEqual(key, '2025-02-15', '23:00 UTC in Amsterdam is next calendar day');
  });

  run('deriveDayKey timezone: early morning UTC in Amsterdam still previous day', () => {
    const ts = new Date('2025-02-15T00:30:00Z').getTime();
    const key = deriveDayKey({ startDateTs: ts }, 'Europe/Amsterdam');
    assert.strictEqual(key, '2025-02-15', '00:30 UTC = 01:30 Amsterdam => 15th');
  });

  run('deriveDayKey without timezone uses UTC (from start_date_local when present)', () => {
    const key = deriveDayKey({ start_date_local: '2025-02-16T10:00:00' });
    assert.strictEqual(key, '2025-02-16');
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
