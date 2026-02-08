// Admin: altijd /admin toestaan; de AdminPage toont zelf een inlogformulier als er geen geldig admin_email is.
// Geen prompt() meer (werkt slecht/geblokkeerd in incognito en redirect naar /).
const adminGuard = () => true

const routes = [
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
      { path: 'dashboard', component: () => import('pages/IndexPage.vue') },
      { path: 'insights', component: () => import('pages/InsightsPage.vue') },
      { path: 'settings', component: () => import('pages/SettingsPage.vue') },
    ],
  },
  {
    path: '/admin',
    component: () => import('layouts/MainLayout.vue'),
    children: [{ path: '', component: () => import('pages/admin/AdminPage.vue') }],
    beforeEnter: adminGuard
  },
  {
    path: '/coach',
    component: () => import('layouts/MainLayout.vue'),
    children: [{ path: '', component: () => import('pages/coach/CoachDashboard.vue') }],
    beforeEnter: adminGuard
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
]

export default routes
