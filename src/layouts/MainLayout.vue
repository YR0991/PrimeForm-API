<template>
  <q-layout view="hHh lpR fFf">
    <div v-if="isImpersonating" class="shadow-banner">
      <div class="shadow-text">
        SHADOW MODE:
        Je bekijkt momenteel het dashboard van
        <span class="shadow-name">{{ impersonatedName }}</span>
      </div>
      <q-btn
        dense
        flat
        no-caps
        color="black"
        class="shadow-stop-btn"
        label="STOPPEN"
        @click="handleStopImpersonation"
      />
    </div>

    <q-header class="premium-header" elevated="false">
      <q-toolbar>
        <router-link :to="isAdmin ? '/admin' : '/dashboard'" class="premium-title-link">
          <q-toolbar-title class="premium-title">
            PRIMEFORM
          </q-toolbar-title>
        </router-link>
        <q-space />

        <q-btn
          v-if="isAuthenticated"
          flat
          dense
          round
          :icon="profileIcon"
          :to="isAdmin ? '/admin' : '/profile'"
          class="header-profile-btn"
          :aria-label="profileAriaLabel"
        >
          <q-tooltip v-if="profileTooltip">
            {{ profileTooltip }}
          </q-tooltip>
        </q-btn>

        <q-btn-dropdown
          v-if="isAuthenticated"
          flat
          dense
          no-caps
          class="identity-dropdown"
        >
          <template #label>
            <div class="identity-label">
              <span class="identity-role">{{ userRole || 'ATHLETE' }}</span>
              <span v-if="userEmail" class="identity-email">
                {{ userEmail }}
              </span>
            </div>
          </template>

          <q-list dark class="identity-menu">
            <template v-if="isAdmin">
              <q-item clickable v-close-popup to="/admin">
                <q-item-section avatar>
                  <q-icon name="admin_panel_settings" color="amber" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="identity-item-label">TEAM ADMIN</q-item-label>
                </q-item-section>
              </q-item>
              <q-item clickable v-close-popup to="/coach">
                <q-item-section>
                  <q-item-label class="identity-item-label">COACH DASHBOARD</q-item-label>
                </q-item-section>
              </q-item>
            </template>
            <template v-else-if="isCoach">
              <q-item clickable v-close-popup to="/coach">
                <q-item-section>
                  <q-item-label class="identity-item-label">SQUADRON DASHBOARD</q-item-label>
                </q-item-section>
              </q-item>
              <q-item clickable v-close-popup to="/profile">
                <q-item-section>
                  <q-item-label class="identity-item-label">PILOT PROFILE</q-item-label>
                </q-item-section>
              </q-item>
            </template>
            <template v-else>
              <q-item clickable v-close-popup to="/dashboard">
                <q-item-section>
                  <q-item-label class="identity-item-label">DASHBOARD</q-item-label>
                </q-item-section>
              </q-item>
              <q-item clickable v-close-popup to="/profile">
                <q-item-section>
                  <q-item-label class="identity-item-label">PILOT PROFILE</q-item-label>
                </q-item-section>
              </q-item>
            </template>

            <q-separator dark />

            <q-item clickable v-close-popup @click="handleLogout">
              <q-item-section avatar>
                <q-icon name="logout" color="negative" />
              </q-item-section>
              <q-item-section>
                <q-item-label class="identity-item-danger">
                  TERMINATE SESSION
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- Physiology deep dive for admin: open from MASTER LIJST row click -->
    <CoachDeepDive v-if="isAdmin" />
  </q-layout>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import CoachDeepDive from '../components/CoachDeepDive.vue'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const isAdmin = computed(() => authStore.isAdmin)
const isCoach = computed(() => authStore.isCoach)
const isImpersonating = computed(() => authStore.isImpersonating)
const impersonatedName = computed(
  () => authStore.impersonatingUser?.name || 'Onbekende atleet'
)
const userEmail = computed(() => {
  const email = authStore.user?.email || ''
  if (!email) return ''
  return email.length > 24 ? `${email.slice(0, 21)}…` : email
})
const userRole = computed(() => (authStore.role || 'user').toUpperCase())

const profileIcon = computed(() =>
  isAdmin.value ? 'admin_panel_settings' : isCoach.value ? 'engineering' : 'person',
)
const profileTooltip = computed(() =>
  isAdmin.value ? 'Team Admin' : isCoach.value ? 'Squadron' : 'Mijn Profiel',
)
const profileAriaLabel = computed(() =>
  isAdmin.value ? 'Team Admin' : isCoach.value ? 'Squadron Dashboard' : 'User Profile',
)

const handleLogout = async () => {
  await authStore.logoutUser()
  router.push('/login')
}

const handleStopImpersonation = () => {
  authStore.stopImpersonation?.()
  router.push('/admin')
}
</script>

<style scoped lang="scss">
@use '../css/quasar.variables' as q;

.premium-header {
  background: rgba(5, 5, 5, 0.9) !important;
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.shadow-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 16px;
  position: relative;
  z-index: 9999;
  background: #fbbf24;
  color: #111827;
  font-family: q.$mono-font;
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.shadow-text {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: baseline;
}

.shadow-name {
  font-weight: 700;
}

.shadow-stop-btn {
  font-family: q.$mono-font;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
}

.premium-title-link {
  text-decoration: none;
}

.premium-title {
  text-align: center;
  font-family: q.$head-font;
  font-weight: 900;
  font-style: italic;
  color: q.$prime-gold;
  letter-spacing: 3px;
  font-size: 1.5rem;
}

.header-profile-btn {
  color: q.$prime-gray;
}

.header-profile-btn:hover {
  color: q.$prime-gold;
}

.identity-dropdown :deep(.q-btn__content) {
  font-family: q.$typography-font-family;
}

.identity-label {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.identity-role {
  font-family: q.$typography-font-family;
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: q.$prime-gold;
}

.identity-email {
  margin-top: 2px;
  font-family: q.$mono-font;
  font-size: 0.7rem;
  color: q.$prime-gray;
}

.identity-menu {
  background: #111 !important;
  min-width: 220px;
}

.identity-item-label {
  font-family: q.$mono-font;
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.identity-item-danger {
  font-family: q.$mono-font;
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #ef4444;
}
</style>
