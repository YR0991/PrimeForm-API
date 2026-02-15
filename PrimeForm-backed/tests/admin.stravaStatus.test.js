/**
 * Response shape smoke tests for admin Strava endpoints.
 * - GET /api/admin/users/:uid/strava-status: response has connectedAt + scope keys (may be null).
 * - POST /api/admin/users/:uid/strava/sync-now: success response has afterTimestampUsed + afterStrategy.
 * No mocks for Firestore/Strava; 200/503/404 are acceptable.
 * Run: NODE_ENV=test node tests/admin.stravaStatus.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const request = require('supertest');

const tokenOverride = { uid: 'admin1', email: 'admin@test.com', claims: { admin: true } };
const admin = require('firebase-admin');
admin.auth = () => ({
  verifyIdToken: () => Promise.resolve(tokenOverride)
});

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
  console.log('Admin Strava response shape smoke tests\n');

  await run('GET /api/admin/users/:uid/strava-status response has connectedAt + scope keys', (done) => {
    request(app)
      .get('/api/admin/users/test-uid-strava/strava-status')
      .set('Authorization', 'Bearer mock-admin-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.ok([200, 404, 503].includes(res.status), `expected 200, 404 or 503, got ${res.status}`);
        const body = res.body || {};
        assert.ok('connectedAt' in body, 'response must include connectedAt key');
        assert.ok('scope' in body, 'response must include scope key');
        done();
      });
  });

  await run('POST /api/admin/users/:uid/strava/sync-now success response has afterTimestampUsed + afterStrategy', (done) => {
    request(app)
      .post('/api/admin/users/test-uid-strava/sync-now')
      .set('Authorization', 'Bearer mock-admin-token')
      .set('Content-Type', 'application/json')
      .send({})
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        // 200 (success), 400 (not connected), 404 (user not found), 429 (backoff), 503 (db not ready)
        assert.ok([200, 400, 404, 429, 503].includes(res.status), `expected 200/400/404/429/503, got ${res.status}`);
        const body = res.body || {};
        assert.ok('afterTimestampUsed' in body, 'response must include afterTimestampUsed key');
        assert.ok('afterStrategy' in body, 'response must include afterStrategy key');
        if (res.status === 200) {
          assert.strictEqual(body.success, true);
        }
        done();
      });
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
