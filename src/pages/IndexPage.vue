<template>
  <q-page class="dashboard-page">
    <div class="dashboard-container">
      
      <!-- Header -->
      <div class="header">
        <h1 class="header-title">PRIMEFORM</h1>
        <q-btn
          flat
          round
          icon="settings"
          color="white"
          class="settings-btn"
          @click="settingsDialog = true"
        />
      </div>

      <!-- Cycle Tracker Card -->
      <div class="glass-card">
        <div class="card-label">Cyclus Tracker</div>
        <q-input
          v-model="lastPeriodDate"
          type="date"
          outlined
          dark
          label="Laatste Menstruatie"
          class="date-input"
          @update:model-value="calculateCycleDay"
        />
        <div v-if="cycleDay !== null" class="cycle-day-info">
          <q-icon name="event" size="sm" class="q-mr-xs" />
          <span>Dag {{ cycleDay }} van je cyclus</span>
        </div>
      </div>

      <!-- Biometrics Card -->
      <div class="glass-card">
        <div class="card-label">Lichaamssignalen</div>
        
        <!-- Sleep Slider -->
        <div class="input-group">
          <div class="input-header">
            <span class="input-label">Slaap</span>
            <span class="input-value">{{ sleep }} uur</span>
          </div>
          <q-slider
            v-model="sleep"
            :min="3"
            :max="12"
            :step="0.5"
            color="#fbbf24"
            class="custom-slider"
          />
        </div>

        <div class="divider"></div>

        <!-- Readiness Slider -->
        <div class="input-group">
          <div class="input-header">
            <span class="input-label">Readiness</span>
            <span class="input-value">{{ readiness }}/10</span>
          </div>
          <q-slider
            v-model="readiness"
            :min="1"
            :max="10"
            color="#fbbf24"
            class="custom-slider"
          />
        </div>

        <div class="divider"></div>

        <!-- RHR Input -->
        <div class="input-group">
          <div class="input-header">
            <span class="input-label">RHR (Rusthartslag)</span>
          </div>
          <q-input
            v-model.number="rhr"
            type="number"
            outlined
            dark
            class="number-input"
            input-class="text-white"
          />
        </div>

        <div class="divider"></div>

        <!-- HRV Input -->
        <div class="input-group">
          <div class="input-header">
            <span class="input-label">HRV</span>
          </div>
          <q-input
            v-model.number="hrv"
            type="number"
            outlined
            dark
            class="number-input"
            input-class="text-white"
          />
        </div>
      </div>

      <!-- Action Button -->
      <q-btn
        class="action-button"
        :loading="loading"
        @click="getAdvice"
        unelevated
      >
        BEREKEN DAGPLAN
      </q-btn>

      <!-- Advice Card -->
      <transition name="fade-scale">
        <div v-if="advice" class="advice-card" :class="statusGlowClass">
          <!-- Cycle Wave SVG -->
          <div class="cycle-wave-container">
            <svg class="cycle-wave" viewBox="0 0 400 60" preserveAspectRatio="none">
              <defs>
                <linearGradient id="waveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style="stop-color:#1a1a1a;stop-opacity:1" />
                  <stop offset="50%" style="stop-color:#2a2a2a;stop-opacity:1" />
                  <stop offset="100%" style="stop-color:#1a1a1a;stop-opacity:1" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              <!-- Wave path -->
              <path 
                :d="cycleWavePath" 
                fill="none" 
                stroke="rgba(251, 191, 36, 0.3)" 
                stroke-width="2"
              />
              <!-- Current day marker -->
              <circle 
                :cx="currentDayX" 
                cy="30" 
                r="4" 
                fill="#fbbf24" 
                filter="url(#glow)"
                class="current-day-marker"
              />
            </svg>
          </div>

          <!-- Status Icon -->
          <div class="status-icon-container">
            <q-icon 
              :name="statusIcon" 
              :size="statusIconSize"
              :color="statusIconColor"
              class="status-icon"
            />
          </div>

          <div class="advice-header">JOUW ADVIES</div>
          <div class="advice-status">{{ advice.status }}</div>
          
          <!-- Markdown rendered message -->
          <div 
            class="advice-message" 
            v-html="renderMarkdown(advice.aiMessage)"
          ></div>
          
          <div v-if="advice.reasons && advice.reasons.length > 0" class="advice-reasons">
            <strong>Reden:</strong> {{ advice.reasons.join(', ') }}
          </div>
        </div>
      </transition>

      <!-- History Wave (HRV) -->
      <q-card class="trend-card" flat>
        <q-card-section class="trend-card-header">
          <div class="card-label">Trend Analyse • HRV (laatste 28 metingen)</div>
        </q-card-section>

        <q-card-section class="trend-card-body">
          <div v-if="historyLoading" class="trend-loading">Data laden...</div>
          <div v-else-if="hrvSeries[0].data.length === 0" class="trend-empty">
            Nog geen HRV-trenddata. Doe je eerste meting om de wave te vullen.
          </div>

          <div v-else class="apex-wrap">
            <ApexChart
              type="area"
              height="220"
              :options="hrvChartOptions"
              :series="hrvSeries"
            />
          </div>
        </q-card-section>
      </q-card>

    </div>

    <!-- Settings Dialog -->
    <q-dialog v-model="settingsDialog" class="settings-dialog">
      <q-card class="settings-card">
        <q-card-section class="settings-header">
          <div class="settings-title">JOUW PROFIEL</div>
        </q-card-section>

        <q-card-section class="settings-content">
          <div class="settings-input-group">
            <div class="settings-label">Baseline RHR</div>
            <q-input
              v-model.number="rhrBaseline"
              type="number"
              outlined
              dark
              label="Gemiddelde rusthartslag"
              class="settings-input"
              input-class="text-white"
            />
          </div>

          <div class="settings-input-group">
            <div class="settings-label">Baseline HRV</div>
            <q-input
              v-model.number="hrvBaseline"
              type="number"
              outlined
              dark
              label="Gemiddelde HRV"
              class="settings-input"
              input-class="text-white"
            />
          </div>

          <div class="settings-input-group">
            <div class="settings-label">Gemiddelde Cyclusduur</div>
            <q-input
              v-model.number="cycleLength"
              type="number"
              outlined
              dark
              label="Aantal dagen"
              class="settings-input"
              input-class="text-white"
            />
          </div>
        </q-card-section>

        <q-card-actions class="settings-actions">
          <q-btn
            class="settings-save-btn"
            @click="saveSettings"
            unelevated
          >
            OPSLAAN
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import VueApexCharts from 'vue3-apexcharts'

