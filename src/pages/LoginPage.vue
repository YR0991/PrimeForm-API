<template>
  <q-page class="login-page">
    <div class="login-container">
      <!-- Strava return: show spinner until auth ready or 5s timeout -->
      <q-card v-if="showStravaPending" class="login-card strava-pending-card">
        <div class="strava-pending-content">
          <q-spinner color="#fbbf24" size="48px" />
          <div class="strava-pending-text">Strava koppeling verwerken...</div>
        </div>
      </q-card>

      <q-card v-else class="login-card">
        <div class="login-header">
          <div class="logo-text">PRIMEFORM // SYSTEM ACCESS</div>
        </div>

        <q-tabs
          v-model="activeTab"
          dense
          align="justify"
          class="login-tabs"
          active-color="#fbbf24"
          indicator-color="#fbbf24"
          narrow-indicator
        >
          <q-tab name="google" label="INSTANT" icon="vpn_key" no-caps />
          <q-tab name="email" label="MANUAL" icon="mail" no-caps />
        </q-tabs>

        <q-tab-panels v-model="activeTab" animated class="login-panels">
          <!-- Instant / Google -->
          <q-tab-panel name="google">
            <div class="status-line">
              <span class="status-label">AWAITING IDENTITY VERIFICATION</span>
              <span class="status-cursor"></span>
            </div>

            <div class="action-area">
              <q-btn
                class="login-button"
                :loading="isLoading"
                no-caps
                unelevated
                @click="handleGoogleLogin"
              >
                <template #loading>
                  <q-spinner size="20px" color="primary" />
                </template>
                <q-icon name="vpn_key" class="login-button-icon" />
                <span class="login-button-label">
                  INITIATE SESSION [GOOGLE]
                </span>
              </q-btn>
            </div>
          </q-tab-panel>

          <!-- Manual / Email -->
          <q-tab-panel name="email">
            <div class="manual-form">
              <q-input
                v-model="email"
                type="email"
                label="Email"
                outlined
                dark
                class="manual-input"
              />
              <q-input
                v-model="password"
                type="password"
                label="Password"
                outlined
                dark
                class="manual-input"
              />
              <q-input
                v-if="isRegistering"
                v-model="fullName"
                type="text"
                label="Full Name"
                outlined
                dark
                class="manual-input"
              />

              <div class="register-toggle" @click="toggleRegistering">
                <span v-if="!isRegistering">NO ID? REGISTER NEW PROFILE</span>
                <span v-else>ALREADY HAVE ACCESS? SIGN IN</span>
              </div>

              <div v-if="authError" class="auth-error">
                {{ authError }}
              </div>

              <div class="action-area q-mt-md">
                <q-btn
                  class="login-button"
                  :loading="isLoading"
                  no-caps
                  unelevated
                  @click="handleEmailSubmit"
                >
                  <template #loading>
                    <q-spinner size="20px" color="primary" />
                  </template>
                  <q-icon
                    :name="isRegistering ? 'person_add' : 'login'"
                    class="login-button-icon"
                  />
                  <span class="login-button-label">
                    {{ isRegistering ? 'CREATE IDENTITY' : 'AUTHENTICATE' }}
                  </span>
                </q-btn>
              </div>
            </div>
          </q-tab-panel>
        </q-tab-panels>
      </q-card>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

// Trigger session recovery as soon as Login page is created
authStore.init()

const isLoading = computed(() => authStore.loading)
const authError = computed(() => authStore.error)
const activeTab = ref('google')
const isRegistering = ref(false)
const email = ref('')
const password = ref('')
const fullName = ref('')

const stravaFallbackToForm = ref(false)
const stravaTimeoutId = ref(null)

const isStravaReturn = computed(() => {
  if (route.query?.status === 'strava_connected') return true
  const redirect = route.query?.redirect
  return typeof redirect === 'string' && redirect.includes('strava_connected')
})
const showStravaPending = computed(
  () => isStravaReturn.value && !stravaFallbackToForm.value,
)

const handleGoogleLogin = async () => {
  if (authStore.loading) return
  await authStore.loginWithGoogle()
  if (authStore.isAuthenticated) {
    router.push(authStore.isAdmin ? '/admin' : '/dashboard')
  }
}

