/**
 * Coach Service — API client for Coach Dashboard (Squadron View)
 */

import { API_URL } from '../config/api.js'

/**
 * Get squadron data for coach dashboard.
 * Requires admin/coach email in localStorage (same as admin routes).
 */
export async function getCoachSquad() {
  const coachEmail = localStorage.getItem('admin_email')
  if (!coachEmail) {
    throw new Error('Coach email not found. Log in via Admin first.')
  }

  const res = await fetch(`${API_URL}/api/coach/squadron`, {
    headers: {
      'x-admin-email': coachEmail,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    if (res.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Coach access required')
    }
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || err.message || `Request failed: ${res.status}`)
  }

  const json = await res.json()
  const data = json.data || []

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
 * Requires admin/coach email in localStorage.
 * @param {string} athleteId - Firestore user document ID
 * @returns {Promise<{ stats: string, message: string }>}
 */
export async function fetchWeekReport(athleteId) {
  const coachEmail = localStorage.getItem('admin_email') || localStorage.getItem('adminEmail')
  if (!coachEmail) {
    throw new Error('Coach email not found. Log in via Admin first.')
  }

  const res = await fetch(`${API_URL}/api/ai/week-report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-email': coachEmail,
      'x-coach-email': coachEmail,
    },
    body: JSON.stringify({ athleteId }),
  })

  if (!res.ok) {
    if (res.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Admin or Coach access required')
    }
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || err.message || `Request failed: ${res.status}`)
  }

  return res.json()
}
