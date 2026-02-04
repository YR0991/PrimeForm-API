// Admin Service - Firestore data operations for admin dashboard
import { API_URL } from '../config/api.js'

/**
 * Fetch all users from Firestore
 * @returns {Promise<Array>} Array of user documents
 */
export async function fetchAllUsers() {
  try {
    // Get admin email from localStorage
    const adminEmail = localStorage.getItem('admin_email')
    
    if (!adminEmail) {
      throw new Error('Admin email not found. Please login first.')
    }
    
    const response = await fetch(`${API_URL}/api/admin/users?adminEmail=${encodeURIComponent(adminEmail)}`)
    
    if (!response.ok) {
      if (response.status === 403) {
        // Clear invalid admin email
        localStorage.removeItem('admin_email')
        throw new Error('Unauthorized: Invalid admin credentials')
      }
      throw new Error(`Failed to fetch users: ${response.statusText}`)
    }
    
    const data = await response.json()
    return data.data || []
  } catch (error) {
    console.error('Error fetching users:', error)
    throw error
  }
}

/**
 * Get user details including intake data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User profile with intake data
 */
export async function getUserDetails(userId) {
  try {
    const response = await fetch(`${API_URL}/api/profile?userId=${encodeURIComponent(userId)}`)
    
    if (!response.ok) {
      throw new Error(`Failed to fetch user details: ${response.statusText}`)
    }
    
    const data = await response.json()
    return data.data?.profile || null
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
    const response = await fetch(`${API_URL}/api/strava/activities/${encodeURIComponent(userId)}`)
    if (!response.ok) return []
    const data = await response.json()
    return data.data || []
  } catch (error) {
    console.error('Error fetching Strava activities:', error)
    return []
  }
}

/**
 * Get user check-in history
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of check-in logs
 */
export async function getUserHistory(userId) {
  try {
    const response = await fetch(`${API_URL}/api/history?userId=${encodeURIComponent(userId)}`)
    
    if (!response.ok) {
      throw new Error(`Failed to fetch user history: ${response.statusText}`)
    }
    
    const data = await response.json()
    return data.data || []
  } catch (error) {
    console.error('Error fetching user history:', error)
    throw error
  }
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
  const adminEmail = localStorage.getItem('admin_email')

  if (!adminEmail) {
    throw new Error('Admin email not found. Please login first.')
  }

  const response = await fetch(
    `${API_URL}/api/admin/stats?adminEmail=${encodeURIComponent(adminEmail)}`
  )

  if (!response.ok) {
    if (response.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Invalid admin credentials')
    }
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch admin stats: ${response.statusText}`)
  }

  const data = await response.json()
  return data.data || { newThisWeek: 0, checkinsToday: 0 }
}

/**
 * Import historical HRV/RHR data for a user
 * @param {string} userId - User ID
 * @param {Array} entries - Array of {date, hrv, rhr} objects
 * @returns {Promise<Object>} Import result
 */
export async function importHistory(userId, entries) {
  try {
    const adminEmail = localStorage.getItem('admin_email')
    
    if (!adminEmail) {
      throw new Error('Admin email not found. Please login first.')
    }
    
    const response = await fetch(`${API_URL}/api/admin/import-history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-email': adminEmail
      },
      body: JSON.stringify({
        userId,
        entries,
        adminEmail
      })
    })
    
    if (!response.ok) {
      if (response.status === 403) {
        localStorage.removeItem('admin_email')
        throw new Error('Unauthorized: Invalid admin credentials')
      }
      const errorData = await response.json()
      throw new Error(errorData.error || `Failed to import history: ${response.statusText}`)
    }
    
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error('Error importing history:', error)
    throw error
  }
}

/**
 * Save admin-only internal notes for a user (never exposed to user app)
 * @param {string} userId - User ID
 * @param {string} adminNotes - Notes text
 * @returns {Promise<Object>}
 */
export async function saveAdminNotes(userId, adminNotes) {
  const adminEmail = localStorage.getItem('admin_email')
  if (!adminEmail) throw new Error('Admin email not found. Please login first.')
  const response = await fetch(`${API_URL}/api/admin/user-notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
    body: JSON.stringify({ userId, adminNotes, adminEmail })
  })
  if (!response.ok) {
    if (response.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Invalid admin credentials')
    }
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Failed to save notes: ${response.statusText}`)
  }
  const data = await response.json()
  return data.data
}

/**
 * Update a single check-in (dailyLog) — hrv, rhr, sleep, redFlags
 * @param {string} userId - User ID
 * @param {string} logId - Daily log document ID
 * @param {Object} patch - { hrv?, rhr?, sleep?, redFlags? }
 * @returns {Promise<Object>}
 */
export async function updateCheckIn(userId, logId, patch) {
  const adminEmail = localStorage.getItem('admin_email')
  if (!adminEmail) throw new Error('Admin email not found. Please login first.')
  const response = await fetch(`${API_URL}/api/admin/check-in`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
    body: JSON.stringify({ userId, logId, patch, adminEmail })
  })
  if (!response.ok) {
    if (response.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Invalid admin credentials')
    }
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Failed to update check-in: ${response.statusText}`)
  }
  const data = await response.json()
  return data.data
}

/**
 * Fetch attention alerts: missed check-ins (>3 days inactive), critical status (today REST/RECOVER)
 * @returns {Promise<{ missed: Array, critical: Array }>}
 */
export async function fetchAlerts() {
  const adminEmail = localStorage.getItem('admin_email')
  if (!adminEmail) throw new Error('Admin email not found. Please login first.')
  const response = await fetch(`${API_URL}/api/admin/alerts?adminEmail=${encodeURIComponent(adminEmail)}`)
  if (!response.ok) {
    if (response.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Invalid admin credentials')
    }
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Failed to fetch alerts: ${response.statusText}`)
  }
  const data = await response.json()
  return data.data || { missed: [], critical: [] }
}

/**
 * Update user cycle display (cycleDay, currentPhase) in profile.cycleData — admin only
 * @param {string} userId - User ID
 * @param {number} cycleDay - Current cycle day (1–length)
 * @param {string} currentPhase - e.g. Follicular, Luteal, Menstrual
 * @returns {Promise<Object>}
 */
export async function updateUserCycle(userId, cycleDay, currentPhase) {
  const adminEmail = localStorage.getItem('admin_email')
  if (!adminEmail) throw new Error('Admin email not found. Please login first.')
  const profilePatch = {
    cycleData: {
      cycleDay: cycleDay != null ? Number(cycleDay) : undefined,
      currentPhase: currentPhase != null ? String(currentPhase) : undefined
    }
  }
  const response = await fetch(`${API_URL}/api/admin/profile-patch`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
    body: JSON.stringify({ userId, profilePatch, adminEmail })
  })
  if (!response.ok) {
    if (response.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Invalid admin credentials')
    }
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Failed to update profile: ${response.statusText}`)
  }
  const data = await response.json()
  return data.data
}

/**
 * Delete a user (Auth + Firestore) — admin only
 * @param {string} uid - User ID
 * @returns {Promise<Object>}
 */
export async function deleteUser(uid) {
  const adminEmail = localStorage.getItem('admin_email')
  if (!adminEmail) throw new Error('Admin email not found. Please login first.')
  const response = await fetch(`${API_URL}/api/admin/users/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: { 'x-admin-email': adminEmail }
  })
  if (!response.ok) {
    if (response.status === 403) {
      localStorage.removeItem('admin_email')
      throw new Error('Unauthorized: Invalid admin credentials')
    }
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Failed to delete user: ${response.statusText}`)
  }
  const data = await response.json()
  return data.data
}
