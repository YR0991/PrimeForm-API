<template>
  <q-page class="insights-page">
    <div class="insights-container">
      <h1 class="page-title">Inzichten</h1>

      <!-- Cyclus Kalender -->
      <section class="section">
        <div class="card-label q-mb-sm">Cyclus kalender</div>
        <CycleCalendar
          v-if="lastPeriodDate && cycleLength"
          :last-period-date="lastPeriodDate"
          :cycle-length="cycleLength"
        />
        <div v-else class="empty-state">
          Vul je cyclusgegevens in op de Profiel-pagina of bij de Cyclus Tracker op Vandaag.
        </div>
      </section>

      <!-- Trends grafiek -->
      <section class="section">
        <div class="card-label q-mb-sm">Trends • HRV (laatste 28 metingen)</div>
        <div v-if="historyLoading" class="trend-loading">Data laden...</div>
        <div v-else-if="trendsSeries[0].data.length === 0" class="empty-state">
          Nog geen trenddata. Doe dagelijkse check-ins op Vandaag.
        </div>
        <div v-else class="apex-wrap">
          <VueApexCharts
            type="area"
            height="280"
            :options="trendsChartOptions"
            :series="trendsSeries"
          />
        </div>
      </section>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import { api } from '../services/httpClient.js'
import { API_URL } from '../config/api.js'
import CycleCalendar from '../components/CycleCalendar.vue'

const getOrCreateUserId = () => {
  const key = 'primeform_user_id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const newId = `pf_${Date.now()}`
  localStorage.setItem(key, newId)
  return newId
}

const userId = ref('')
const profile = ref(null)
const historyLogs = ref([])
const historyLoading = ref(false)

const lastPeriodDate = computed(() => {
  return profile.value?.cycleData?.lastPeriod || ''
})

const cycleLength = computed(() => {
  const n = Number(profile.value?.cycleData?.avgDuration)
  return Number.isFinite(n) && n >= 21 ? n : 28
})

const toMillis = (ts) => {
  if (!ts) return 0
  const d = new Date(ts)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

const trendsSeries = computed(() => {
  const logs = Array.isArray(historyLogs.value) ? historyLogs.value : []
  const sorted = [...logs].sort((a, b) => toMillis(a.timestamp || a.date) - toMillis(b.timestamp || b.date))
  const data = sorted
    .map((l) => {
      const hrvVal = Number(l.hrv) || Number(l.metrics?.hrv) || Number(l.metrics?.hrv?.current) || Number(l.metrics?.hrv?.value)
      return { x: toMillis(l.timestamp || l.date), y: hrvVal }
    })
    .filter((p) => Number.isFinite(p.y) && p.y > 0)
  return [{ name: 'HRV', data }]
})

const trendsChartOptions = computed(() => ({
  chart: {
    type: 'area',
    background: 'transparent',
    toolbar: { show: false },
    zoom: { enabled: false },
    foreColor: 'rgba(255,255,255,0.75)',
  },
  theme: { mode: 'dark' },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 3, colors: ['#D4AF37'] },
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 0.6, opacityFrom: 0.35, opacityTo: 0.04, stops: [0, 70, 100] },
    colors: ['#D4AF37'],
  },
  grid: { borderColor: 'rgba(255,255,255,0.08)', strokeDashArray: 4, padding: { left: 8, right: 8, top: 8, bottom: 8 } },
  xaxis: {
    type: 'datetime',
    labels: { style: { colors: 'rgba(255,255,255,0.55)' }, datetimeUTC: false },
    axisBorder: { color: 'rgba(255,255,255,0.08)' },
    axisTicks: { color: 'rgba(255,255,255,0.08)' },
  },
  yaxis: { labels: { style: { colors: 'rgba(255,255,255,0.55)' } } },
  tooltip: { theme: 'dark', x: { format: 'dd MMM' } },
  markers: { size: 0, hover: { size: 4 } },
}))

async function loadProfile() {
  try {
    const resp = await api.get('/api/profile', { params: { userId: userId.value } })
    profile.value = resp.data?.data?.profile || null
  } catch (e) {
    console.error('Profile load failed:', e)
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const resp = await api.get('/api/history', { params: { userId: userId.value } })
    historyLogs.value = resp.data?.data || []
  } catch (e) {
    console.error('History load failed:', e)
    historyLogs.value = []
  } finally {
    historyLoading.value = false
  }
}

onMounted(() => {
  userId.value = getOrCreateUserId()
  loadProfile()
  loadHistory()
})
</script>

<style scoped>
.insights-page {
  background: #000000;
  min-height: 100vh;
  padding: 24px 16px;
  padding-bottom: 80px;
}

.insights-container {
  max-width: 500px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  color: #D4AF37;
  font-size: 1.75rem;
  margin: 0 0 8px 0;
  letter-spacing: 2px;
}

.section {
  background: rgba(18, 18, 18, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 16px;
}

.card-label {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
}

.empty-state {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  padding: 24px 16px;
  font-size: 0.9rem;
}

.trend-loading {
  color: rgba(255, 255, 255, 0.6);
  text-align: center;
  padding: 24px;
}

.apex-wrap {
  min-height: 280px;
}
</style>
