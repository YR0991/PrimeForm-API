import axios from 'axios'
import { signOut } from 'firebase/auth'
import { Notify } from 'quasar'
import { API_URL } from '../config/api.js'
import { auth } from '../boot/firebase.js'
import { useAuthStore } from '../stores/auth.js'

import { resolveOnStravaReauth } from './responseErrorHandling.js'

export { resolveOnStravaReauth } from './responseErrorHandling.js'

/**
 * Single HTTP client for all /api/* calls.
 * - Injects Authorization: Bearer <idToken> from Firebase currentUser.
 * - On 401: retry once with getIdToken(true); if still 401, sign out and redirect to /login.
 * - Keeps optional x-admin-email / x-coach-email / x-user-uid for legacy or admin/coach flows.
 */
export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

api.interceptors.request.use(
  async (config) => {
    const headers = config.headers || {}

    const user = auth.currentUser
    if (!user) {
      if (import.meta.env.DEV) {
        console.warn('[httpClient] No Firebase user; request may 401:', config.url || config.method)
      }
    } else {
      try {
        const token = await user.getIdToken(false)
        if (token) {
          headers.Authorization = `Bearer ${token}`
        } else if (import.meta.env.DEV) {
          console.warn('[httpClient] getIdToken returned empty; request may 401:', config.url || config.method)
        }
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn('[httpClient] getIdToken failed:', e?.message, config.url || config.method)
        }
      }
    }

    try {
      const authStore = useAuthStore()
      const emailFromStore = authStore.user?.email || ''
      const adminEmailLS = (localStorage.getItem('admin_email') || '').trim()
      const coachEmailLS = (localStorage.getItem('coach_email') || '').trim()
      if (!headers['x-admin-email']) {
        if (adminEmailLS) headers['x-admin-email'] = adminEmailLS
        else if (authStore.isAdmin && emailFromStore) headers['x-admin-email'] = emailFromStore
      }
      if (!headers['x-coach-email']) {
        if (coachEmailLS) headers['x-coach-email'] = coachEmailLS
        else if (authStore.isCoach && emailFromStore) headers['x-coach-email'] = emailFromStore
      }
      const shadowUid = (localStorage.getItem('pf_shadow_uid') || '').trim()
      if (shadowUid) {
        headers['x-user-uid'] = shadowUid
      } else {
        const uid = authStore.activeUid || authStore.user?.uid || ''
        if (uid) headers['x-user-uid'] = uid
      }
      headers['x-shadow-mode'] = shadowUid ? '1' : '0'
    } catch (err) {
      console.error('[httpClient] request interceptor error', err)
    }

    config.headers = headers
    return config
  },
  (error) => Promise.reject(error),
)

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error?.config
    const status = error?.response?.status

    if (status === 401 && originalRequest && !originalRequest._retried) {
      originalRequest._retried = true
      const user = auth.currentUser
      if (user) {
        try {
          const token = await user.getIdToken(true)
          if (token) {
            originalRequest.headers = originalRequest.headers || {}
            originalRequest.headers.Authorization = `Bearer ${token}`
            return api.request(originalRequest)
          }
        } catch (refreshErr) {
          if (import.meta.env.DEV) console.warn('[httpClient] 401 retry getIdToken(true) failed', refreshErr?.message)
        }
      }
      await signOut(auth)
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = '/login'
      }
      return Promise.reject(error)
    }

    try {
      const resolved = resolveOnStravaReauth(error)
      if (resolved !== null) {
        Notify.create({ type: 'warning', message: 'Koppel opnieuw' })
        return resolved
      }
      const data = error?.response?.data
      const msgFromServer = data?.error || data?.message
      const fallbackMsg =
        status >= 500
          ? 'Er ging iets mis aan de serverkant. Probeer het later opnieuw.'
          : 'De actie is mislukt. Controleer je invoer of probeer het opnieuw.'
      const message = msgFromServer || (error.message && !error.message.includes('Network Error') ? error.message : fallbackMsg)
      Notify.create({ type: 'negative', message })
    } catch (notifyErr) {
      console.error('[httpClient] response interceptor notify error', notifyErr)
    }

    return Promise.reject(error)
  },
)
