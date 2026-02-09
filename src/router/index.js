import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
} from 'vue-router'
import routes from './routes'
import { API_URL } from '../config/api.js'
import { useAuthStore } from '../stores/auth'

const getOrCreateUserId = () => {
  const key = 'primeform_user_id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const newId = `pf_${Date.now()}`
  localStorage.setItem(key, newId)
  return newId
}

let profileCache = {
  userId: null,
  profileComplete: null,
  fetchedAt: 0,
}

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default defineRouter(function (/* { store, ssrContext } */) {
  // HARD FORCE history mode - NO HASH, NO CONDITIONALS
  let history
  if (process.env.SERVER) {
    history = createMemoryHistory()
  } else {
    // ALWAYS use createWebHistory in browser - NO hash mode
    history = createWebHistory('/')
  }

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history,
  })

  Router.beforeEach(async (to) => {
    // Only run in browser
    if (process.env.SERVER) return true

    const authStore = useAuthStore()
    if (!authStore.isAuthReady) {
      await authStore.init()
    }

    const requiresAuth = to.meta?.requiresAuth === true
    const requiredRole = to.meta?.role

    // If already authenticated, keep them out of /login
    if (to.path === '/login' && authStore.isAuthenticated) {
      if (authStore.isAdmin) return { path: '/admin' }
      return { path: '/dashboard' }
    }

    // Auth gate
    if (requiresAuth && !authStore.isAuthenticated) {
      return {
        path: '/login',
        query: { redirect: to.fullPath },
      }
    }

    // Role gate (admin / coach)
    if (requiredRole && authStore.role !== requiredRole) {
      // Fallback: send to dashboard if logged in, otherwise to login
      return authStore.isAuthenticated
        ? { path: '/dashboard' }
        : { path: '/login' }
    }

    // Allow direct access to login & admin/coach routes without profile gating
    if (to.path === '/login') return true
    if (to.path === '/admin' || to.path.startsWith('/admin')) return true
    if (to.path === '/coach') return true

    // Existing intake/profile gating
    if (to.path === '/intake') {
      try {
        const userId = getOrCreateUserId()
        const now = Date.now()
        const shouldRefetch =
          profileCache.userId !== userId || now - profileCache.fetchedAt > 30_000

        if (shouldRefetch) {
          const resp = await fetch(
            `${API_URL}/api/profile?userId=${encodeURIComponent(userId)}`
          )
          const json = await resp.json()
          profileCache = {
            userId,
            profileComplete: json?.data?.profileComplete === true,
            fetchedAt: now,
          }
        }

        if (profileCache.profileComplete === true) return { path: '/' }
      } catch {
        // If profile check fails, still allow intake
        return true
      }
      return true
    }

    // For any other route: ensure profile is complete
    try {
      const userId = getOrCreateUserId()
      const now = Date.now()
      const shouldRefetch =
        profileCache.userId !== userId || now - profileCache.fetchedAt > 30_000

      if (shouldRefetch) {
        const resp = await fetch(
          `${API_URL}/api/profile?userId=${encodeURIComponent(userId)}`
        )
        const json = await resp.json()
        profileCache = {
          userId,
          profileComplete: json?.data?.profileComplete === true,
          fetchedAt: now,
        }
      }

      if (profileCache.profileComplete !== true) {
        return { path: '/intake' }
      }
    } catch {
      // If backend is unreachable, don't hard-block navigation
      return true
    }

    return true
  })

  return Router
})
