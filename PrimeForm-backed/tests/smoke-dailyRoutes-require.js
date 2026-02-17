/**
 * Smoke test: assert that dailyRoutes.js (and thus lib/activityDate.js) can be required.
 * Run from PrimeForm-backed: node tests/smoke-dailyRoutes-require.js
 * Fails on Linux if activityDate.js is missing or wrong casing (e.g. activitydate.js).
 *
 * Behaviour: POST /api/save-checkin does NOT require lastPeriodDate. It uses body.lastPeriodDate
 * if present, else profile.cycleData.lastPeriodDate (or profile.lastPeriodDate), else null.
 * When menstruationStarted === true, effectiveLastPeriodDate is set to today. When unknown,
 * cycle phase/currentCycleDay are returned as null.
 */

'use strict';

try {
  require('../routes/dailyRoutes');
  console.log('ok: dailyRoutes (and lib/activityDate) resolved');
} catch (e) {
  console.error('FAIL: dailyRoutes require failed', e.message);
  if (e.code === 'MODULE_NOT_FOUND') console.error('  (check lib/activityDate.js exists with correct casing on case-sensitive FS)');
  process.exit(1);
}
process.exit(0);
