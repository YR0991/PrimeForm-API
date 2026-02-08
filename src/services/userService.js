/**
 * User Service — Deep dive for Coach modal (mock until API exists)
 */

export async function getAthleteDeepDive(athleteId) {
  await new Promise((r) => setTimeout(r, 250))
  return {
    id: athleteId,
    name: '—',
    cyclePhase: '—',
    cycleDay: 0,
    acwr: 0,
    acwrStatus: 'sweet',
    primeLoad7d: 0,
    readiness: 0,
    activities: []
  }
}
