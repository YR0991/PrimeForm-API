/**
 * Coach Service — API client for Coach Dashboard.
 * Backend-First: no transformations. Return response.data directly.
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
 * GET /api/coach/squadron
 * Returns response.data directly. No mapping or fallbacks.
 */
export async function getCoachSquad() {
  requireCoachEmail()
  const res = await api.get('/api/coach/squadron')
  return res.data
}

/**
 * GET /api/coach/athletes/:id
 * Returns response.data.data (payload). Backend sends { success, data }.
 */
export async function getAthleteDetail(id) {
  requireCoachEmail()
  const res = await api.get(`/api/coach/athletes/${id}`)
  return res.data?.data ?? res.data
}

/**
 * POST /api/ai/week-report
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
