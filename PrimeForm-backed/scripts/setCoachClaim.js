#!/usr/bin/env node
/**
 * Set Firebase custom claim { coach: true } for a UID, preserving existing claims.
 * Auth uses boolean claims (claims.coach === true); user must re-login or getIdToken(true) after.
 *
 * Usage: node scripts/setCoachClaim.js [uid]
 * Default uid: e9VYmrSqh0b1sgHXa5dqJlEjDMB3
 *
 * Requires: FIREBASE_SERVICE_ACCOUNT_JSON in env, or firebase-key.json in project root.
 * After running: verify GET /api/admin/users/:uid/live-load-metrics and /strava-status return 200 for coach (same team).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DEFAULT_UID = 'e9VYmrSqh0b1sgHXa5dqJlEjDMB3';

function initFirebase() {
  if (admin.apps.length) return;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return;
  }
  const keyPath = path.join(__dirname, '..', 'firebase-key.json');
  if (!fs.existsSync(keyPath)) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON or place firebase-key.json in project root');
  }
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

async function main() {
  const uid = process.argv[2] || DEFAULT_UID;
  initFirebase();

  const userRecord = await admin.auth().getUser(uid);
  const existing = userRecord.customClaims || {};
  const next = { ...existing, coach: true };
  await admin.auth().setCustomUserClaims(uid, next);

  console.log('OK', { uid, email: userRecord.email ?? null, claims: next });
  console.log('User must re-login or force refresh token (getIdToken(true)) for claims to apply.');
  console.log('Then verify: GET /api/admin/users/:uid/live-load-metrics and /strava-status return 200 for coach (same team).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
