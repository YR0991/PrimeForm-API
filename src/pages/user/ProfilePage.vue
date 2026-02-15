<template>
  <q-page class="profile-page">
    <div class="profile-inner">
      <div class="profile-header-row">
        <q-btn
          icon="arrow_back"
          flat
          round
          dense
          class="profile-back-btn"
          aria-label="Back"
          :to="'/dashboard'"
        />
        <h1 class="profile-title">
          {{ isAthlete ? 'ATLEET PROFIEL' : 'ACCOUNT & SETTINGS' }}
        </h1>
      </div>

      <!-- ATHLETE VIEW -->
      <template v-if="isAthlete">
        <!-- Section 1: Biological Calibration -->
        <section class="profile-section">
        <h2 class="section-title">BIOLOGICAL CALIBRATION</h2>
        <q-card class="elite-card" flat>
          <q-card-section>
            <div class="field-row">
              <label class="field-label">Last Period Date</label>
              <q-date
                v-model="localLastPeriod"
                minimal
                dark
                mask="YYYY-MM-DD"
                class="elite-date"
                :options="optionsPastOnly"
              />
            </div>
            <div class="field-row q-mt-md">
              <label class="field-label">Anticonceptie</label>
              <q-select
                v-model="localContraception"
                :options="contraceptionOptions"
                outlined
                dark
                dense
                class="elite-input"
              />
            </div>
            <div class="field-row q-mt-md">
              <label class="field-label">Cycle Length (days)</label>
              <div class="slider-row">
                <span class="mono-value">{{ localCycleLength }}</span>
                <q-slider
                  v-model="localCycleLength"
                  :min="21"
                  :max="35"
                  :step="1"
                  dark
                  color="#fbbf24"
                  class="elite-slider"
                />
              </div>
            </div>
            <div class="field-row q-mt-md">
              <label class="field-label">Baseline Rusthartslag (RHR)</label>
              <q-input
                v-model.number="localRhrBaseline"
                type="number"
                outlined
                dark
                dense
                placeholder="bijv. 55"
                class="elite-input"
                :min="40"
                :max="100"
              />
            </div>
            <div class="field-row q-mt-md">
              <label class="field-label">Baseline HRV</label>
              <q-input
                v-model.number="localHrvBaseline"
                type="number"
                outlined
                dark
                dense
                placeholder="bijv. 50"
                class="elite-input"
                :min="20"
                :max="120"
              />
            </div>
          </q-card-section>
          <q-card-actions>
            <q-btn
              label="UPDATE CALIBRATION"
              unelevated
              no-caps
              class="btn-gold"
              :loading="authStore.loading"
              @click="updateCalibration"
            />
          </q-card-actions>
        </q-card>
        </section>

        <!-- Section 2: Connections -->
        <section class="profile-section">
        <h2 class="section-title">CONNECTIONS</h2>
        <q-card class="elite-card" flat>
          <q-card-section>
            <div class="connections-row">
              <span class="status-label">Strava</span>
              <span
                v-if="authStore.stravaConnected"
                class="connection-chip connection-chip-active"
              >
                Strava Active
              </span>
              <q-btn
                v-else
                unelevated
                no-caps
                class="btn-orange"
                label="Connect Strava"
                @click="connectStrava"
              />
            </div>
            <q-btn
              v-if="authStore.stravaConnected"
              flat
              no-caps
              class="btn-disconnect-link"
              :loading="authStore.loading"
              @click="disconnectStrava"
            >
              Disconnect Strava
            </q-btn>
            <div v-if="showCompleteOnboarding" class="q-mt-md">
              <q-btn
                unelevated
                no-caps
                class="btn-gold"
                label="Complete Onboarding"
                :loading="authStore.loading"
                @click="completeOnboarding"
              />
              <div class="text-caption text-grey q-mt-xs">
                Klik als je net Strava hebt gekoppeld en weer naar het dashboard wilt.
              </div>
            </div>
          </q-card-section>
        </q-card>
        </section>

        <!-- Section 3: System -->
        <section class="profile-section">
        <h2 class="section-title">SYSTEM</h2>
        <q-card class="elite-card" flat>
          <q-card-actions>
            <q-btn
              label="LOGOUT"
              flat
              no-caps
              class="btn-logout"
              @click="handleLogout"
            />
          </q-card-actions>
        </q-card>
        </section>
      </template>

      <!-- COACH / ADMIN SETTINGS VIEW -->
      <template v-else>
        <!-- Identiteit -->
        <section class="profile-section">
          <h2 class="section-title">IDENTITEIT</h2>
          <q-card class="elite-card" flat>
            <q-card-section>
              <div class="settings-field">
                <label class="field-label">Voornaam</label>
                <q-input
                  v-model="settingsFirstName"
                  outlined
                  dark
                  dense
                  class="settings-input"
                />
              </div>
              <div class="settings-field">
                <label class="field-label">Achternaam</label>
                <q-input
                  v-model="settingsLastName"
                  outlined
                  dark
                  dense
                  class="settings-input"
                />
              </div>
              <div class="settings-field">
                <label class="field-label">E-mailadres</label>
                <q-input
                  v-model="settingsEmail"
                  outlined
                  dark
                  dense
                  readonly
                  class="settings-input settings-input-readonly"
                />
              </div>
            </q-card-section>
            <q-card-actions align="between">
              <q-btn
                flat
                no-caps
                class="btn-secondary"
                label="Wachtwoord wijzigen"
                :loading="authStore.loading"
                @click="handlePasswordReset"
              />
              <q-btn
                unelevated
                no-caps
                class="btn-gold"
                label="Opslaan"
                :loading="authStore.loading"
                @click="saveSettings"
              />
            </q-card-actions>
          </q-card>
        </section>

        <!-- Weergave -->
        <section class="profile-section">
          <h2 class="section-title">WEERGAVE</h2>
          <q-card class="elite-card" flat>
            <q-card-section>
              <q-toggle
                v-model="prefCompactTables"
                color="amber-5"
                keep-color
                label="Compacte tabellen"
              />
              <q-toggle
                v-model="prefShowGhosts"
                color="amber-5"
                keep-color
                label="Toon 'Ghosts' in overzichten"
                class="q-mt-sm"
              />
            </q-card-section>
          </q-card>
        </section>

        <!-- Notificaties -->
        <section class="profile-section">
          <h2 class="section-title">NOTIFICATIES</h2>
          <q-card class="elite-card" flat>
            <q-card-section>
              <q-toggle
                v-model="prefWarnHighAcwr"
                color="amber-5"
                keep-color
                label="Waarschuwing bij hoog risico (ACWR > 1.3)"
              />
              <q-toggle
                v-model="prefDailyBriefing"
                color="amber-5"
                keep-color
                label="Dagelijkse briefing per mail"
                class="q-mt-sm"
              />
            </q-card-section>
          </q-card>
        </section>

        <!-- Overig -->
        <section class="profile-section">
          <h2 class="section-title">OVERIG</h2>
          <q-card class="elite-card" flat>
            <q-card-section>
              <div class="settings-meta-row">
                <span class="field-label">App Versie</span>
                <span class="mono-value">v1.0.4 Beta</span>
              </div>
            </q-card-section>
            <q-card-actions>
              <q-btn
                label="Uitloggen"
                flat
                no-caps
                class="btn-logout"
                @click="handleLogout"
              />
            </q-card-actions>
          </q-card>
        </section>
      </template>
    </div>
  </q-page>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useAuthStore } from '../../stores/auth'
