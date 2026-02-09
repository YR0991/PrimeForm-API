// Admin: altijd /admin toestaan; de AdminPage toont zelf een inlogformulier als er geen geldig admin_email is.
// Geen prompt() meer (werkt slecht/geblokkeerd in incognito en redirect naar /).
const adminGuard = () => true

const routes = [
  {
    path: '/login',
    component: () => import('layouts/MainLayout.vue'),
    children: [{ path: '', component: () => import('pages/LoginPage.vue') }],
  },
  {
    path: '/onboarding',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        component: () => import('pages/onboarding/OnboardingPage.vue'),
        meta: { requiresAuth: true },
      },
    ],
  },
  {
    path: '/intake',
    component: () => import('layouts/MainLayout.vue'),
    children: [{ path: '', component: () => import('pages/IntakeStepper.vue') }],
  },
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      {
        path: 'dashboard',
        component: () => import('pages/IndexPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'insights',
        component: () => import('pages/InsightsPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'settings',
        component: () => import('pages/SettingsPage.vue'),
        meta: { requiresAuth: true },
      },
    ],
  },
  {
    path: '/admin',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        component: () => import('pages/admin/AdminPage.vue'),
        meta: { requiresAuth: true, role: 'admin' },
      },
    ],
    beforeEnter: adminGuard,
  },
  {
    path: '/coach',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        component: () => import('pages/coach/CoachDashboard.vue'),
        meta: { requiresAuth: true, role: 'coach' },
      },
    ],
    beforeEnter: adminGuard,
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
]

export default routes
