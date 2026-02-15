/**
 * Intake/onboarding idempotency: no duplicate intake email.
 * Asserts that server.js gates sendNewIntakeEmail on intakeMailSentAt and sets it after send.
 * Run: NODE_ENV=test node tests/intake.idempotency.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');
const serverSrc = fs.readFileSync(serverPath, 'utf8');

function run(name, fn) {
  try {
    fn();
    console.log('  ok', name);
  } catch (e) {
    console.error('  FAIL', name, e.message);
    process.exitCode = 1;
  }
}

function main() {
  console.log('Intake idempotency guards\n');

  run('Profile PUT gates intake email on intakeMailSentAt', () => {
    assert.ok(
      /intakeMailSentAt.*existing\.(exists|data)/.test(serverSrc) &&
      /profileComplete\s*&&\s*!intakeMailSentAt/.test(serverSrc),
      'server.js must gate sendNewIntakeEmail on profileComplete && !intakeMailSentAt'
    );
  });

  run('sendNewIntakeEmail sets intakeMailSentAt after send', () => {
    assert.ok(
      /intakeMailSentAt:\s*FieldValue\.serverTimestamp/.test(serverSrc),
      'server.js must set intakeMailSentAt on user doc after sending intake email'
    );
  });

  console.log('\nDone.');
}

main();
