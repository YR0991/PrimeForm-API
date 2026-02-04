// API base URL: development → localhost, production → Render
const RENDER_BACKEND_URL = 'https://primeform-backend.onrender.com'
const API_URL = import.meta.env.DEV
  ? 'http://localhost:3000'
  : (import.meta.env.VITE_API_URL || RENDER_BACKEND_URL)

export { API_URL, RENDER_BACKEND_URL }
export const API_BASE_URL = API_URL // Keep for backwards compatibility
