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
 * Calculate statistics from users array
 * @param {Array} users - Array of user documents
 * @returns {Object} Statistics object
 */
export function calculateStats(users) {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  
  const newThisWeek = users.filter(user => {
    const createdAt = user.createdAt?.toDate ? user.createdAt.toDate() : new Date(user.createdAt)
    return createdAt >= weekAgo
  }).length
  
  // For check-ins today, we'd need to query dailyLogs
  // This is a placeholder - you'd need to aggregate from history
  const checkinsToday = 0 // Placeholder
  
  return {
    totalMembers: users.length,
    newThisWeek,
    checkinsToday
  }
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
