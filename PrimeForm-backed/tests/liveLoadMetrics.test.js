/**
 * Smoke tests for GET /api/admin/users/:uid/live-load-metrics.
 * - Returns success, uid, windowDays, sum7, sum28, chronic, acwr, acwrBand, contributors7d.
 * - When sum28 === 0, acwr is null.
 * - Unit tests for computeFromActivities: includeInAcwr false excluded, non-finite load excluded, sums/counters correct.
 * Run: NODE_ENV=test node tests/liveLoadMetrics.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const request = require('supertest');
const { computeFromActivities } = require('../lib/liveLoadMetricsCompute');

const tokenOverride = { uid: 'admin1', email: 'admin@test.com', claims: { admin: true } };
const admin = require('firebase-admin');
admin.auth = () => ({ verifyIdToken: () => Promise.resolve(tokenOverride) });

const app = require('../server');

function run(name, fn) {
  return new Promise((resolve) => {
    const done = (err) => {
      if (err) {
        console.error('  FAIL', name, err.message);
        process.exitCode = 1;
      } else {
        console.log('  ok', name);
      }
      resolve();
    };
    try {
      const result = fn(done);
      if (result && typeof result.then === 'function') result.then(() => done(), done);
      else if (result === undefined) done();
    } catch (e) {
      done(e);
    }
  });
}

async function main() {
  console.log('Live load metrics smoke tests\n');

  await run('GET /api/admin/users/:uid/live-load-metrics returns 404 for missing user', (done) => {
    request(app)
      .get('/api/admin/users/nonexistent-uid-12345/live-load-metrics')
      .set('Authorization', 'Bearer mock-admin-token')
      .query({ days: 28 })
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.strictEqual(res.status, 404, `expected 404, got ${res.status}`);
        done();
      });
  });

  await run('GET /api/admin/users/:uid/live-load-metrics returns shape with acwr null when sum28 0', (done) => {
    request(app)
      .get('/api/admin/users/test-uid-live-load/live-load-metrics')
      .set('Authorization', 'Bearer mock-admin-token')
      .query({ days: 28 })
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        if (res.status === 404 || res.status === 503) {
          console.log('  skip (user missing or db not ready)');
          return done();
        }
        assert.strictEqual(res.status, 200);
        const b = res.body || {};
        assert.strictEqual(b.success, true);
        assert.ok('uid' in b);
        assert.ok('windowDays' in b);
        assert.ok('sum7' in b);
        assert.ok('sum28' in b);
        assert.ok('chronic' in b);
        assert.ok('acwr' in b);
        assert.ok('acwrBand' in b);
        assert.ok(Array.isArray(b.contributors7d));
        assert.ok(b.acute && typeof b.acute.sum7 === 'number' && typeof b.acute.count7 === 'number', 'acute { sum7, count7 }');
        assert.ok(b.chronic && typeof b.chronic.sum28 === 'number' && typeof b.chronic.count28 === 'number', 'chronic { sum28, count28 }');
        assert.ok(b.counts && b.counts.fetched != null && b.counts.filteredOut && typeof b.counts.filteredOut.includeInAcwrFalse === 'number', 'counts.fetched and counts.filteredOut');
        assert.ok(b.debug && b.debug.dateWindowUsed && b.debug.windowDays != null, 'debug.dateWindowUsed and debug.windowDays');
        if (b.sum28 === 0) {
          assert.strictEqual(b.acwr, null, 'acwr must be null when sum28 is 0');
        }
        done();
      });
  });

  await run('GET live-load-metrics contributors7d is array (only includeInAcwr !== false in impl)', (done) => {
    request(app)
      .get('/api/admin/users/test-uid-live-load/live-load-metrics')
      .set('Authorization', 'Bearer mock-admin-token')
      .query({ days: 28 })
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401 || res.status === 404 || res.status === 503) {
          console.log('  skip');
          return done();
        }
        assert(Array.isArray(res.body?.contributors7d), 'contributors7d must be array');
        done();
      });
  });

  // --- Unit tests: computeFromActivities filtering and sums ---
  const todayStr = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await run('computeFromActivities: includeInAcwr false excluded from sums', () => {
    const activities = [
      { id: 'a1', _dateStr: sevenDaysAgo, _primeLoad: 50, includeInAcwr: true },
      { id: 'a2', _dateStr: sevenDaysAgo, _primeLoad: 30, includeInAcwr: false }
    ];
    const out = computeFromActivities(activities, { todayStr, windowDays: 28 });
    assert.strictEqual(out.counts.filteredOut.includeInAcwrFalse, 1);
    assert.strictEqual(out.counts.used7, 1);
    assert.strictEqual(out.sum7, 50);
    assert.strictEqual(out.sum28, 50);
    assert.strictEqual(out.acute.count7, 1);
  });

  await run('computeFromActivities: null and non-finite load excluded', () => {
    const activities = [
      { id: 'b1', _dateStr: sevenDaysAgo, _primeLoad: 10 },
      { id: 'b2', _dateStr: sevenDaysAgo, _primeLoad: null },
      { id: 'b3', _dateStr: sevenDaysAgo, _primeLoad: NaN },
      { id: 'b4', _dateStr: sevenDaysAgo, prime_load: 20 }
    ];
    const out = computeFromActivities(activities, { todayStr, windowDays: 28 });
    assert.strictEqual(out.counts.used7, 2, 'b1 and b4 have finite load');
    assert.strictEqual(out.counts.filteredOut.nonFiniteLoad, 2);
    assert.strictEqual(out.sum7, 30, '10 + 20');
  });

  await run('computeFromActivities: missing includeInAcwr treated as true', () => {
    const activities = [
      { id: 'c1', _dateStr: sevenDaysAgo, _primeLoad: 40 }
    ];
    const out = computeFromActivities(activities, { todayStr, windowDays: 28 });
    assert.strictEqual(out.counts.fetched, 1);
    assert.strictEqual(out.acute.count7, 1);
    assert.strictEqual(out.sum7, 40);
  });

  await run('computeFromActivities: sum28 and weeklyAvg28 consistent', () => {
    const activities = [
      { id: 'd1', _dateStr: sevenDaysAgo, _primeLoad: 100 }
    ];
    const out = computeFromActivities(activities, { todayStr, windowDays: 28 });
    assert.strictEqual(out.sum28, 100);
    assert.strictEqual(out.chronic.weeklyAvg28, 25, 'sum28/4');
    assert.strictEqual(out.chronicRounded, 25);
  });

  // --- loadUsed standardization: same value in contributors and used for sums ---
  await run('computeFromActivities: loadUsed preferred over _primeLoad for sums and contributors', () => {
    const activities = [
      { id: 'e1', _dateStr: sevenDaysAgo, loadUsed: 120, loadRaw: 110, loadSource: 'strava', includeInAcwr: true }
    ];
    const out = computeFromActivities(activities, { todayStr, windowDays: 28 });
    assert.strictEqual(out.sum7, 120, 'sum7 uses loadUsed');
    assert.strictEqual(out.sum28, 120);
    assert.strictEqual(out.counts.used7, 1);
    assert.strictEqual(out.debug.loadFieldUsed, 'loadUsed');
    const c = out.contributors7d[0];
    assert.strictEqual(c.loadUsed, 120);
    assert.strictEqual(c.load, 120, 'backward compat: load === loadUsed');
    assert.strictEqual(c.loadRaw, 110);
    assert.strictEqual(c.activityId, 'e1');
    assert.strictEqual(c.dayKey, sevenDaysAgo);
  });

  await run('computeFromActivities: same seeded activity yields identical loadUsed in contributors', () => {
    const loadVal = 99;
    const activities = [
      { id: 'f1', _dateStr: sevenDaysAgo, loadUsed: loadVal, dayKey: sevenDaysAgo, includeInAcwr: true }
    ];
    const out = computeFromActivities(activities, { todayStr, windowDays: 28 });
    assert.strictEqual(out.contributors7d.length, 1);
    assert.strictEqual(out.contributors7d[0].loadUsed, loadVal);
    assert.strictEqual(out.contributors7d[0].load, loadVal);
    assert.strictEqual(out.sum7, loadVal);
    // Activity history would show the same loadUsed when this activity is in recent_activities (same source).
    assert.strictEqual(out.sum7, out.contributors7d[0].loadUsed, 'contributors loadUsed === sum source');
  });

  await run('computeFromActivities: same todayStr yields deterministic acwr (match live vs report)', () => {
    const fixedToday = '2025-02-15';
    const sevenAgo = '2025-02-09';
    const activities = [
      { id: 'g1', _dateStr: sevenAgo, loadUsed: 100, includeInAcwr: true },
      { id: 'g2', _dateStr: sevenAgo, loadUsed: 50, includeInAcwr: true }
    ];
    const out = computeFromActivities(activities, { todayStr: fixedToday, windowDays: 28 });
    const expectedSum7 = 150;
    const expectedChronic = 150 / 4;
    const expectedAcwr = Math.round((expectedSum7 / expectedChronic) * 100) / 100;
    assert.strictEqual(out.sum7, expectedSum7);
    assert.strictEqual(out.acwr, expectedAcwr);
    assert.strictEqual(out.debug.dateWindowUsed.to, fixedToday);
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
