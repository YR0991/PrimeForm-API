/**
 * Pure logic for API response error handling. Used by httpClient interceptor.
 * For 409 STRAVA_REAUTH_REQUIRED we resolve with error.response so callers don't enter catch.
 * @param {{ response?: { status?: number, data?: { code?: string } } }} error
 * @returns {Promise<unknown> | null} Promise.resolve(error.response) or null (caller should reject)
 */
export function resolveOnStravaReauth(error) {
  const status = error?.response?.status
  const data = error?.response?.data
  if (status === 409 && data?.code === 'STRAVA_REAUTH_REQUIRED') {
    return Promise.resolve(error.response)
  }
  return null
}
