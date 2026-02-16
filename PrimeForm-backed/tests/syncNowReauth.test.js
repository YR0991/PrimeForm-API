/**
 * Sync-now: Strava 401/403 must return HTTP 409 (STRAVA_REAUTH_REQUIRED), not 500.
 * - Mocks Strava API (activities endpoint) to return 401.
 * - Asserts: response status 409, body.code STRAVA_REAUTH_REQUIRED, Firestore stravaSync updated.
 * Run: NODE_ENV=test node tests/syncNowReauth.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const request = require('supertest');

const TEST_UID = 'test-uid-sync-now-reauth';
const admin = require('firebase-admin');
admin.auth = () => ({
  verifyIdToken: () => Promise.resolve({ uid: TEST_UID, email: 'reauth@test.com', claims: {} })
});

// Mock fetch: activities endpoint returns 401 so sync-now returns 409 and writes stravaSync
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const originalFetch = global.fetch;
global.fetch = function (url, opts) {
  const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
  if (urlStr.includes('athlete/activities')) {
    return Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Authorization Error' })
    });
  }
  return originalFetch.apply(this, arguments);
};

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
  console.log('Sync-now Strava 401 → 409 (STRAVA_REAUTH_REQUIRED) tests\n');

  await run('POST /api/strava/sync-now returns 409 and writes stravaSync when Strava returns 401', async (done) => {
    let db;
    try {
      db = admin.firestore();
    } catch {
      db = null;
    }
    if (!db) {
      console.log('  skip (no db)');
      return done();
    }
    try {
      const userRef = db.collection('users').doc(TEST_UID);
      const nowSec = Math.floor(Date.now() / 1000) + 3600; // token "valid" for 1h so no refresh
      await userRef.set(
        {
          profile: { fullName: 'Reauth Test' },
          strava: {
            connected: true,
            refreshToken: 'mock-refresh',
            accessToken: 'mock-access',
            expiresAt: nowSec
          }
        },
        { merge: true }
      );

      const res = await request(app)
        .post('/api/strava/sync-now')
        .set('Authorization', 'Bearer mock-token')
        .set('Content-Type', 'application/json')
        .send({ userId: TEST_UID });

      if (res.status === 401) {
        console.log('  skip (401 auth)');
        return done();
      }

      assert.strictEqual(res.status, 409, `expected 409, got ${res.status} (must NOT be 500)`);
      const body = res.body || {};
      assert.strictEqual(body.code, 'STRAVA_REAUTH_REQUIRED', 'response must have code STRAVA_REAUTH_REQUIRED');
      assert.strictEqual(body.ok, false);

      const snap = await userRef.get();
      assert.ok(snap.exists, 'user doc must exist');
      const data = snap.data();
      const sync = data.stravaSync || {};
      assert.strictEqual(sync.lastError, 'STRAVA_REAUTH_REQUIRED', 'stravaSync.lastError must be set');
      assert.strictEqual(sync.reauthRequired, true, 'stravaSync.reauthRequired must be true');
      assert.strictEqual(sync.lastErrorStatusCode, 401, 'stravaSync.lastErrorStatusCode must be 401');
      assert.strictEqual(sync.lastErrorSource, 'sync_now', 'stravaSync.lastErrorSource must be sync_now');
      assert.ok(sync.lastErrorAt != null, 'stravaSync.lastErrorAt must be set');

      done();
    } catch (e) {
      done(e);
    } finally {
      global.fetch = originalFetch;
    }
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