const ApexChart = VueApexCharts

// Reactive state
const sleep = ref(7.0)
const readiness = ref(6)
const rhr = ref(60)
const hrv = ref(50)
const lastPeriodDate = ref('')
const cycleDay = ref(null)
const loading = ref(false)
const advice = ref(null)
const userId = ref('')

// Settings state
const settingsDialog = ref(false)
const rhrBaseline = ref(60)
const hrvBaseline = ref(50)
const cycleLength = ref(28)

// History / trend
const historyLogs = ref([])
const historyLoading = ref(false)

// Load settings from localStorage + Firestore profile (if present)
const loadSettings = async () => {
  const savedRhrBaseline = localStorage.getItem('rhrBaseline')
  const savedHrvBaseline = localStorage.getItem('hrvBaseline')
  const savedCycleLength = localStorage.getItem('cycleLength')
  
  if (savedRhrBaseline) {
    rhrBaseline.value = parseFloat(savedRhrBaseline)
  }
  if (savedHrvBaseline) {
    hrvBaseline.value = parseFloat(savedHrvBaseline)
  }
  if (savedCycleLength) {
    cycleLength.value = parseInt(savedCycleLength)
  }

  // Overlay with Firestore profile values (source of truth)
  try {
    if (!userId.value) return
    const resp = await axios.get('http://127.0.0.1:3000/api/profile', {
      params: { userId: userId.value }
    })
    const profile = resp.data?.data?.profile
    if (!profile) return

    if (profile.rhrBaseline) {
      rhrBaseline.value = Number(profile.rhrBaseline)
      localStorage.setItem('rhrBaseline', String(rhrBaseline.value))
    }
    if (profile.hrvBaseline) {
      hrvBaseline.value = Number(profile.hrvBaseline)
      localStorage.setItem('hrvBaseline', String(hrvBaseline.value))
    }
    if (profile?.cycleData?.avgDuration) {
      cycleLength.value = Number(profile.cycleData.avgDuration)
      localStorage.setItem('cycleLength', String(cycleLength.value))
    }
    if (profile?.cycleData?.lastPeriod && !lastPeriodDate.value) {
      lastPeriodDate.value = profile.cycleData.lastPeriod
      calculateCycleDay()
    }
  } catch (e) {
    console.error('Profile sync failed:', e)
  }
}

