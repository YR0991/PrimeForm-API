<template>
  <q-page class="settings-page">
    <div class="settings-container">
      <h1 class="page-title">Profiel</h1>

      <!-- Integraties -->
      <q-card class="settings-card integraties-card" flat dark>
        <q-card-section>
          <div class="settings-label">Integraties</div>
          <div v-if="stravaConnected" class="integratie-row row items-center">
            <q-badge color="positive" class="q-mr-sm">
              Verbonden met Strava{{ stravaAthleteName ? ` als ${stravaAthleteName}` : '' }} ✅
            </q-badge>
            <q-btn
              flat
              dense
              no-caps
              color="grey"
              label="Ontkoppel"
              @click="disconnectStrava"
              :loading="disconnecting"
            />
          </div>
          <div v-else class="integratie-row">
            <q-btn
              unelevated
              no-caps
              color="orange-7"
              label="Verbind met Strava"
              icon="directions_run"
              @click="connectStrava"
            />
          </div>
        </q-card-section>
      </q-card>

      <q-card class="settings-card" flat dark>
        <q-card-section>
          <div class="settings-label">Baseline RHR</div>
          <q-input
            v-model.number="rhrBaseline"
            type="number"
            outlined
            dark
            label="Gemiddelde rusthartslag"
            class="q-mb-md"
          />
          <div class="settings-label">Baseline HRV</div>
          <q-input
            v-model.number="hrvBaseline"
            type="number"
            outlined
            dark
            label="Gemiddelde HRV"
            class="q-mb-md"
          />
          <div class="settings-label">Laatste menstruatie</div>
          <q-input
            v-model="lastPeriodDate"
            type="date"
            outlined
            dark
            label="Eerste dag laatste bloeding"
            class="q-mb-md"
          />
          <div class="settings-label">Gemiddelde cyclusduur (dagen)</div>
          <q-input
            v-model.number="cycleLength"
            type="number"
            outlined
            dark
            label="Aantal dagen"
            min="21"
            max="35"
            class="q-mb-md"
          />
        </q-card-section>
        <q-card-actions>
          <q-btn label="Opslaan" color="primary" :loading="saving" unelevated @click="saveSettings" />
        </q-card-actions>
      </q-card>

      <q-btn flat label="Intake opnieuw doorlopen" class="q-mt-md" to="/intake" />
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { Notify } from 'quasar'
import { API_URL } from '../config/api.js'

const getOrCreateUserId = () => {
  const key = 'primeform_user_id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const newId = `pf_${Date.now()}`
  localStorage.setItem(key, newId)
  return newId
}

const route = useRoute()
const userId = ref('')
const userData = ref(null)
const rhrBaseline = ref(60)
const hrvBaseline = ref(50)
const lastPeriodDate = ref('')
const cycleLength = ref(28)
const saving = ref(false)
const disconnecting = ref(false)

const stravaConnected = computed(() => {
  const s = userData.value?.strava
  return s && s.connected === true
})
const stravaAthleteName = computed(() => userData.value?.strava?.athleteName || '')

async function loadProfile() {
  try {
    const resp = await axios.get(`${API_URL}/api/profile`, { params: { userId: userId.value } })
    const data = resp.data?.data
    userData.value = data || null
    const profile = data?.profile
    if (profile) {
      if (profile.rhrBaseline != null) rhrBaseline.value = Number(profile.rhrBaseline)
      if (profile.hrvBaseline != null) hrvBaseline.value = Number(profile.hrvBaseline)
      if (profile?.cycleData?.lastPeriod) lastPeriodDate.value = profile.cycleData.lastPeriod
      if (profile?.cycleData?.avgDuration) cycleLength.value = Number(profile.cycleData.avgDuration)
    }
  } catch (e) {
    console.error('Profile load failed:', e)
  }
}

function connectStrava() {
  window.location.href = `${API_URL}/auth/strava/connect?userId=${encodeURIComponent(userId.value)}`
}

async function disconnectStrava() {
  disconnecting.value = true
  try {
    await axios.put(`${API_URL}/api/strava/disconnect`, { userId: userId.value })
    Notify.create({ type: 'positive', message: 'Strava ontkoppeld' })
    await loadProfile()
  } catch (e) {
    console.error('Disconnect failed:', e)
    Notify.create({ type: 'negative', message: 'Ontkoppelen mislukt' })
  } finally {
    disconnecting.value = false
  }
}

async function saveSettings() {
  saving.value = true
  try {
    localStorage.setItem('rhrBaseline', String(rhrBaseline.value))
    localStorage.setItem('hrvBaseline', String(hrvBaseline.value))
    localStorage.setItem('cycleLength', String(cycleLength.value))
    await axios.put(`${API_URL}/api/profile`, {
      userId: userId.value,
      profilePatch: {
        rhrBaseline: rhrBaseline.value,
        hrvBaseline: hrvBaseline.value,
        cycleData: {
          lastPeriod: lastPeriodDate.value || undefined,
          avgDuration: cycleLength.value,
        },
      },
    })
  } catch (e) {
    console.error('Profile save failed:', e)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  userId.value = getOrCreateUserId()
  loadProfile()

  const status = route.query?.status
  if (status === 'success') {
    Notify.create({ type: 'positive', message: 'Strava gekoppeld!' })
    loadProfile()
    const q = { ...route.query }
    delete q.status
    const search = new URLSearchParams(q).toString()
    const url = search ? `${route.path}?${search}` : route.path
    window.history.replaceState({}, '', url)
  } else if (status === 'strava_denied') {
    Notify.create({ type: 'info', message: 'Strava autorisatie geannuleerd' })
    window.history.replaceState({}, '', route.path)
  } else if (status === 'strava_error') {
    const msg = route.query?.message || 'Strava koppelen mislukt'
    Notify.create({ type: 'negative', message: decodeURIComponent(msg) })
    window.history.replaceState({}, '', route.path)
  }
})
</script>

<style scoped>
.settings-page {
  background: #000000;
  min-height: 100vh;
  padding: 24px 16px;
  padding-bottom: 80px;
}

.settings-container {
  max-width: 500px;
  margin: 0 auto;
}

.page-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  color: #D4AF37;
  font-size: 1.75rem;
  margin: 0 0 24px 0;
  letter-spacing: 2px;
}

.settings-card {
  background: rgba(18, 18, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.settings-label {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.875rem;
  margin-bottom: 4px;
}

.integraties-card {
  margin-bottom: 16px;
}
.integratie-row {
  margin-top: 8px;
}
</style>
