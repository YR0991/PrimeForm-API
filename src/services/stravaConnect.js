import { auth } from '../boot/firebase.js'
import { API_URL } from '../config/api.js'

/**
 * Start Strava OAuth connect flow with Authorization header (no direct navigation).
 * Calls GET /auth/strava/connect with Bearer token, reads Location from 302, then window.location = url.
 * Rejects if no currentUser, no token, or backend does not return a redirect URL.
 * @returns {Promise<void>} Resolves right before redirect; rejects with message for UI error.
 */
export async function startStravaConnect() {
  const user = auth.currentUser
  if (!user) {
    throw new Error('Niet ingelogd. Log in om Strava te koppelen.')
  }
  let token
  try {
    token = await user.getIdToken(false)
  } catch (e) {
    throw new Error('Kon sessie niet verifiëren. Log opnieuw in.')
  }
  if (!token) {
    throw new Error('Geen geldige sessie. Log opnieuw in.')
  }

  const response = await fetch(`${API_URL}/auth/strava/connect`, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 401) {
    throw new Error('Sessie verlopen. Log opnieuw in.')
  }
  if (response.type === 'opaqueredirect' || response.status === 0) {
    throw new Error('Kon geen redirect ontvangen. Probeer het opnieuw.')
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Serverfout (${response.status}). Probeer het later opnieuw.`)
  }

  const redirectUrl = response.status === 302 ? response.headers.get('Location') : null
  if (!redirectUrl) {
    throw new Error('Geen redirect van server. Probeer het opnieuw.')
  }
  window.location.href = redirectUrl
}
