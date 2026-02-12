import axios from 'axios'
import { Notify } from 'quasar'
import { API_URL } from '../config/api.js'
import { useAuthStore } from '../stores/auth.js'

/**
 * Centrale Axios instance voor alle API-calls.
 * - Base URL: API_URL
 * - withCredentials: true (voor cookies waar nodig)
 * - Request interceptor: voegt auth/role headers toe op basis van Auth Store
 * - Response interceptor: toont globale foutmelding bij 4xx/5xx / netwerkfouten
 */
export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

api.interceptors.request.use(
  (config) => {
    try {
      const authStore = useAuthStore()

      const headers = config.headers || {}

      // Primaire bron: ingelogde user uit Auth Store
      const emailFromStore = authStore.user?.email || ''

      // Legacy fallback: localStorage (wordt later uitgefaseerd)
      const adminEmailLS = (localStorage.getItem('admin_email') || '').trim()
      const coachEmailLS = (localStorage.getItem('coach_email') || '').trim()

      // Admin-header
      if (!headers['x-admin-email']) {
        if (adminEmailLS) {
          headers['x-admin-email'] = adminEmailLS
        } else if (authStore.isAdmin && emailFromStore) {
          headers['x-admin-email'] = emailFromStore
        }
      }

      // Coach-header
      if (!headers['x-coach-email']) {
        if (coachEmailLS) {
          headers['x-coach-email'] = coachEmailLS
        } else if (authStore.isCoach && emailFromStore) {
          headers['x-coach-email'] = emailFromStore
        }
      }

      // Hier zou eventueel later een Authorization Bearer <idToken> header kunnen komen
      // als we Firebase ID tokens willen meesturen naar de backend.

      config.headers = headers
      return config
    } catch (err) {
      // Als de store om wat voor reden dan ook niet bereikbaar is, laat de request doorgaan
      // zonder extra headers, zodat de call niet hard faalt.
      console.error('[api] request interceptor error', err)
      return config
    }
  },
  (error) => Promise.reject(error),
)

api.interceptors.response.use(
  (response) => response,
  (error) => {
    try {
      const status = error?.response?.status
      const data = error?.response?.data

      // Bepaal een zo informatief mogelijke foutmelding
      const msgFromServer = data?.error || data?.message
      const fallbackMsg =
        status >= 500
          ? 'Er ging iets mis aan de serverkant. Probeer het later opnieuw.'
          : 'De actie is mislukt. Controleer je invoer of probeer het opnieuw.'

      const message =
        msgFromServer ||
        (error.message && !error.message.includes('Network Error')
          ? error.message
          : fallbackMsg)

      // Toon globale toast (geen stille fails meer)
      Notify.create({
        type: 'negative',
        message,
      })
    } catch (notifyErr) {
      console.error('[api] response interceptor notify error', notifyErr)
    }

    return Promise.reject(error)
  },
)

