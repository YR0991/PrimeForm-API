// Admin Service - Firestore data operations for admin dashboard
import { api } from './httpClient.js'

/**
 * Fetch all users from Firestore
 * @returns {Promise<Array>} Array of user documents
 */
export async function fetchAllUsers() {
  try {
    const res = await api.get('/api/admin/users')
    return res.data?.data || []
  } catch (error) {
    console.error('Error fetching users:', error)
    throw error
  }
}

/**
 * Get user details including intake data (admin viewing another user).
 * Uses GET /api/admin/users and finds the user by id — do not use GET /api/profile?userId=.
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User profile with intake data, or null if not found
 */
export async function getUserDetails(userId) {
  try {
    const list = await fetchAllUsers()
    const user = list.find((u) => u.id === userId || u.userId === userId)
    return user?.profile ?? null
  } catch (error) {
    console.error('Error fetching user details:', error)
    throw error
  }
}

/**
 * Get Strava activities for a user (stored in users/{uid}/activities)
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of activity objects
 */
export async function getStravaActivities(userId) {
  try {
    const res = await api.get(`/api/strava/activities/${encodeURIComponent(userId)}`)
    return res.data?.data || []
  } catch (error) {
    console.error('Error fetching Strava activities:', error)
    return []
  }
}

/**
 * Get user check-in history (admin viewing another user). Uses GET /api/admin/users/:uid/history.
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of check-in logs
 */
export async function getUserHistory(userId) {
  try {
    const res = await api.get(`/api/admin/users/${encodeURIComponent(userId)}/history`)
    return res.data?.data || []
  } catch (error) {
    console.error('Error fetching user history:', error)
    throw error
  }
}

/**
 * Get debug timeline (last X days) for coach/admin. GET /api/admin/users/:uid/debug-history?days=...
 * @param {string} uid - User ID
 * @param {number} [days=14] - 7, 14, 28, or 56
 * @returns {Promise<{ profile: object, days: Array }>}
 */
export async function getDebugHistory(uid, days = 14) {
  const res = await api.get(`/api/admin/users/${encodeURIComponent(uid)}/debug-history`, {
    params: { days: [7, 14, 28, 56].includes(Number(days)) ? Number(days) : 14 }
  })
  return res.data?.data ?? { profile: null, days: [] }
}

/**
 * Delete own manual activity. DELETE /api/activities/:id — uid from token only (no body).
 * For deleting another user's activity use deleteUserActivity(uid, activityId) (admin route).
 * @param {string} activityId - Activity document id (root collection)
 */
export async function deleteActivity(activityId) {
  const res = await api.delete(`/api/activities/${encodeURIComponent(activityId)}`)
  return res.data
}

/**
 * Admin delete activity for a user. DELETE /api/admin/users/:uid/activities/:id
 * @param {string} uid - User (athlete) id
 * @param {string} activityId - Activity document id
 */
export async function deleteUserActivity(uid, activityId) {
  const res = await api.delete(
    `/api/admin/users/${encodeURIComponent(uid)}/activities/${encodeURIComponent(activityId)}`
  )
  return res.data
}

/**
 * Get Strava connection + sync status for a user (admin/coach). GET /api/admin/users/:uid/strava-status
 * @param {string} uid - User id
 * @returns {Promise<{ connected, connectedAt, lastSuccessAt, lastError, lastAttemptAt, newestStoredActivityDate }>}
 */
export async function getStravaStatus(uid) {
  const res = await api.get(`/api/admin/users/${encodeURIComponent(uid)}/strava-status`)
  return res.data
}

/**
 * Admin force Strava sync for a user. POST /api/admin/users/:uid/strava/sync-now
 * @param {string} uid - User id
 * @returns {Promise<{ success, fetched, inserted, skipped, newestStravaActivityStartDate, newestStoredActivityDate, ... }>}
 */
export async function syncUserStravaNow(uid) {
  const res = await api.post(`/api/admin/users/${encodeURIComponent(uid)}/strava/sync-now`)
  return res.data
}

/**
 * Live ACWR from activities (read-only). GET /api/admin/users/:uid/live-load-metrics?days=28
 * @param {string} uid - User id
 * @param {number} [days=28] - Window 28 or 56
 * @returns {Promise<{ success, uid, windowDays, sum7, sum28, chronic, acwr, acwrBand, contributors7d }>}
 */
export async function getLiveLoadMetrics(uid, days = 28) {
  const res = await api.get(`/api/admin/users/${encodeURIComponent(uid)}/live-load-metrics`, {
    params: { days: days === 56 ? 56 : 28 }
  })
  return res.data
}

/**
 * Safely convert various Firestore timestamp shapes to a JS Date
 * Supports:
 * - Firestore Timestamp instances (with .toDate())
 * - Plain JS Date / ISO strings / millis
 * - JSON-serialised timestamps: { _seconds, _nanoseconds } or { seconds, nanoseconds }
 */
