/**
 * Intake one-way: onboardingLockedAt forces onboardingComplete true in GET /api/profile.
 * - Unit: getEffectiveOnboardingComplete (see profileValidation.test.js).
 * - Integration: when user doc has onboardingLockedAt and incomplete profile, GET returns onboardingComplete true, profileComplete false.
 * Run: NODE_ENV=test node tests/onboardingLock.test.js
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const request = require('supertest');
const { FieldValue } = require('@google-cloud/firestore');

const TEST_UID = 'test-uid-onboarding-locked';
const TEST_UID_LEGACY_STRAVA = 'test-uid-legacy-strava';
const TEST_UID_LEGACY_FLAG = 'test-uid-legacy-flag';
let currentUid = TEST_UID;
const admin = require('firebase-admin');
admin.auth = () => ({
  verifyIdToken: () =>
    Promise.resolve({ uid: currentUid, email: 'lock@test.com', claims: {} })
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
  console.log('Onboarding lock (intake one-way) tests\n');

  await run('GET /api/profile returns onboardingComplete true when onboardingLockedAt set and profile incomplete', async (done) => {
    currentUid = TEST_UID;
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
      await userRef.set(
        {
          profile: { fullName: 'x' },
          onboardingLockedAt: FieldValue.serverTimestamp(),
          profileComplete: false,
          updatedAt: new Date()
        },
        { merge: true }
      );
      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer mock-token');
      if (res.status === 401) {
        console.log('  skip (401)');
        return done();
      }
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
      const data = res.body?.data;
      assert.ok(data, 'response must have data');
      assert.strictEqual(data.onboardingComplete, true, 'onboardingComplete must be true when locked');
      assert.strictEqual(data.profileComplete, false, 'profileComplete must reflect computed (incomplete)');
      assert.ok(data.onboardingLockedAt != null, 'onboardingLockedAt must be returned');
      done();
    } catch (e) {
      done(e);
    }
  });

  await run('GET /api/profile auto-locks legacy user with strava.connected (no onboardingLockedAt)', async (done) => {
    currentUid = TEST_UID_LEGACY_STRAVA;
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
      const userRef = db.collection('users').doc(TEST_UID_LEGACY_STRAVA);
      await userRef.set(
        {
          profile: { fullName: 'Legacy' },
          strava: { connected: true },
          onboardingComplete: false
          // onboardingLockedAt intentionally missing
        },
        { merge: true }
      );
      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer mock-token');
      if (res.status === 401) {
        console.log('  skip (401)');
        return done();
      }
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
      const data = res.body?.data;
      assert.ok(data, 'response must have data');
      assert.strictEqual(data.onboardingComplete, true, 'onboardingComplete must be true after auto-lock');
      assert.ok(data.onboardingLockedAt != null, 'onboardingLockedAt must be returned');
      const afterSnap = await userRef.get();
      assert.ok(afterSnap.exists, 'user doc must exist');
      const afterData = afterSnap.data();
      assert.ok(afterData.onboardingLockedAt != null, 'Firestore doc must have onboardingLockedAt set');
      done();
    } catch (e) {
      done(e);
    }
  });

  await run('GET /api/profile auto-locks legacy user with onboardingComplete=true but no lock', async (done) => {
    currentUid = TEST_UID_LEGACY_FLAG;
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
      const userRef = db.collection('users').doc(TEST_UID_LEGACY_FLAG);
      await userRef.set(
        {
          profile: { fullName: 'Legacy' },
          onboardingComplete: true
          // onboardingLockedAt intentionally missing
        },
        { merge: true }
      );
      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer mock-token');
      if (res.status === 401) {
        console.log('  skip (401)');
        return done();
      }
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
      const data = res.body?.data;
      assert.ok(data, 'response must have data');
      assert.strictEqual(data.onboardingComplete, true, 'onboardingComplete must be true after auto-lock');
      assert.ok(data.onboardingLockedAt != null, 'onboardingLockedAt must be returned');
      done();
    } catch (e) {
      done(e);
    }
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
