/**
 * Minimal unit test for getAdviceCopy: 4 instructionClasses + PROGRESSIVE_STIMULUS overlay.
 * Run: npm run test:ui (from PrimeForm frontend root)
 */
import { getAdviceCopy } from '../adviceCopy.js'

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${expected}", got "${actual}"`)
  }
}

// 1) NO_TRAINING (explicit)
const noTraining = getAdviceCopy({ tag: 'REST', instructionClass: 'NO_TRAINING' })
assertEqual(noTraining.title, 'Rust', 'NO_TRAINING title')
assertEqual(noTraining.summary, 'Je herstel-signalen zijn onvoldoende voor training.', 'NO_TRAINING summary')
assert(noTraining.task.includes('geen training'), 'NO_TRAINING task')
assert(noTraining.badge == null, 'NO_TRAINING badge')
assert(noTraining.guardrail == null, 'NO_TRAINING guardrail')

// 2) ACTIVE_RECOVERY
const recover = getAdviceCopy({ tag: 'RECOVER', instructionClass: 'ACTIVE_RECOVERY' })
assertEqual(recover.title, 'Herstel', 'ACTIVE_RECOVERY title')
assert(recover.summary.includes('laag en gecontroleerd'), 'ACTIVE_RECOVERY summary')
assert(recover.task.includes('Z1/Z2') || recover.task.includes('RPE'), 'ACTIVE_RECOVERY task')

// 3) MAINTAIN
const maintain = getAdviceCopy({ tag: 'MAINTAIN', instructionClass: 'MAINTAIN' })
assertEqual(maintain.title, 'Maintain', 'MAINTAIN title')
assert(maintain.summary.includes('Stabiele dag'), 'MAINTAIN summary')

// 4) HARD_PUSH
const push = getAdviceCopy({ tag: 'PUSH', instructionClass: 'HARD_PUSH' })
assertEqual(push.title, 'Push', 'HARD_PUSH title')
assert(push.summary.includes('groen') || push.summary.includes('belastbaarheid'), 'HARD_PUSH summary')

// 5) PROGRESSIVE_STIMULUS overlay
const progressive = getAdviceCopy({
  tag: 'PUSH',
  instructionClass: 'HARD_PUSH',
  prescriptionHint: 'PROGRESSIVE_STIMULUS',
})
assertEqual(progressive.badge, 'Progressieve prikkel', 'PROGRESSIVE_STIMULUS badge')
assertEqual(
  progressive.summary,
  'Je signalen zijn groen en je belasting is stabiel; vandaag mag je gecontroleerd opschalen.',
  'PROGRESSIVE_STIMULUS summary'
)
assert(progressive.task.includes('progressiestap') || progressive.task.includes('+5–10%'), 'PROGRESSIVE_STIMULUS task')
assertEqual(
  progressive.guardrail,
  'Stop als RPE doorschiet of herstel-alarmen toenemen.',
  'PROGRESSIVE_STIMULUS guardrail'
)

// 6) Fallback: tag-only (no instructionClass)
const fallbackRest = getAdviceCopy({ tag: 'REST' })
assertEqual(fallbackRest.title, 'Rust', 'fallback REST -> Rust')
const fallbackPush = getAdviceCopy({ tag: 'PUSH' })
assertEqual(fallbackPush.title, 'Push', 'fallback PUSH -> Push')

// 7) Why bullets (max 3)
const withWhy = getAdviceCopy({
  tag: 'MAINTAIN',
  readiness: 8,
  redFlagsCount: 2,
  acwrBand: '0.8-1.3',
})
assert(withWhy.whyBullets.length === 3, 'whyBullets length 3')
assert(withWhy.whyBullets.some((b) => b.startsWith('Readiness: 8/10')), 'why readiness')
assert(withWhy.whyBullets.some((b) => b.includes('Herstel-alarmen: 2')), 'why redFlags')
assert(withWhy.whyBullets.some((b) => b.includes('ACWR 0.8-1.3')), 'why acwrBand')

console.log('adviceCopy.test.js: all assertions passed.')