import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
  createWebHashHistory,
} from 'vue-router'
import routes from './routes'
import { API_BASE_URL } from '../config/api.js'

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
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(process.env.VUE_ROUTER_BASE),
  })

  // Redirect to intake if profile is incomplete
  Router.beforeEach(async (to) => {
    // Only run in browser
    if (process.env.SERVER) return true

    // Allow direct access to intake route
    if (to.path === '/intake') {
      // If already complete, bounce to dashboard
      try {
        const userId = getOrCreateUserId()
        const now = Date.now()
        const shouldRefetch = profileCache.userId !== userId || now - profileCache.fetchedAt > 30_000

        if (shouldRefetch) {
          const resp = await fetch(`${API_BASE_URL}/api/profile?userId=${encodeURIComponent(userId)}`)
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
      const shouldRefetch = profileCache.userId !== userId || now - profileCache.fetchedAt > 30_000

      if (shouldRefetch) {
        const resp = await fetch(`${API_BASE_URL}/api/profile?userId=${encodeURIComponent(userId)}`)
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
