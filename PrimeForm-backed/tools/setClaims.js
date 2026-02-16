#!/usr/bin/env node
/**
 * Set Firebase custom claims for a user (by email).
 * Usage: node tools/setClaims.js <email> <role> <true|false>
 * Example: node tools/setClaims.js owner@example.com admin true
 * Example: node tools/setClaims.js coach@example.com coach true  (coach; set users/{uid}.teamId in Firestore for team scope)
 * Requires: FIREBASE_SERVICE_ACCOUNT_JSON in env, or firebase-key.json in project root.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

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
  const [email, role, valueStr] = process.argv.slice(2);
  if (!email || !role) {
    console.error('Usage: node tools/setClaims.js <email> <role> <true|false>');
    process.exit(1);
  }
  const value = valueStr === 'true';
  initFirebase();

  const userRecord = await admin.auth().getUserByEmail(email.trim());
  const uid = userRecord.uid;
  const existing = userRecord.customClaims || {};
  const next = { ...existing, [role]: value };
  await admin.auth().setCustomUserClaims(uid, next);
  console.log('OK', { email: userRecord.email, uid, claims: next });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