const handleEmailSubmit = async () => {
  if (authStore.loading) return
  if (!email.value || !password.value) {
    return
  }

  if (isRegistering.value) {
    await authStore.registerWithEmail(email.value, password.value, fullName.value)
  } else {
    await authStore.loginWithEmail(email.value, password.value)
  }

  if (authStore.isAuthenticated && !authStore.error) {
    router.push(authStore.isAdmin ? '/admin' : '/dashboard')
  }
}

const toggleRegistering = () => {
  isRegistering.value = !isRegistering.value
}

onMounted(() => {
  if (isStravaReturn.value) {
    stravaTimeoutId.value = window.setTimeout(() => {
      stravaFallbackToForm.value = true
    }, 5000)
  }
})

onUnmounted(() => {
  if (stravaTimeoutId.value) {
    clearTimeout(stravaTimeoutId.value)
  }
})

watch(
  () => authStore.isAuthenticated,
  (val) => {
    if (!val) return
    if (isStravaReturn.value) {
      router.replace('/intake')
      return
    }
    router.replace(authStore.isAdmin ? '/admin' : '/dashboard')
  },
  { immediate: true },
)
</script>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #050505;
}

.login-container {
  width: 100%;
  max-width: 480px;
  padding: 1.5rem;
}

.login-card {
  background: #050505;
  border: 1px solid #fbbf24;
  border-radius: 2px;
  box-shadow: none;
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  color: #f9fafb;
}

.login-card :deep(.q-card),
.login-card :deep(.q-tab-panel),
.login-card :deep(.q-panel) {
  background: #050505 !important;
}

.login-page :deep(.q-page),
.login-page :deep(.q-layout),
.login-page :deep(.q-page-container) {
  background: #050505 !important;
}

.login-header {
  text-align: center;
}

.logo-text {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 0.85rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #fbbf24;
}

.login-tabs {
  margin-top: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.login-tabs :deep(.q-tab) {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.65);
}

.login-tabs :deep(.q-tab--active) {
  color: #fbbf24;
}

.login-tabs :deep(.q-tabs__content) {
  background: transparent;
}

.login-panels {
  margin-top: 1.5rem;
}

.status-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.75rem;
  color: #22c55e;
  text-transform: uppercase;
}

.status-cursor {
  width: 8px;
  height: 1rem;
  background: #22c55e;
  animation: blink-cursor 1s steps(2, start) infinite;
}

@keyframes blink-cursor {
  0%,
  50% {
    opacity: 1;
  }
  50.01%,
  100% {
    opacity: 0;
  }
}

.action-area {
  display: flex;
  justify-content: center;
}

.login-button {
  width: 100%;
  max-width: 320px;
  height: 3.25rem;
  border-radius: 2px;
  border: 1px solid #fbbf24;
  background: transparent;
  color: #fbbf24;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  transition: background-color 0.15s ease, color 0.15s ease,
    border-color 0.15s ease, transform 0.05s ease;
}

.login-button:hover:not(.q-btn--disabled) {
  background: #fbbf24;
  color: #050505;
  border-color: #fbbf24;
  transform: translateY(-1px);
}

.login-button:active:not(.q-btn--disabled) {
  transform: translateY(0);
}

.login-button-icon {
  font-size: 1.1rem;
}

.login-button-label {
  white-space: nowrap;
}

.manual-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.manual-input {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.manual-input :deep(.q-field__control) {
  background: rgba(15, 15, 15, 0.9);
  border-radius: 2px;
}

.manual-input :deep(.q-field__label) {
  color: rgba(255, 255, 255, 0.7);
}

.manual-input :deep(.q-field__native) {
  color: #ffffff;
}

.manual-input :deep(.q-field__inner) {
  color: #ffffff;
}

.manual-input :deep(.q-field__control--focused) {
  border-color: #fbbf24;
}

.register-toggle {
  margin-top: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  text-align: center;
}

.register-toggle:hover {
  color: #fbbf24;
}

.auth-error {
  margin-top: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.72rem;
  color: #ef4444;
  text-align: center;
}

.strava-pending-card {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.strava-pending-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
}

.strava-pending-text {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
</style>

