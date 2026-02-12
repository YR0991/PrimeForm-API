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
 * Returns the squadron array. Backend sends { success, data: array }.
 */
export async function getCoachSquad() {
  requireCoachEmail()
  const res = await api.get('/api/coach/squadron')
  const body = res.data
  if (Array.isArray(body)) return body
  if (body && Array.isArray(body.data)) return body.data
  return body?.data ?? []
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
 * PUT /api/coach/athletes/:id/notes — save coach logbook (Engineering Notes)
 */
export async function saveAthleteNotes(athleteId, adminNotes) {
  requireCoachEmail()
  const res = await api.put(`/api/coach/athletes/${encodeURIComponent(athleteId)}/notes`, {
    adminNotes: adminNotes != null ? String(adminNotes) : '',
  })
  return res.data?.data ?? res.data
}

/**
 * POST /api/ai/week-report — generate Performance Directief (optionally with coachNotes, directive, injuries)
 */
export async function fetchWeekReport(athleteId, opts = {}) {
  requireCoachEmail()
  try {
    const body = {
      athleteId,
      ...(opts.coachNotes != null && { coachNotes: opts.coachNotes }),
      ...(opts.directive != null && { directive: opts.directive }),
      ...(opts.injuries != null && { injuries: Array.isArray(opts.injuries) ? opts.injuries : [opts.injuries] }),
    }
    const res = await api.post('/api/ai/week-report', body)
    return res.data
  } catch (err) {
    if (err.response?.status === 403) {
      throw new Error('Unauthorized: Admin or Coach access required')
    }
    const msg = err.response?.data?.error ?? err.response?.data?.message ?? err.message
    throw new Error(msg || 'Request failed')
  }
}