import { startStravaConnect } from '../../services/stravaConnect.js'

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const authStore = useAuthStore()

const isAthlete = computed(() => !authStore.isCoach && !authStore.isAdmin)

const contraceptionOptions = [
  'Geen',
  'Hormonaal (pil/pleister/ring/implantaat/injectie)',
  'Spiraal (koper)',
  'Spiraal (hormonaal)',
  'Anders / Onbekend'
]

// Athlete calibration state (from authStore.profile; no localStorage)
const localLastPeriod = ref('')
const localContraception = ref('Geen')
const localCycleLength = ref(28)
const localRhrBaseline = ref(null)
const localHrvBaseline = ref(null)

const showCompleteOnboarding = computed(
  () =>
    authStore.stravaConnected &&
    !authStore.isOnboardingComplete &&
    !!authStore.user
)

// Coach/Admin settings state
const settingsFirstName = ref('')
const settingsLastName = ref('')
const settingsEmail = ref('')
const prefCompactTables = ref(false)
const prefShowGhosts = ref(false)
const prefWarnHighAcwr = ref(false)
const prefDailyBriefing = ref(false)

function optionsPastOnly(date) {
  const todayIso = new Date().toISOString().split('T')[0]
  const normalized = (date || '').toString().replace(/\//g, '-')
  return normalized <= todayIso
}

watch(
  () => authStore.profile,
  (p) => {
    if (p?.lastPeriodDate) localLastPeriod.value = p.lastPeriodDate
    if (p?.contraception != null) localContraception.value = p.contraception
    if (p?.cycleLength != null) localCycleLength.value = Number(p.cycleLength)
    if (p?.rhrBaseline != null) localRhrBaseline.value = Number(p.rhrBaseline)
    if (p?.hrvBaseline != null) localHrvBaseline.value = Number(p.hrvBaseline)
  },
  { immediate: true }
)

onMounted(() => {
  const p = authStore.profile
  if (p?.lastPeriodDate) localLastPeriod.value = p.lastPeriodDate
  if (p?.contraception != null) localContraception.value = p.contraception
  if (p?.cycleLength != null) localCycleLength.value = Number(p.cycleLength)
  if (p?.rhrBaseline != null) localRhrBaseline.value = Number(p.rhrBaseline)
  if (p?.hrvBaseline != null) localHrvBaseline.value = Number(p.hrvBaseline)

  // Coach/Admin settings defaults
  const prefs = authStore.preferences || {}
  settingsFirstName.value = p?.firstName || ''
  settingsLastName.value = p?.lastName || ''
  settingsEmail.value = authStore.user?.email || ''
  prefCompactTables.value = !!prefs.compactMode
  prefShowGhosts.value = !!prefs.showGhosts
  prefWarnHighAcwr.value = !!prefs.warnHighAcwr
  prefDailyBriefing.value = !!prefs.dailyBriefing

  const status = route.query?.status
  if (status === 'strava_connected') {
    $q.notify({
      type: 'positive',
      color: 'amber-5',
      message: 'Strava gekoppeld. Telemetrie succesvol verbonden.',
    })

    const q = { ...route.query }
    delete q.status
    router.replace({ path: route.path, query: q })
  }
})

async function completeOnboarding() {
  try {
    await authStore.completeOnboarding()
    $q.notify({
      type: 'positive',
      message: 'Onboarding voltooid. Je kunt nu naar het dashboard.',
    })
    router.replace('/dashboard')
  } catch (err) {
    console.error('completeOnboarding failed', err)
    $q.notify({
      type: 'negative',
      message: err?.message || 'Voltooien mislukt.',
    })
  }
}

async function updateCalibration() {
  try {
    await authStore.updateAtleetProfile({
      lastPeriodDate: localLastPeriod.value || null,
      contraception: localContraception.value ?? 'Geen',
      cycleLength: localCycleLength.value,
      rhrBaseline: localRhrBaseline.value != null && Number.isFinite(Number(localRhrBaseline.value)) ? Number(localRhrBaseline.value) : null,
      hrvBaseline: localHrvBaseline.value != null && Number.isFinite(Number(localHrvBaseline.value)) ? Number(localHrvBaseline.value) : null,
    })
  } catch (err) {
    // Fallback logging; primary Notify is in the store
    console.error('updateAtleetProfile failed in ProfilePage', err)
  }
}

async function connectStrava() {
  if (!authStore.user?.uid) {
    $q.notify({ type: 'negative', message: 'Niet ingelogd. Log in om Strava te koppelen.' })
    return
  }
  try {
    await startStravaConnect()
  } catch (err) {
    $q.notify({ type: 'negative', message: err?.message || 'Strava koppelen mislukt.' })
  }
}

async function disconnectStrava() {
  try {
    await authStore.disconnectStrava()
  } catch (err) {
    // Fallback logging; primary Notify is in the store
    console.error('disconnectStrava failed in ProfilePage', err)
  }
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}

async function handlePasswordReset() {
  await authStore.sendPasswordReset()
}

async function saveSettings() {
  try {
    await authStore.updateSelfProfileSettings({
      firstName: settingsFirstName.value,
      lastName: settingsLastName.value,
      preferences: {
        compactMode: prefCompactTables.value,
        showGhosts: prefShowGhosts.value,
        warnHighAcwr: prefWarnHighAcwr.value,
        dailyBriefing: prefDailyBriefing.value,
      },
    })
  } catch (err) {
    console.error('saveSettings failed', err)
  }
}
</script>

<style scoped lang="scss">
.profile-page {
  background: #050505;
  min-height: 100vh;
}

.profile-inner {
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 16px;
}

.profile-header-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.profile-back-btn {
  color: #9ca3af;
  flex-shrink: 0;
}

.profile-back-btn:hover {
  color: #fbbf24;
}

.profile-title {
  font-family: 'Inter', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #fbbf24;
  margin: 0;
}

.section-title {
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #9ca3af;
  margin: 0 0 12px 0;
}

.profile-section {
  margin-bottom: 24px;
}

.elite-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  box-shadow: none !important;
}