function toDateFromFirestore(value) {
  if (!value) return null

  // Native Firestore Timestamp
  if (typeof value.toDate === 'function') {
    const d = value.toDate()
    return isNaN(d.getTime()) ? null : d
  }

  // Primitive date representations
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }

  // JSON-serialised Timestamp ({ _seconds, _nanoseconds } or { seconds, nanoseconds })
  if (typeof value === 'object') {
    const seconds = value._seconds ?? value.seconds
    const nanos = value._nanoseconds ?? value.nanoseconds ?? 0

    if (typeof seconds === 'number') {
      const millis = seconds * 1000 + nanos / 1e6
      const d = new Date(millis)
      return isNaN(d.getTime()) ? null : d
    }
  }

  return null
}

/**
 * Calculate statistics from users array.
 * This function focuses on totals derived from the users collection.
 * Check-ins today are loaded via a dedicated admin stats endpoint.
 *
 * @param {Array} users - Array of user documents
 * @param {Object} [override] - Optional override values (e.g. from backend stats)
 * @returns {Object} Statistics object
 */
export function calculateStats(users, override = {}) {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const newThisWeek = users.filter((user) => {
    const createdAtDate = toDateFromFirestore(user.createdAt)
    if (!createdAtDate) return false
    return createdAtDate >= weekAgo && createdAtDate <= now
  }).length

  const baseStats = {
    totalMembers: users.length,
    newThisWeek,
    checkinsToday: 0
  }

  // Allow backend-provided stats to override the client-side calculation
  if (typeof override.newThisWeek === 'number') {
    baseStats.newThisWeek = override.newThisWeek
  }
  if (typeof override.checkinsToday === 'number') {
    baseStats.checkinsToday = override.checkinsToday
  }

  return baseStats
}

/**
 * Fetch aggregated admin stats from backend (e.g. check-ins today)
 * Uses collectionGroup queries on the server so the client
 * does not need to load all users or logs.
 */
export async function fetchAdminStats() {
  const res = await api.get('/api/admin/stats')
  return res.data?.data || { newThisWeek: 0, checkinsToday: 0 }
}

/**
 * Import historical HRV/RHR data for a user
 * @param {string} userId - User ID
 * @param {Array} entries - Array of {date, hrv, rhr} objects
 * @returns {Promise<Object>} Import result
 */
export async function importHistory(userId, entries) {
  try {
    const res = await api.post('/api/admin/import-history', {
      userId,
      entries,
    })
    return res.data?.data
  } catch (error) {
    console.error('Error importing history:', error)
    throw error
  }
}

/**
 * Inject historical HRV/RHR telemetry for a user (Cold Start / Telemetry Injector)
 * Uses POST /api/admin/users/:uid/history — writes to users/{uid}/dailyLogs/{date}
 * @param {string} uid - User ID
 * @param {Array<{date: string, hrv: number, rhr: number}>} entries - e.g. [{ date: 'YYYY-MM-DD', hrv, rhr }]
 * @returns {Promise<{ injected: number, total: number }>}
 */
export async function injectHistory(uid, entries) {
  const res = await api.post(`/api/admin/users/${encodeURIComponent(uid)}/history`, {
    entries,
  })
  return res.data?.data
}

/**
 * Baseline import (HRV/RHR) — writes source="import"; used for baselines only, not today decision.
 * POST /api/admin/users/:uid/import-baseline
 * @param {string} uid - User ID
 * @param {Array<{date: string, hrv: number, rhr: number}>} entries
 * @param {boolean} [overwrite=false] - If true, overwrite existing import docs for same date
 * @returns {Promise<{ success: boolean, importedCount: number, skippedCount: number }>}
 */
export async function importBaseline(uid, entries, overwrite = false) {
  const res = await api.post(`/api/admin/users/${encodeURIComponent(uid)}/import-baseline`, {
    kind: 'HRV_RHR',
    entries,
    overwrite: !!overwrite,
  })
  return res.data
}

/**
 * Save admin-only internal notes for a user (never exposed to user app)
 * @param {string} userId - User ID
 * @param {string} adminNotes - Notes text
 * @returns {Promise<Object>}
 */
export async function saveAdminNotes(userId, adminNotes) {
  const res = await api.put('/api/admin/user-notes', {
    userId,
    adminNotes,
  })
  return res.data?.data
}

/**
 * Update a single check-in (dailyLog) — hrv, rhr, sleep, redFlags
 * @param {string} userId - User ID
 * @param {string} logId - Daily log document ID
 * @param {Object} patch - { hrv?, rhr?, sleep?, redFlags? }
 * @returns {Promise<Object>}
 */
export async function updateCheckIn(userId, logId, patch) {
  const res = await api.put('/api/admin/check-in', {
    userId,
    logId,
    patch,
  })
  return res.data?.data
}

