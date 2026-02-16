/**
 * Unit test: 409 STRAVA_REAUTH_REQUIRED must not propagate as rejected promise.
 * resolveOnStravaReauth returns a resolved promise with error.response so callers don't enter catch.
 * Run: node src/services/__tests__/responseErrorHandling.test.js (from PrimeForm frontend root)
 */
import { resolveOnStravaReauth } from '../responseErrorHandling.js'

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

async function main() {
  // 409 STRAVA_REAUTH_REQUIRED → resolved promise with error.response (not rejected)
  const reauthError = {
    response: {
      status: 409,
      data: { code: 'STRAVA_REAUTH_REQUIRED', message: 'Strava-koppeling verlopen. Koppel opnieuw.' }
    }
  }
  const result = resolveOnStravaReauth(reauthError)
  assert(result !== null, 'resolveOnStravaReauth must return a promise for 409 reauth')
  assert(typeof result.then === 'function', 'return value must be thenable')
  const resolvedWith = await result
  assert(resolvedWith === reauthError.response, 'must resolve with error.response so callers get response, not error')
  console.log('ok 409 STRAVA_REAUTH_REQUIRED does not propagate as rejected promise')

  // Other errors → null (caller should reject)
  assert(resolveOnStravaReauth({ response: { status: 500 } }) === null, '500 returns null')
  assert(resolveOnStravaReauth({ response: { status: 409, data: {} } }) === null, '409 without code returns null')
  assert(resolveOnStravaReauth({ response: { status: 409, data: { code: 'OTHER' } } }) === null, '409 other code returns null')
  assert(resolveOnStravaReauth(null) === null, 'null returns null')
  console.log('ok other errors return null')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
