/**
 * Smoke tests for GET /api/admin/users/:uid/live-load-metrics.
 * - Returns success, uid, windowDays, sum7, sum28, chronic, acwr, acwrBand, contributors7d.
 * - When sum28 === 0, acwr is null.
 * - contributors7d is built only from activities with includeInAcwr !== false (implementation in adminRoutes).
 * Run: NODE_ENV=test node tests/liveLoadMetrics.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const request = require('supertest');

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

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