/**
 * Fetch attention alerts: missed check-ins (>3 days inactive), critical status (today REST/RECOVER)
 * @returns {Promise<{ missed: Array, critical: Array }>}
 */
export async function fetchAlerts() {
  const res = await api.get('/api/admin/alerts')
  return res.data?.data || { missed: [], critical: [] }
}

/**
 * Update user cycle display (cycleDay, currentPhase) in profile.cycleData — admin only
 * @param {string} userId - User ID
 * @param {number} cycleDay - Current cycle day (1–length)
 * @param {string} currentPhase - e.g. Follicular, Luteal, Menstrual
 * @returns {Promise<Object>}
 */
export async function updateUserCycle(userId, cycleDay, currentPhase) {
  const profilePatch = {
    cycleData: {
      cycleDay: cycleDay != null ? Number(cycleDay) : undefined,
      currentPhase: currentPhase != null ? String(currentPhase) : undefined
    }
  }
  const res = await api.put('/api/admin/profile-patch', {
    userId,
    profilePatch,
  })
  return res.data?.data
}

/**
 * Update user profile (e.g. role) — admin only, uses profile-patch
 * @param {string} userId - User ID
 * @param {Object} profilePatch - e.g. { role: 'user'|'coach'|'admin' }
 * @returns {Promise<Object>}
 */
export async function updateUserProfile(userId, profilePatch) {
  const res = await api.put('/api/admin/profile-patch', {
    userId,
    profilePatch,
  })
  return res.data?.data
}

/**
 * Sync Strava history (last 30 days) for a user — admin only
 * @param {string} uid - User ID
 * @param {{ days?: number }} options - optional, days back (default 30)
 * @returns {Promise<{ count: number }>}
 */
export async function syncStravaHistory(uid, options = {}) {
  const res = await api.post(`/api/admin/strava/sync/${encodeURIComponent(uid)}`, {
    days: options.days ?? 30,
  })
  return res.data?.data || { count: 0 }
}

/**
 * Generate weekly report (Race Engineer) for a user — admin only
 * @param {string} uid - User ID
 * @returns {Promise<{ stats: Object, message: string }>}
 */
export async function fetchWeeklyReport(uid) {
  const res = await api.get(`/api/admin/reports/weekly/${encodeURIComponent(uid)}`)
  return res.data?.data || { stats: {}, message: '' }
}

/**
 * Fetch all teams (admin only)
 * @returns {Promise<Array>}
 */
export async function fetchAllTeams() {
  const res = await api.get('/api/admin/teams')
  return res.data?.data || []
}

/**
 * Create a team (admin only). Backend generates inviteCode.
 * @param {{ name: string, coachEmail?: string, memberLimit?: number }} payload
 * @returns {Promise<{ id: string }>}
 */
export async function createTeam(payload) {
  const res = await api.post('/api/admin/teams', payload)
  const data = res.data?.data || {}
  return { id: data.id }
}

/**
 * Assign user to team (admin only). Uses PATCH /api/admin/users/:id.
 * @param {string} userId
 * @param {string|null} teamId
 * @returns {Promise<{ id, teamId, role? }>}
 */
export async function assignUserToTeam(userId, teamId) {
  const res = await api.patch(`/api/admin/users/${encodeURIComponent(userId)}`, { teamId: teamId ?? null })
  return res.data?.data || {}
}

/**
 * Rename a team (admin only)
 * @param {string} teamId
 * @param {string} name
 */
export async function renameTeam(teamId, name) {
  const res = await api.patch(`/api/admin/teams/${encodeURIComponent(teamId)}`, {
    name,
  })
  return res.data?.data || {}
}

/**
 * Delete a team (admin only). Backend should orphan users (teamId=null).
 * @param {string} teamId
 */
export async function deleteTeam(teamId) {
  const res = await api.delete(`/api/admin/teams/${encodeURIComponent(teamId)}`)
  return res.data?.data || {}
}

/**
 * Delete a user (Auth + Firestore) — admin only. Requires explicit confirm in UI; backend requires body.confirm === true.
 * @param {string} uid - User ID
 * @returns {Promise<Object>}
 */
export async function deleteUser(uid) {
  const res = await api.delete(`/api/admin/users/${encodeURIComponent(uid)}`, {
    data: { confirm: true }
  })
  return res.data?.data
}

/**
 * Migrate all logs and activities from one athlete to another (admin only).
 * Uses POST /api/admin/migrate-data on the backend.
 *
 * @param {string} sourceUid - Old account UID
 * @param {string} targetUid - New account UID
 * @returns {Promise<{ logsMoved: number, activitiesMoved: number }>}
 */
export async function migrateUserData(sourceUid, targetUid) {
  const res = await api.post('/api/admin/migrate-data', {
    sourceUid,
    targetUid,
  })
  return res.data?.data || { logsMoved: 0, activitiesMoved: 0 }
}
