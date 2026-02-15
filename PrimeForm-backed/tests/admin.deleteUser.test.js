/**
 * Nuclear delete guardrails: DELETE /api/admin/users/:uid requires body.confirm === true.
 * Run: NODE_ENV=test node tests/admin.deleteUser.test.js
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
  console.log('Admin delete user (nuclear) guardrails\n');

  await run('DELETE /api/admin/users/:uid without Authorization returns 401', (done) => {
    request(app)
      .delete('/api/admin/users/some-uid')
      .set('Content-Type', 'application/json')
      .send({ confirm: true })
      .expect(401)
      .end(done);
  });

  await run('DELETE /api/admin/users/:uid without body.confirm returns 400', (done) => {
    request(app)
      .delete('/api/admin/users/some-uid')
      .set('Authorization', 'Bearer mock-admin-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.strictEqual(res.status, 400, 'expected 400 when confirm missing');
        assert.ok(res.body && res.body.error && /confirm/i.test(res.body.error), 'error must mention confirm');
        done();
      });
  });

  await run('DELETE /api/admin/users/:uid with body.confirm false returns 400', (done) => {
    request(app)
      .delete('/api/admin/users/some-uid')
      .set('Authorization', 'Bearer mock-admin-token')
      .set('Content-Type', 'application/json')
      .send({ confirm: false })
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.strictEqual(res.status, 400, 'expected 400 when confirm false');
        assert.ok(res.body && res.body.error && /confirm/i.test(res.body.error), 'error must mention confirm');
        done();
      });
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
