// API base URL: development → localhost, production → Render (geen trailing slash om dubbele slashes te voorkomen)
const RENDER_BACKEND_URL = 'https://primeform-backend.onrender.com'
const rawUrl = import.meta.env.DEV
  ? 'http://localhost:3000'
  : (import.meta.env.VITE_API_URL || RENDER_BACKEND_URL)
const API_URL = rawUrl.replace(/\/$/, '')

export { API_URL, RENDER_BACKEND_URL }
export const API_BASE_URL = API_URL