.elite-card :deep(.q-card__section) {
  padding: 16px;
}

.elite-card :deep(.q-card__actions) {
  padding: 0 16px 16px;
}

.field-label,
.status-label {
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9ca3af;
  display: block;
  margin-bottom: 8px;
}

.mono-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  color: #fbbf24;
  min-width: 2ch;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.elite-slider {
  flex: 1;
}

.elite-date :deep(.q-date__view) {
  background: transparent;
}

.elite-date :deep(.q-date__calendar-item) {
  color: rgba(255, 255, 255, 0.9);
}

.status-row,
.connections-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.connection-chip {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 2px;
  border: 1px solid;
}

.connection-chip-active {
  color: #22c55e;
  border-color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
}

.btn-disconnect-link {
  margin-top: 8px;
  font-size: 0.75rem;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.btn-disconnect-link:hover {
  color: #ef4444;
}

.status-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 8px;
  border: 1px solid;
  border-radius: 2px;
}

.status-active {
  color: #22c55e;
  border-color: #22c55e;
}

.status-disconnected {
  color: #9ca3af;
  border-color: rgba(255, 255, 255, 0.08);
}

.btn-gold {
  background: #fbbf24 !important;
  color: #050505 !important;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 2px;
}

.btn-red-outline {
  border: 1px solid #ef4444;
  color: #ef4444;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 2px;
}

.btn-orange {
  background: #ea580c !important;
  color: #fff !important;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 2px;
}

.btn-logout {
  color: #9ca3af;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.btn-logout:hover {
  color: #ffffff;
}
</style>