// Save settings to localStorage + Firestore profile
const saveSettings = async () => {
  localStorage.setItem('rhrBaseline', rhrBaseline.value.toString())
  localStorage.setItem('hrvBaseline', hrvBaseline.value.toString())
  localStorage.setItem('cycleLength', cycleLength.value.toString())

  try {
    if (userId.value) {
      await axios.put('http://127.0.0.1:3000/api/profile', {
        userId: userId.value,
        profilePatch: {
          rhrBaseline: rhrBaseline.value,
          hrvBaseline: hrvBaseline.value,
          cycleData: {
            avgDuration: cycleLength.value,
            ...(lastPeriodDate.value ? { lastPeriod: lastPeriodDate.value } : {})
          }
        }
      })
    }
  } catch (e) {
    console.error('Profile save (settings) failed:', e)
  } finally {
    settingsDialog.value = false
  }

  // Recalculate cycle day if date is set
  if (lastPeriodDate.value) calculateCycleDay()
}

// Calculate cycle day from last period date
const calculateCycleDay = () => {
  if (!lastPeriodDate.value) {
    cycleDay.value = null
    return
  }
  
  const lastPeriod = new Date(lastPeriodDate.value)
  const today = new Date()
  const diffTime = today - lastPeriod
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  
  cycleDay.value = (diffDays % cycleLength.value) + 1
}

// Load settings on mount
onMounted(() => {
  userId.value = getOrCreateUserId()
  loadSettings()
  fetchHistory()
})

const getOrCreateUserId = () => {
  const key = 'primeform_user_id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const newId = `pf_${Date.now()}`
  localStorage.setItem(key, newId)
  return newId
}

const fetchHistory = async () => {
  historyLoading.value = true
  try {
    const response = await axios.get('http://127.0.0.1:3000/api/history', {
      params: { userId: userId.value }
    })
    historyLogs.value = response.data?.data || []
  } catch (error) {
    console.error('History ophalen mislukt:', error)
    historyLogs.value = []
  } finally {
    historyLoading.value = false
  }
}

// Get advice from backend
const getAdvice = async () => {
  if (!lastPeriodDate.value) {
    alert('Selecteer eerst de datum van je laatste menstruatie.')
    return
  }
  
  loading.value = true
  try {
    const payload = {
      userId: userId.value,
      readiness: readiness.value,
      sleep: sleep.value,
      sleepHours: sleep.value,
      rhr: rhr.value,
      rhrBaseline: rhrBaseline.value,
      hrv: hrv.value,
      hrvBaseline: hrvBaseline.value,
      lastPeriodDate: lastPeriodDate.value,
      cycleLength: cycleLength.value
    }

    console.log('Verzenden naar backend...', payload)

    const response = await axios.post('http://127.0.0.1:3000/api/daily-advice', payload)
    
    console.log('Antwoord ontvangen:', response.data)
    
    advice.value = response.data.data

    // Refresh trend after successful advice (it auto-saves to Firestore)
    fetchHistory()
  } catch (error) {
    console.error(error)
    alert("Kan backend niet bereiken. Check of server draait op poort 3000.")
  } finally {
    loading.value = false
  }
}

// Status glow class for advice card
const statusGlowClass = computed(() => {
  if (!advice.value) return ''
  switch(advice.value.status) {
    case 'REST': return 'status-rest'
    case 'RECOVER': return 'status-recover'
    case 'PUSH': return 'status-push'
    default: return ''
  }
})

// Status icon
const statusIcon = computed(() => {
  if (!advice.value) return 'help'
  switch(advice.value.status) {
    case 'PUSH': return 'bolt'
    case 'RECOVER': return 'battery_charging_full'
    case 'REST': return 'stop_circle'
    case 'MAINTAIN': return 'trending_up'
    default: return 'help'
  }
})

const statusIconSize = computed(() => {
  return '64px'
})

const statusIconColor = computed(() => {
  return '#fbbf24'
})

// --- HRV History Wave (ApexCharts) ---
const toMillis = (ts) => {
  if (!ts) return 0
  const d = new Date(ts)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

// Ensure left->right chronology and max 28 points
const hrvPoints = computed(() => {
  const logs = Array.isArray(historyLogs.value) ? historyLogs.value : []

  const cleaned = logs
    .map((l, idx) => {
      const hrvVal =
        Number(l.hrv) ||
        Number(l.metrics?.hrv) ||
        Number(l.metrics?.hrv?.current) ||
        Number(l.metrics?.hrv?.value)

      return {
        key: l.id || String(idx),
        timestamp: l.timestamp || l.date,
        hrv: hrvVal
      }
    })
    .filter((p) => Number.isFinite(p.hrv) && p.hrv > 0)
    .sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp))

  return cleaned.slice(-28)
})

