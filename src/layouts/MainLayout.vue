<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="premium-header" elevated="false">
      <q-toolbar>
        <router-link to="/dashboard" class="premium-title-link">
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
          icon="person"
          to="/profile"
          class="header-profile-btn"
          aria-label="User Profile"
        />

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
            <q-item clickable v-close-popup to="/dashboard">
              <q-item-section>
                <q-item-label class="identity-item-label">DASHBOARD</q-item-label>
              </q-item-section>
            </q-item>

            <q-item
              v-if="isAdmin"
              clickable
              v-close-popup
              to="/admin"
            >
              <q-item-section>
                <q-item-label class="identity-item-label">TEAM ADMIN</q-item-label>
              </q-item-section>
            </q-item>

            <q-item clickable v-close-popup to="/settings">
              <q-item-section>
                <q-item-label class="identity-item-label">SETTINGS</q-item-label>
              </q-item-section>
            </q-item>

            <q-item clickable v-close-popup to="/profile">
              <q-item-section>
                <q-item-label class="identity-item-label">PILOT PROFILE</q-item-label>
              </q-item-section>
            </q-item>

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
  </q-layout>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const isAdmin = computed(() => authStore.isAdmin)
const userEmail = computed(() => {
  const email = authStore.user?.email || ''
  if (!email) return ''
  return email.length > 24 ? `${email.slice(0, 21)}…` : email
})
const userRole = computed(() => (authStore.role || 'user').toUpperCase())

const handleLogout = async () => {
  await authStore.logoutUser()
  router.push('/login')
}
</script>

<style scoped lang="scss">
@use '../css/quasar.variables' as q;

.premium-header {
  background: rgba(5, 5, 5, 0.9) !important;
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
