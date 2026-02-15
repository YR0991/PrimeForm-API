import { auth } from '../boot/firebase.js'
import { api } from './httpClient.js'

/**
 * Start Strava OAuth connect flow via JSON connect-url endpoint.
 * Calls GET /api/strava/connect-url (Authorization from httpClient), then redirects to data.url.
 * Rejects if no currentUser or backend does not return a url.
 * @returns {Promise<void>} Resolves right before redirect; rejects with message for UI error.
 */
export async function startStravaConnect() {
  if (!auth.currentUser) {
    throw new Error('Niet ingelogd. Log in om Strava te koppelen.')
  }

  const res = await api.get('/api/strava/connect-url')
  const url = res.data?.url
  if (!url || typeof url !== 'string') {
    throw new Error('Geen koppel-URL ontvangen. Probeer het opnieuw.')
  }
  try {
    if (typeof window !== 'undefined' && window.location) {
      const path = window.location.pathname || '/dashboard'
      const search = window.location.search || ''
      const hash = window.location.hash || ''
      window.sessionStorage?.setItem('pf_intended_after_strava', path + search + hash)
    }
  } catch (_) {}
  window.location.href = url
}