const hrvSeries = computed(() => [
  {
    name: 'HRV',
    data: hrvPoints.value.map((p) => ({
      x: toMillis(p.timestamp),
      y: p.hrv
    }))
  }
])

const hrvChartOptions = computed(() => ({
  chart: {
    type: 'area',
    background: 'transparent',
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: { enabled: true },
    foreColor: 'rgba(255,255,255,0.75)'
  },
  theme: { mode: 'dark' },
  dataLabels: { enabled: false },
  stroke: {
    curve: 'smooth',
    width: 3,
    colors: ['#D4AF37']
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 0.6,
      opacityFrom: 0.35,
      opacityTo: 0.04,
      stops: [0, 70, 100]
    },
    colors: ['#D4AF37']
  },
  grid: {
    borderColor: 'rgba(255,255,255,0.08)',
    strokeDashArray: 4,
    padding: { left: 8, right: 8, top: 8, bottom: 8 }
  },
  xaxis: {
    type: 'datetime',
    labels: {
      style: { colors: 'rgba(255,255,255,0.55)' },
      datetimeUTC: false
    },
    axisBorder: { color: 'rgba(255,255,255,0.08)' },
    axisTicks: { color: 'rgba(255,255,255,0.08)' }
  },
  yaxis: {
    labels: { style: { colors: 'rgba(255,255,255,0.55)' } }
  },
  tooltip: {
    theme: 'dark',
    x: { format: 'dd MMM' }
  },
  markers: {
    size: 0,
    hover: { size: 4 }
  }
}))

// Cycle Wave Path Calculation
const cycleWavePath = computed(() => {
  if (!advice.value?.cycleInfo) {
    // Default wave if no cycle info
    return 'M 0,30 Q 100,10 200,30 T 400,30'
  }
  
  const cycleLen = cycleLength.value || 28
  
  // Create a smooth wave using Bezier curves
  // The wave represents hormone levels throughout the cycle
  const points = []
  const width = 400
  const height = 60
  const midY = height / 2
  
  // Generate wave points based on cycle phase
  // Follicular: rising, Luteal: high then dropping, Menstrual: low
  for (let i = 0; i <= 20; i++) {
    const x = (i / 20) * width
    const day = (i / 20) * cycleLen
    let y
    
    if (day <= 5) {
      // Menstrual phase - low
      y = midY + 15
    } else if (day <= 14) {
      // Follicular phase - rising
      y = midY + 15 - ((day - 5) / 9) * 20
    } else if (day <= 21) {
      // Early Luteal - high
      y = midY - 5
    } else {
      // Late Luteal - dropping
      y = midY - 5 + ((day - 21) / 7) * 20
    }
    
    points.push({ x, y })
  }
  
  // Create smooth Bezier curve path
  let path = `M ${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1] || curr
    
    // Control point for smooth curve
    const cp1x = prev.x + (curr.x - prev.x) / 2
    const cp1y = prev.y
    const cp2x = curr.x - (next.x - curr.x) / 2
    const cp2y = curr.y
    
    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${curr.x},${curr.y}`
  }
  
  return path
})

// Current day X position on wave
const currentDayX = computed(() => {
  if (!advice.value?.cycleInfo) return 200
  const cycleLen = cycleLength.value || 28
  const currentDay = advice.value.cycleInfo.currentCycleDay || 1
  return (currentDay / cycleLen) * 400
})

