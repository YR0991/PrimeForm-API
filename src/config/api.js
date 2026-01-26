// API base URL configuration
// Set VITE_API_URL in Vercel dashboard to your Render backend URL
// Example: https://primeform-backend.onrender.com
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export { API_URL }
export const API_BASE_URL = API_URL // Keep for backwards compatibility
