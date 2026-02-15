import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
} from 'vue-router'
import routes from './routes'
import { useAuthStore } from '../stores/auth'

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

    // Admin: keep in Command Center — no athlete dashboard/profile (unless impersonating)
    if (authStore.isAdmin && !authStore.isImpersonating && (to.path === '/dashboard' || to.path === '/profile')) {
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

    // Loading: bootstrap when UNKNOWN, then redirect to intendedRoute or /dashboard
    if (to.path === '/loading') {
      if (!authStore.isAuthenticated) {
        return { path: '/login', query: { redirect: to.fullPath } }
      }
      if (authStore.isOnboardingStatusUnknown) {
        await authStore.bootstrapProfile()
      }
      if (!authStore.isOnboardingStatusUnknown) {
        const intended = (to.query?.intendedRoute || '/dashboard').replace(/^\/+/, '/')
        const { intendedRoute: _drop, ...restQuery } = to.query || {}
        return { path: intended, query: restQuery }
      }
      return true
    }

    // Authenticated but onboarding status still unknown → go to /loading first (no /intake until resolved)
    if (authStore.isAuthenticated && authStore.isOnboardingStatusUnknown) {
      const allowed = ['/loading', '/login', '/coach'].includes(to.path) || to.path.startsWith('/admin')
      if (!allowed) {
        const intendedRoute = to.query?.status === 'strava_connected' ? '/dashboard' : (to.path || '/dashboard')
        return {
          path: '/loading',
          query: { intendedRoute, ...to.query },
        }
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
      if (authStore.onboardingStatus === 'COMPLETE') {
        return { path: '/dashboard' }
      }
      return true
    }

    // Dashboard: redirect to intake only when status is INCOMPLETE (not when UNKNOWN)
    if (to.path === '/dashboard' && authStore.isAuthenticated) {
      if (authStore.isCoach || authStore.isImpersonating) {
        return true
      }
      if (authStore.onboardingStatus === 'INCOMPLETE') {
        return { path: '/intake' }
      }
      return true
    }

    // Intake: redirect away when COMPLETE; never land here when UNKNOWN (guard above sends to /loading)
    if (to.path === '/intake') {
      if (authStore.isCoach || authStore.isAdmin || authStore.isImpersonating) {
        return { path: '/dashboard' }
      }
      if (authStore.isAuthenticated && authStore.onboardingStatus === 'COMPLETE') {
        return { path: '/dashboard' }
      }
      return true
    }

    return true
  })

  return Router
})