// Simple Markdown renderer
const renderMarkdown = (text) => {
  if (!text) return ''
  
  let html = text
  
  // Split by lines to process properly
  const lines = html.split('\n')
  const processedLines = []
  let inList = false
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()
    
    // Skip empty lines (but preserve structure)
    if (!line) {
      if (inList) {
        processedLines.push('</ul>')
        inList = false
      }
      processedLines.push('<br>')
      continue
    }
    
    // Convert emoji headers (⚡️, 📊, 👟, 🥗) to H3
    // Using alternation instead of character class to avoid combined character issues
    const emojiHeaderRegex = /^(⚡️|📊|👟|🥗)\s+(.+)/u
    if (emojiHeaderRegex.test(line)) {
      if (inList) {
        processedLines.push('</ul>')
        inList = false
      }
      const match = line.match(emojiHeaderRegex)
      processedLines.push(`<h3 class="markdown-h3">${match[2]}</h3>`)
      continue
    }
    
    // Convert H3 headers (###)
    if (/^###\s+(.+)/.test(line)) {
      if (inList) {
        processedLines.push('</ul>')
        inList = false
      }
      const match = line.match(/^###\s+(.+)/)
      processedLines.push(`<h3 class="markdown-h3">${match[1]}</h3>`)
      continue
    }
    
    // Convert H2 headers (##)
    if (/^##\s+(.+)/.test(line)) {
      if (inList) {
        processedLines.push('</ul>')
        inList = false
      }
      const match = line.match(/^##\s+(.+)/)
      processedLines.push(`<h2 class="markdown-h2">${match[1]}</h2>`)
      continue
    }
    
    // Convert H1 headers (#)
    if (/^#\s+(.+)/.test(line)) {
      if (inList) {
        processedLines.push('</ul>')
        inList = false
      }
      const match = line.match(/^#\s+(.+)/)
      processedLines.push(`<h1 class="markdown-h1">${match[1]}</h1>`)
      continue
    }
    
    // Convert bullet points (- or *)
    if (/^[-*]\s+(.+)/.test(line)) {
      if (!inList) {
        processedLines.push('<ul class="markdown-list">')
        inList = true
      }
      const match = line.match(/^[-*]\s+(.+)/)
      processedLines.push(`<li>${match[1]}</li>`)
      continue
    }
    
    // Regular paragraph line
    if (inList) {
      processedLines.push('</ul>')
      inList = false
    }
    processedLines.push(line)
  }
  
  // Close any open list
  if (inList) {
    processedLines.push('</ul>')
  }
  
  html = processedLines.join('')
  
  // Convert bold (**text**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  
  // Clean up multiple <br> tags
  html = html.replace(/(<br>\s*){3,}/g, '<br><br>')
  
  return html
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@1,900&family=Inter:wght@300;400&display=swap');

.dashboard-page {
  background: #000000;
  min-height: 100vh;
  padding: 24px 16px;
}

.dashboard-container {
  max-width: 500px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  position: relative;
}

.header-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  font-size: 2.5rem;
  color: #fbbf24;
  margin: 0;
  letter-spacing: 2px;
  flex: 1;
  text-align: center;
}

.settings-btn {
  position: absolute;
  right: 0;
}

/* Glass Card */
.glass-card {
  background: rgba(18, 18, 18, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 24px;
}

.card-label {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
}

/* Input Groups */
.input-group {
  margin-bottom: 20px;
}

.input-group:last-child {
  margin-bottom: 0;
}

.input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.input-label {
  font-family: 'Inter', sans-serif;
  font-weight: 300;
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.9);
}

.input-value {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 1rem;
  color: #fbbf24;
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 20px 0;
}

/* Date Input */
.date-input {
  margin-bottom: 12px;
}

.date-input :deep(.q-field__control) {
  color: white;
}

.date-input :deep(.q-field__native) {
  color: white;
}

.date-input :deep(.q-field__label) {
  color: rgba(255, 255, 255, 0.6);
}

.date-input :deep(.q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2);
}

.date-input :deep(.q-field--focused .q-field__outline) {
  border-color: #fbbf24;
}

.cycle-day-info {
  display: flex;
  align-items: center;
  font-family: 'Inter', sans-serif;
  font-weight: 300;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 8px;
}

/* Number Input */
.number-input {
  margin-top: 8px;
}

.number-input :deep(.q-field__control) {
  color: white;
}

.number-input :deep(.q-field__native) {
  color: white;
}

.number-input :deep(.q-field__label) {
  color: rgba(255, 255, 255, 0.6);
}

.number-input :deep(.q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2);
}

.number-input :deep(.q-field--focused .q-field__outline) {
  border-color: #fbbf24;
}

/* Custom Slider */
.custom-slider :deep(.q-slider__track) {
  background: rgba(255, 255, 255, 0.1);
}

.custom-slider :deep(.q-slider__track--active) {
  background: #fbbf24;
}

.custom-slider :deep(.q-slider__thumb) {
  background: #fbbf24;
  border: 2px solid #000000;
}

/* Action Button */
.action-button {
  width: 100%;
  background: #fbbf24 !important;
  color: #000000 !important;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 16px;
  border-radius: 4px;
  border: none;
}

.action-button:hover {
  background: #f59e0b !important;
}

