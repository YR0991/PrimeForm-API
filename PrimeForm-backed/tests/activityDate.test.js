/**
 * Unit tests for lib/activityDate: getActivityDay, relativeDayLabel.
 * Ensures UTC vs local day mismatch is fixed: activity on brief day → "vandaag", never "gisteren".
 * Run: node tests/activityDate.test.js
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const { getActivityDay, relativeDayLabel } = require('../lib/activityDate');

function run(name, fn) {
  try {
    fn();
    console.log('  ok', name);
  } catch (e) {
    console.error('  FAIL', name, e.message);
    process.exitCode = 1;
  }
}

function main() {
  console.log('activityDate tests\n');

  const briefDay = '2026-02-15';

  run('relativeDayLabel: same day → vandaag', () => {
    assert.strictEqual(relativeDayLabel('2026-02-15', briefDay), 'vandaag');
  });

  run('relativeDayLabel: previous day → gisteren', () => {
    assert.strictEqual(relativeDayLabel('2026-02-14', briefDay), 'gisteren');
  });

  run('relativeDayLabel: other day → op YYYY-MM-DD', () => {
    assert.strictEqual(relativeDayLabel('2026-02-10', briefDay), 'op 2026-02-10');
  });

  run('getActivityDay: date canonical → YYYY-MM-DD', () => {
    assert.strictEqual(getActivityDay({ date: '2026-02-15' }), '2026-02-15');
  });

  run('getActivityDay: start_date_local → local day string (vandaag case)', () => {
    const activity = { start_date_local: '2026-02-15T10:00:00+01:00' };
    assert.strictEqual(getActivityDay(activity), '2026-02-15');
    assert.strictEqual(relativeDayLabel(getActivityDay(activity), briefDay), 'vandaag');
  });

  run('getActivityDay: start_date UTC evening, start_date_local next day → label vandaag', () => {
    const activity = {
      start_date: '2026-02-14T23:30:00Z',
      start_date_local: '2026-02-15T00:30:00+01:00'
    };
    assert.strictEqual(getActivityDay(activity), '2026-02-15');
    assert.strictEqual(relativeDayLabel(getActivityDay(activity), briefDay), 'vandaag');
  });

  run('getActivityDay: only start_date (UTC) fallback', () => {
    assert.strictEqual(getActivityDay({ start_date: '2026-02-14T23:30:00Z' }), '2026-02-14');
  });

  run('relativeDayLabel: activityDay === briefDay never gisteren', () => {
    assert.notStrictEqual(relativeDayLabel('2026-02-15', '2026-02-15'), 'gisteren');
    assert.strictEqual(relativeDayLabel('2026-02-15', '2026-02-15'), 'vandaag');
  });

  console.log('\nDone.');
}

main();
