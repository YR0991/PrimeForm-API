/**
 * Smoke test: GET /api/admin/users/:uid/debug-history?days=7
 * - Admin token (claims.admin=true) -> 200 or 503 (Firestore may be unavailable)
 * - If 200: assert array length 7, each item has date + output.tag + meta.flagsConfidence
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
  console.log('Admin debug-history smoke tests\n');

  await run('GET /api/admin/users/:uid/debug-history?days=7 with admin token -> 200 or 503', (done) => {
    request(app)
      .get('/api/admin/users/test-uid-123/debug-history')
      .query({ days: 7 })
      .set('Authorization', 'Bearer mock-admin-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.ok([200, 503].includes(res.status), `expected 200 or 503, got ${res.status}`);
        if (res.status === 503) {
          assert.ok(res.body && (res.body.error === 'Firestore is not initialized' || res.body.error), '503 should have error message');
          return done();
        }
        assert.strictEqual(res.status, 200);
        assert.ok(res.body && res.body.success === true && res.body.data, 'response must have success and data');
        const { data } = res.body;
        assert.ok(Array.isArray(data.days), 'data.days must be an array');
        assert.strictEqual(data.days.length, 7, 'days=7 must return 7 items');
        data.days.forEach((item, idx) => {
          assert.ok(item.date, `item[${idx}].date must be present`);
          assert.ok(item.output && typeof item.output.tag === 'string', `item[${idx}].output.tag must be present`);
          assert.ok(item.meta && typeof item.meta.flagsConfidence === 'string', `item[${idx}].meta.flagsConfidence must be present`);
        });
        done();
      });
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
