import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
} from 'vue-router'
import routes from './routes'
import { API_URL } from '../config/api.js'
import { useAuthStore } from '../stores/auth'

/**
 * Get user ID for profile checks. Prefer Firebase uid when authenticated.
 */
const getUserIdForProfileCheck = (authStore) => {
  if (authStore?.user?.uid) return authStore.user.uid
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
    //    geef Firebase extra ademruimte voordat we naar /login sturen
    if (!isAuthenticated && to.path === '/profile' && to.query?.status === 'strava_connected') {
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (authStore.user) return true
    }

    const requiresAuth = to.meta?.requiresAuth === true
    const requiredRole = to.meta?.role

    // If already authenticated, keep them out of /login
    if (to.path === '/login' && authStore.isAuthenticated) {
      if (authStore.isAdmin) return { path: '/admin' }
      return { path: '/dashboard' }
    }

    // Admin: keep in Command Center — no athlete dashboard/profile
    if (authStore.isAdmin && (to.path === '/dashboard' || to.path === '/profile')) {
      return { path: '/admin' }
    }

    // Auth gate
    if (requiresAuth && !authStore.isAuthenticated) {
      return {
        path: '/login',
        query: { redirect: to.fullPath },
      }
    }

    // Role gate (admin / coach): /admin requires role === 'admin', /coach requires role === 'coach'
    if (requiredRole && authStore.role !== requiredRole) {
      return authStore.isAuthenticated
        ? { path: '/dashboard' }
        : { path: '/login' }
    }

    // Allow direct access to login & admin/coach routes (role already checked above for /admin, /coach)
    if (to.path === '/login') return true
    if (to.path === '/admin' || to.path.startsWith('/admin')) return true
    if (to.path === '/coach') return true

    // Strava return: allow through to intake (no onboarding loop)
    if (to.query?.status === 'strava_connected') return true

    // Ensure profile is loaded before any onboarding-based redirect (prevents intake "pop-up" race)
    if (authStore.isAuthReady && authStore.isAuthenticated && authStore.user?.uid) {
      if (!authStore.hasProfileLoadedForCurrentUser) {
        await authStore.fetchUserProfile(authStore.user.uid)
      }
    }

    // Onboarding route: admins and coaches NEVER see intake
    if (to.path === '/onboarding') {
      if (!authStore.isAuthenticated) {
        return { path: '/login', query: { redirect: to.fullPath } }
      }
      if (authStore.isAdmin || authStore.isCoach || authStore.isImpersonating) {
        return { path: '/dashboard' }
      }
      if (authStore.isOnboardingComplete) {
        return { path: '/dashboard' }
      }
      return true
    }

    // Dashboard: alleen terugsturen naar intake als onboarding ZEKER niet af is (geen loop)
    if (to.path === '/dashboard' && authStore.isAuthenticated) {
      if (authStore.isCoach || authStore.isImpersonating) {
        return true
      }
      // Admin is already redirected to /admin above
      if (authStore.isOnboardingComplete === false) {
        return { path: '/intake' }
      }
      return true
    }

    // Intake: coaches/admins → dashboard; authenticated users with onboarding complete → dashboard
    if (to.path === '/intake') {
      if (authStore.isCoach || authStore.isAdmin || authStore.isImpersonating) {
        return { path: '/dashboard' }
      }
      if (authStore.isAuthenticated && authStore.hasProfileLoadedForCurrentUser && authStore.isOnboardingComplete) {
        return { path: '/dashboard' }
      }
      if (authStore.isAuthenticated && authStore.hasProfileLoadedForCurrentUser) {
        return true
      }
      try {
        const userId = getUserIdForProfileCheck(authStore)
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
        return true
      }
      return true
    }

    return true
  })

  return Router
})
