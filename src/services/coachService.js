/**
 * Coach Service — API client for Coach Dashboard (Squadron View)
 */

import { api } from './httpClient.js'
import { useAuthStore } from '../stores/auth.js'

/**
 * Get squadron data for coach dashboard.
 * Vereist ingelogde coach/admin; e-mail wordt via httpClient headers meegestuurd.
 */
export async function getCoachSquad() {
  const authStore = useAuthStore()
  const email = authStore.user?.email || ''
  if (!email) {
    throw new Error('Coach email not found. Log in first.')
  }

  const res = await api.get('/api/coach/squadron')
  const data = res.data?.data || []

  return data.map((row) => ({
    id: row.id,
    name: row.name || 'Onbekend',
    avatar: row.avatar || null,
    level: row.level || 'rookie',
    cyclePhase: row.cyclePhase || 'Unknown',
    cycleDay: row.cycleDay ?? 0,
    acwr: Number(row.acwr) || 0,
    acwrStatus: row.acwrStatus || 'sweet',
    compliance: Boolean(row.compliance),
    readiness:
      row.readiness != null && Number.isFinite(Number(row.readiness))
        ? Number(row.readiness)
        : null,
    lastActivity: row.lastActivity
      ? {
          time: row.lastActivity.time || '',
          type: row.lastActivity.type || 'Workout',
          date: row.lastActivity.date || ''
        }
      : null
  }))
}

/**
 * Generate AI weekly report for an athlete.
 * Uses current authenticated user (admin/coach) as header via httpClient.
 * @param {string} athleteId - Firestore user document ID
 * @returns {Promise<{ stats: string, message: string }>}
 */
export async function fetchWeekReport(athleteId) {
  const authStore = useAuthStore()
  const email = authStore.user?.email || ''

  if (!email) {
    throw new Error('Coach email not found. Log in first.')
  }

  try {
    const res = await api.post('/api/ai/week-report', { athleteId })
    return res.data
  } catch (err) {
    if (err.response?.status === 403) {
      throw new Error('Unauthorized: Admin or Coach access required')
    }
    const msg = err.response?.data?.error || err.response?.data?.message || err.message
    throw new Error(msg || 'Request failed')
  }
}
