/**
 * Coach Service — API client for Coach Dashboard (Squadron View).
 * Backend-First: geen frontend-berekeningen; strikte mapping van API-data.
 */

import { api } from './httpClient.js'
import { useAuthStore } from '../stores/auth.js'

function requireCoachEmail() {
  const authStore = useAuthStore()
  const email = authStore.user?.email || ''
  if (!email) throw new Error('Coach email not found. Log in first.')
  return email
}

/**
 * Haal de squadron-array uit verschillende response-shapes:
 * { data: [] } | { data: { data: [] } } | []
 */
function extractList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.data?.data)) return payload.data.data
  if (Array.isArray(payload?.result)) return payload.result
  return []
}

/** Zoek veld in root > stats > metrics. Geen gokken. */
function pick(row, key) {
  return row?.[key] ?? row?.stats?.[key] ?? row?.metrics?.[key] ?? null
}

/**
 * Map één activiteit. Load ALLEEN van backend: load | suffer_score | stress_score.
 * NOOIT duration * 7 of andere frontend-math.
 */
function mapActivity(act) {
  const val = act.load ?? act.suffer_score ?? act.stress_score ?? null
  const dateVal = act.date ?? act.start_date_local ?? act.start_date
  const dateStr =
    typeof dateVal === 'string'
      ? dateVal.slice(0, 10)
      : dateVal?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? ''
  const duration = act.duration ?? act.moving_time ?? 0

  return {
    id: act.id,
    date: dateStr,
    type: act.type || act.sport_type || 'Workout',
    name: act.name || 'Activiteit',
    load: val != null && Number.isFinite(Number(val)) ? Number(val) : null,
    duration: Number.isFinite(Number(duration)) ? Number(duration) : 0,
    source: act.source ?? null,
  }
}

/**
 * Map één squadron-row van de API. Flexibel voor root / stats / metrics.
 * Activities expliciet gemapt; geen fallback-berekening.
 */
function mapSquadRow(row) {
  const acwr = pick(row, 'acwr')
  const activitiesRaw = row.activities ?? row.stats?.activities ?? row.metrics?.activities ?? []
  const activities = Array.isArray(activitiesRaw) ? activitiesRaw.map(mapActivity) : []

  const lastActivityRaw = row.lastActivity ?? row.stats?.lastActivity ?? row.metrics?.lastActivity

  return {
    id: row.id ?? row.uid ?? null,
    uid: row.uid ?? null,

    name: row.name ?? 'Onbekend',
    avatar: row.avatar ?? null,
    email: row.email ?? null,
    teamId: row.teamId ?? null,
    level: row.level ?? 'rookie',

    cyclePhase: pick(row, 'cyclePhase') ?? row.cyclePhase ?? 'Unknown',
    cycleDay: pick(row, 'cycleDay') ?? row.cycleDay ?? null,

    acwr: acwr != null && Number.isFinite(Number(acwr)) ? Number(acwr) : null,
    acwrStatus: row.acwrStatus ?? 'sweet',

    compliance: Boolean(row.compliance),
    readiness: pick(row, 'readiness') != null && Number.isFinite(Number(pick(row, 'readiness')))
      ? Number(pick(row, 'readiness'))
      : null,

    lastActivity: lastActivityRaw
      ? {
          time: lastActivityRaw.time ?? '',
          type: lastActivityRaw.type ?? 'Workout',
          date: lastActivityRaw.date ?? '',
        }
      : null,

    activities,
  }
}

/**
 * Haal squadron data op. Return: genormaliseerde array (geen wrapper).
 */
export async function getCoachSquad() {
  requireCoachEmail()

  const res = await api.get('/api/coach/squadron')
  const payload = res.data
  const list = extractList(payload)

  console.log('[CoachService] squadron API response', {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    listLength: list.length,
  })

  return list.map(mapSquadRow)
}

/**
 * Genereer AI weekrapport voor een atleet.
 */
export async function fetchWeekReport(athleteId) {
  requireCoachEmail()

  try {
    const res = await api.post('/api/ai/week-report', { athleteId })
    return res.data
  } catch (err) {
    if (err.response?.status === 403) {
      throw new Error('Unauthorized: Admin or Coach access required')
    }
    const msg = err.response?.data?.error ?? err.response?.data?.message ?? err.message
    throw new Error(msg || 'Request failed')
  }
}
