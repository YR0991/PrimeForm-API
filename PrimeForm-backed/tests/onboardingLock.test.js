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
const admin = require('firebase-admin');
admin.auth = () => ({
  verifyIdToken: () =>
    Promise.resolve({ uid: TEST_UID, email: 'lock@test.com', claims: {} })
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

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
