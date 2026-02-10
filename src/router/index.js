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

    // 1. Force wait for Firebase to initialize if it hasn't yet
    if (!authStore.isInitialized) {
      await authStore.init()
    }

    let isAuthenticated = !!authStore.user

    // 2. Strava comeback: if we land on /profile?status=strava_connected but auth not ready yet,
    //    wait briefly for the session to settle before redirecting to login
    if (!isAuthenticated && to.path === '/profile' && to.query?.status === 'strava_connected') {
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (authStore.user) return true
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

    // Onboarding route: coaches/admins/Shadow Mode skip it; redirect completed athletes away
    if (to.path === '/onboarding') {
      if (!authStore.isAuthenticated) {
        return {
          path: '/login',
          query: { redirect: to.fullPath },
        }
      }
      if (authStore.isCoach || authStore.isAdmin || authStore.isImpersonating) {
        return { path: '/dashboard' }
      }
      if (authStore.isOnboardingComplete) {
        return { path: '/dashboard' }
      }
      return true
    }

    // Onboarding gate for dashboard: authenticated users without onboarding
    // Skip for coaches, admins, and Shadow Mode (impersonation).
    if (
      to.path === '/dashboard' &&
      authStore.isAuthenticated &&
      !authStore.isOnboardingComplete &&
      !authStore.isCoach &&
      !authStore.isAdmin &&
      !authStore.isImpersonating
    ) {
      return { path: '/onboarding' }
    }

    // Existing intake/profile gating
    if (to.path === '/intake') {
      if (authStore.isCoach || authStore.isAdmin || authStore.isImpersonating) {
        return { path: '/dashboard' }
      }
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

    // Coaches and Shadow Mode skip athlete profile/intake gate (they use coach dashboard)
    if (to.path === '/dashboard' && (authStore.isCoach || authStore.isAdmin || authStore.isImpersonating)) {
      return true
    }

    // For any other route: ensure profile is complete
    if (authStore.isCoach || authStore.isAdmin || authStore.isImpersonating) {
      return true
    }
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
