/**
 * CoachService: no TDZ when user has no profile or getDashboardStats throws.
 * - getSquadronData: users without profile or with profile only in doc must not trigger
 *   "Cannot access 'profile' before initialization" (rawProfile used in try and catch).
 * - getAthleteDetail: returns safely for user without profile.
 * Run: NODE_ENV=test node tests/coachService.tdz.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const admin = require('firebase-admin');
require('../server'); // ensure Firebase init for admin.firestore()
const coachService = require('../services/coachService');

const UID_NO_PROFILE = 'test-uid-coach-no-profile';
const UID_EMPTY_PROFILE = 'test-uid-coach-empty-profile';

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
  console.log('CoachService TDZ / no-profile tests\n');

  let db;
  try {
    db = admin.firestore();
  } catch {
    db = null;
  }
  if (!db) {
    console.log('  skip (no db)');
    return;
  }

  await run('getSquadronData without coachTeamId returns empty array', async (done) => {
    try {
      const squadron = await coachService.getSquadronData(db, admin);
      assert(Array.isArray(squadron), 'squadron must be array');
      assert.strictEqual(squadron.length, 0, 'squadron must be empty when no coachTeamId');
      done();
    } catch (e) {
      done(e);
    }
  });

  await run('getSquadronData with user that has no profile does not throw TDZ', async (done) => {
    try {
      const userRef = db.collection('users').doc(UID_NO_PROFILE);
      await userRef.set(
        {
          email: 'noprofile@test.com',
          teamId: 'team-1'
          // no profile field
        },
        { merge: true }
      );
      const squadron = await coachService.getSquadronData(db, admin, { coachTeamId: 'team-1' });
      assert(Array.isArray(squadron), 'squadron must be array');
      const found = squadron.find((r) => r.id === UID_NO_PROFILE);
      assert(found != null, 'user without profile must appear in squadron');
      assert.strictEqual(found.teamId, 'team-1', 'each athlete must have teamId equal to coach team');
      assert.strictEqual(typeof found.name, 'string', 'name must be string');
      assert.ok(found.name.length > 0, 'name must be non-empty (fallback from email or Geen naam)');
      assert.ok(found.profile && typeof found.profile === 'object', 'profile object must exist');
      done();
    } catch (e) {
      if (e.message && e.message.includes("before initialization")) {
        done(new Error("TDZ: " + e.message));
      } else {
        done(e);
      }
    }
  });

  await run('getSquadronData with user that has empty profile does not throw TDZ', async (done) => {
    try {
      const userRef = db.collection('users').doc(UID_EMPTY_PROFILE);
      await userRef.set(
        {
          email: 'emptyprofile@test.com',
          profile: {},
          teamId: 'team-1'
        },
        { merge: true }
      );
      const squadron = await coachService.getSquadronData(db, admin, { coachTeamId: 'team-1' });
      assert(Array.isArray(squadron), 'squadron must be array');
      const found = squadron.find((r) => r.id === UID_EMPTY_PROFILE);
      assert(found != null, 'user with empty profile must appear in squadron');
      assert.strictEqual(found.teamId, 'team-1', 'each athlete must have teamId equal to coach team');
      assert.strictEqual(typeof found.name, 'string', 'name must be string');
      done();
    } catch (e) {
      if (e.message && e.message.includes("before initialization")) {
        done(new Error("TDZ: " + e.message));
      } else {
        done(e);
      }
    }
  });

  await run('getAthleteDetail for user without profile returns without throw', async (done) => {
    try {
      const detail = await coachService.getAthleteDetail(db, admin, UID_NO_PROFILE);
      assert(detail != null, 'detail must be object');
      assert.strictEqual(detail.id, UID_NO_PROFILE, 'id must match');
      assert.ok(detail.profile && typeof detail.profile === 'object', 'profile must be object');
      assert.ok(detail.metrics != null, 'metrics must exist');
      done();
    } catch (e) {
      if (e.message && e.message.includes("before initialization")) {
        done(new Error("TDZ: " + e.message));
      } else {
        done(e);
      }
    }
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