/* Advice Card */
.advice-card {
  background: rgba(18, 18, 18, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 32px 24px;
  margin-top: 8px;
}

.advice-card.status-rest {
  border-color: rgba(239, 68, 68, 0.4);
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.2);
}

.advice-card.status-recover {
  border-color: rgba(249, 115, 22, 0.4);
  box-shadow: 0 0 20px rgba(249, 115, 22, 0.2);
}

.advice-card.status-push {
  border-color: rgba(16, 185, 129, 0.4);
  box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
}

.advice-header {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 16px;
}

.advice-status {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  font-size: 2rem;
  color: #ffffff;
  margin-bottom: 16px;
}

.advice-message {
  font-family: 'Inter', sans-serif;
  font-weight: 300;
  font-size: 1.1rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 16px;
}

.advice-reasons {
  font-family: 'Inter', sans-serif;
  font-weight: 300;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.05);
  padding: 12px;
  border-radius: 4px;
  margin-top: 16px;
}

.advice-reasons strong {
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
}

/* Trend Analyse */
.trend-loading,
.trend-empty {
  font-family: 'Inter', sans-serif;
  font-weight: 300;
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.7);
}

/* Apex trend card */
.trend-card {
  background: rgba(18, 18, 18, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.trend-card-header {
  padding-bottom: 0;
}

.trend-card-body {
  padding-top: 8px;
}

.apex-wrap :deep(.apexcharts-canvas) {
  border-radius: 6px;
}

/* Cycle Wave */
.cycle-wave-container {
  width: 100%;
  height: 60px;
  margin: -32px -24px 24px -24px;
  padding: 0;
  overflow: hidden;
  border-radius: 8px 8px 0 0;
  background: rgba(0, 0, 0, 0.3);
}

.cycle-wave {
  width: 100%;
  height: 100%;
  display: block;
}

.current-day-marker {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    r: 4;
  }
  50% {
    opacity: 0.7;
    r: 5;
  }
}

/* Status Icon */
.status-icon-container {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: -16px 0 16px 0;
}

.status-icon {
  filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.5));
}

/* Markdown Styling */
.advice-message :deep(.markdown-h3) {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  text-transform: uppercase;
  color: #fbbf24;
  font-size: 1.2rem;
  margin: 24px 0 12px 0;
  letter-spacing: 1px;
}

.advice-message :deep(.markdown-h2) {
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-style: italic;
  color: #fbbf24;
  font-size: 1.4rem;
  margin: 20px 0 10px 0;
}

.advice-message :deep(.markdown-h1) {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  color: #fbbf24;
  font-size: 1.6rem;
  margin: 20px 0 10px 0;
}

.advice-message :deep(.markdown-list) {
  list-style: none;
  padding-left: 0;
  margin: 12px 0;
}

.advice-message :deep(.markdown-list li) {
  font-family: 'Inter', sans-serif;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.9);
  padding: 4px 0 4px 20px;
  position: relative;
}

.advice-message :deep(.markdown-list li::before) {
  content: '•';
  color: #fbbf24;
  position: absolute;
  left: 0;
  font-weight: 700;
}

.advice-message :deep(strong) {
  font-weight: 600;
  color: #fbbf24;
}

/* Transitions */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.3s ease;
}

.fade-scale-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* Settings Dialog */
.settings-dialog :deep(.q-dialog__inner) {
  padding: 16px;
}

.settings-card {
  background: #000000;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  max-width: 500px;
  width: 100%;
}

.settings-header {
  padding: 32px 24px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  font-size: 1.5rem;
  color: #fbbf24;
  text-align: center;
  letter-spacing: 1px;
}

.settings-content {
  padding: 24px;
}

.settings-input-group {
  margin-bottom: 24px;
}

.settings-input-group:last-child {
  margin-bottom: 0;
}

.settings-label {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
}

.settings-input {
  margin-top: 8px;
}

.settings-input :deep(.q-field__control) {
  color: white;
}

.settings-input :deep(.q-field__native) {
  color: white;
}

.settings-input :deep(.q-field__label) {
  color: rgba(255, 255, 255, 0.6);
}

.settings-input :deep(.q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2);
}

.settings-input :deep(.q-field--focused .q-field__outline) {
  border-color: #fbbf24;
}

.settings-actions {
  padding: 16px 24px 24px;
}

.settings-save-btn {
  width: 100%;
  background: #fbbf24 !important;
  color: #000000 !important;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 16px;
  border-radius: 4px;
  border: none;
}

.settings-save-btn:hover {
  background: #f59e0b !important;
}
</style>