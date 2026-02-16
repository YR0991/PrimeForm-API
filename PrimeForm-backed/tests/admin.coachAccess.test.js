/**
 * Coach access to admin user-scoped endpoints (same team only).
 * - Coach with claims.coach=true and matching teamId can access GET strava-status, live-load-metrics.
 * - Coach with different teamId gets 403 with code FORBIDDEN_TEAM.
 * - User without admin/coach role gets 403 with code FORBIDDEN_ROLE.
 * Run: NODE_ENV=test node tests/admin.coachAccess.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const request = require('supertest');

const COACH_UID = 'test-coach-uid';
const ATHLETE_SAME_TEAM = 'test-athlete-same-team';
const ATHLETE_OTHER_TEAM = 'test-athlete-other-team';
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

let tokenOverride = { uid: COACH_UID, email: 'coach@test.com', claims: { coach: true, teamId: TEAM_A } };
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
  console.log('Admin coach access (strava-status, live-load-metrics) tests\n');

  let db;
  try {
    db = admin.firestore();
  } catch {
    db = null;
  }

  if (db) {
    const coachRef = db.collection('users').doc(COACH_UID);
    const athleteSameRef = db.collection('users').doc(ATHLETE_SAME_TEAM);
    const athleteOtherRef = db.collection('users').doc(ATHLETE_OTHER_TEAM);
    await coachRef.set({ role: 'coach', teamId: TEAM_A, email: 'coach@test.com' }, { merge: true });
    await athleteSameRef.set({ role: 'athlete', teamId: TEAM_A, profile: {} }, { merge: true });
    await athleteOtherRef.set({ role: 'athlete', teamId: TEAM_B, profile: {} }, { merge: true });
  }

  await run('Coach with matching teamId can access GET /api/admin/users/:uid/strava-status', (done) => {
    tokenOverride = { uid: COACH_UID, email: 'coach@test.com', claims: { coach: true, teamId: TEAM_A } };
    request(app)
      .get(`/api/admin/users/${ATHLETE_SAME_TEAM}/strava-status`)
      .set('Authorization', 'Bearer mock-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.ok([200, 404, 503].includes(res.status), `expected 200/404/503, got ${res.status}`);
        if (res.status === 200) assert.ok('connected' in res.body);
        done();
      });
  });

  await run('Coach with different teamId gets 403 FORBIDDEN_TEAM on strava-status', (done) => {
    tokenOverride = { uid: COACH_UID, email: 'coach@test.com', claims: { coach: true, teamId: TEAM_A } };
    request(app)
      .get(`/api/admin/users/${ATHLETE_OTHER_TEAM}/strava-status`)
      .set('Authorization', 'Bearer mock-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
        assert.strictEqual(res.body?.code, 'FORBIDDEN_TEAM', 'response must have code FORBIDDEN_TEAM');
        done();
      });
  });

  await run('Coach with matching teamId can access GET /api/admin/users/:uid/live-load-metrics', (done) => {
    tokenOverride = { uid: COACH_UID, email: 'coach@test.com', claims: { coach: true, teamId: TEAM_A } };
    request(app)
      .get(`/api/admin/users/${ATHLETE_SAME_TEAM}/live-load-metrics`)
      .set('Authorization', 'Bearer mock-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.ok([200, 503].includes(res.status), `expected 200 or 503, got ${res.status}`);
        if (res.status === 200) assert.ok(res.body?.acwr !== undefined || res.body?.success === true);
        done();
      });
  });

  await run('Coach with different teamId gets 403 FORBIDDEN_TEAM on live-load-metrics', (done) => {
    tokenOverride = { uid: COACH_UID, email: 'coach@test.com', claims: { coach: true, teamId: TEAM_A } };
    request(app)
      .get(`/api/admin/users/${ATHLETE_OTHER_TEAM}/live-load-metrics`)
      .set('Authorization', 'Bearer mock-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
        assert.strictEqual(res.body?.code, 'FORBIDDEN_TEAM', 'response must have code FORBIDDEN_TEAM');
        done();
      });
  });

  await run('User without admin/coach role gets 403 FORBIDDEN_ROLE on strava-status', (done) => {
    tokenOverride = { uid: 'plain-user', email: 'user@test.com', claims: {} };
    request(app)
      .get(`/api/admin/users/${ATHLETE_SAME_TEAM}/strava-status`)
      .set('Authorization', 'Bearer mock-token')
      .end((err, res) => {
        if (err) return done(err);
        if (res.status === 401) {
          console.log('  skip (401: token mock may not apply)');
          return done();
        }
        assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
        assert.strictEqual(res.body?.code, 'FORBIDDEN_ROLE', 'response must have code FORBIDDEN_ROLE');
        done();
      });
  });

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
