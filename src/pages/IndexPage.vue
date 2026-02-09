<template>
  <q-page class="cockpit-page">
    <div class="cockpit-container">
      <!-- Header -->
      <div class="cockpit-header">
        <div class="brand">PRIMEFORM</div>
        <div class="subtitle">Pilot Cockpit</div>
      </div>

      <q-card class="cockpit-card" flat>
        <q-inner-loading :showing="dashboardStore.loading" color="#fbbf24">
          <q-spinner-gears size="48px" color="#fbbf24" />
        </q-inner-loading>

        <q-card-section>
          <div class="cockpit-grid">
            <!-- Widget 1: BIO-CLOCK -->
            <div class="widget bio-clock">
              <div class="widget-title">THE BIO-CLOCK</div>
              <div class="bio-main">
                <div class="bio-line mono">
                  PHASE:
                  <span class="highlight">
                    {{ phaseDisplay.name.toUpperCase() }}
                  </span>
                </div>
                <div class="bio-line mono">
                  DAY
                  <span class="highlight">
                    {{ phaseDisplay.dayDisplay }}
                  </span>
                  of
                  <span class="highlight">
                    {{ phaseDisplay.length }}
                  </span>
                </div>
              </div>

              <div class="cycle-bar">
                <div class="cycle-rail">
                  <div
                    class="cycle-marker"
                    :style="{ left: phaseDisplay.progress + '%' }"
                  />
                </div>
                <div class="cycle-scale mono">
                  <span>1</span>
                  <span>{{ Math.round(phaseDisplay.length / 2) }}</span>
                  <span>{{ phaseDisplay.length }}</span>
                </div>
              </div>

              <div class="prime-tip mono">
                PRIME TIP:
                <span class="prime-tip-text">{{ primeTip }}</span>
              </div>
            </div>

            <!-- Widget 2: LOAD METER -->
            <div class="widget load-meter">
              <div class="widget-title">THE LOAD METER</div>
              <div class="load-content">
                <div class="acwr-label mono">ACWR</div>
                <div class="acwr-value mono">
                  {{ acwrDisplay }}
                </div>
                <div class="gauge">
                  <div class="gauge-ring">
                    <div
                      class="gauge-fill"
                      :class="['zone-' + (loadZone || 'neutral')]"
                    />
                  </div>
                  <div class="gauge-zones mono">
                    <span class="zone-tag zone-optimal">0.8–1.3 OPTIMAL</span>
                    <span class="zone-tag zone-over">1.3–1.5 OVERREACHING</span>
                    <span class="zone-tag zone-danger">1.5+ DANGER</span>
                  </div>
                </div>
                <div class="acwr-status mono">
                  ACWR STATUS:
                  <span :class="['status-pill', 'zone-' + (loadZone || 'neutral')]">
                    {{ loadStatusDisplay }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Widget 3: RECENT TELEMETRY -->
            <div class="widget telemetry-feed">
              <div class="widget-title">RECENT TELEMETRY</div>
              <div v-if="recentActivities.length === 0" class="telemetry-empty mono">
                No recent activities. Engine idling.
              </div>
              <q-list v-else dense class="telemetry-list">
                <q-item
                  v-for="act in recentActivities"
                  :key="act.id"
                  class="telemetry-item"
                >
                  <q-item-section avatar>
                    <q-icon :name="activityIcon(act.type)" size="sm" color="orange" />
                  </q-item-section>
                  <q-item-section>
                    <div class="mono telemetry-line">
                      <span class="telemetry-type">
                        {{ act.type || 'Session' }}
                      </span>
                      <span class="telemetry-date">
                        {{ formatActivityDate(act.date) }}
                      </span>
                    </div>
                    <div class="mono telemetry-load">
                      PRIME LOAD:
                      <span class="highlight">
                        {{ act.primeLoad ?? '—' }}
                      </span>
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useDashboardStore } from '../stores/dashboard'

const dashboardStore = useDashboardStore()

onMounted(() => {
  if (!dashboardStore.telemetry && !dashboardStore.loading) {
    dashboardStore.fetchUserDashboard().catch(() => {
      // error stored in store; UI stays graceful
    })
  }
})

const telemetry = computed(() => dashboardStore.telemetry || {})

// Phase display
const phaseDisplay = computed(() => {
  const cp = dashboardStore.currentPhase
  const day = cp.day && cp.day > 0 ? cp.day : null
  const len = cp.length || 28
  const progress = day ? Math.min(Math.max((day / len) * 100, 0), 100) : 0

  return {
    name: cp.name || 'Unknown',
    dayDisplay: day ?? '?',
    day,
    length: len,
    progress,
  }
})

// Prime Tip based on phase
const primeTip = computed(() => {
  const name = (phaseDisplay.value.name || '').toLowerCase()
  if (name.includes('follicular')) {
    return 'Estrogen rising — High intensity intervals are well tolerated.'
  }
  if (name.includes('ovulation')) {
    return 'Peak power window — Short, explosive work is ideal.'
  }
  if (name.includes('luteal')) {
    return 'Luteal Tax active — Respect recovery and reduce spikes.'
  }
  if (name.includes('menstrual')) {
    return 'Focus on comfort — Low intensity and technique work.'
  }
  return 'Match your load to how you actually feel today.'
})

// ACWR + load status
const acwr = computed(() => {
  const val = Number(telemetry.value.acwr)
  return Number.isFinite(val) ? val : null
})

const acwrDisplay = computed(() => {
  return acwr.value != null ? acwr.value.toFixed(2) : '--'
})

const loadZone = computed(() => {
  const status = dashboardStore.loadStatus
  if (!status) return null
  return status.toLowerCase()
})

const loadStatusDisplay = computed(() => {
  return dashboardStore.loadStatus || 'NO DATA'
})

// Recent activities
const recentActivities = computed(() => {
  const list = telemetry.value.activities || []
  return list.slice(0, 3).map((a) => ({
    id: a.id || a.activity_id || `${a.date || a.start_date || ''}-${a.type || ''}`,
    type: a.type || a.sport_type || 'Session',
    date: a.date || a.start_date || a.start_date_local || null,
    primeLoad: a.prime_load ?? a.primeLoad ?? a.load ?? null,
  }))
})

const activityIcon = (type) => {
  const t = (type || '').toLowerCase()
  if (t.includes('run')) return 'directions_run'
  if (t.includes('ride') || t.includes('bike')) return 'directions_bike'
  if (t.includes('swim')) return 'pool'
  if (t.includes('strength') || t.includes('gym')) return 'fitness_center'
  return 'insights'
}

const formatActivityDate = (raw) => {
  if (!raw) return 'Unknown'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  return d.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
  })
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap');

.cockpit-page {
  background: #050505;
  min-height: 100vh;
  padding: 24px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.cockpit-container {
  max-width: 1100px;
  width: 100%;
}

.cockpit-header {
  margin-bottom: 16px;
}

.brand {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 900;
  font-style: italic;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  font-size: 1rem;
  color: #fbbf24;
}

.subtitle {
  margin-top: 4px;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(156, 163, 175, 0.95);
}

.cockpit-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.cockpit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.widget {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  padding: 16px 14px;
  background: rgba(15, 23, 42, 0.8);
}

.widget-title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.8rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(156, 163, 175, 0.9);
  margin-bottom: 10px;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.highlight {
  color: #fbbf24;
}

/* Bio-Clock */
.bio-main {
  margin-bottom: 12px;
}

.bio-line {
  font-size: 0.85rem;
  color: rgba(243, 244, 246, 0.96);
  margin-bottom: 4px;
}

.cycle-bar {
  margin: 10px 0 8px;
}

.cycle-rail {
  position: relative;
  height: 4px;
  background: rgba(31, 41, 55, 0.9);
  border-radius: 2px;
  overflow: hidden;
}

.cycle-marker {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 12px;
  background-color: #fbbf24;
}

.cycle-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 0.65rem;
  color: rgba(148, 163, 184, 0.9);
}

.prime-tip {
  margin-top: 10px;
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.96);
}

.prime-tip-text {
  color: rgba(243, 244, 246, 0.96);
}

/* Load Meter */
.load-content {
  text-align: center;
}

.acwr-label {
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.9);
  letter-spacing: 0.16em;
}

.acwr-value {
  font-size: 2.4rem;
  font-weight: 600;
  color: #fbbf24;
  margin: 4px 0 8px;
}

.gauge {
  margin: 8px 0 10px;
}

.gauge-ring {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  border: 2px solid rgba(55, 65, 81, 0.9);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gauge-fill {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 3px solid rgba(148, 163, 184, 0.6);
}

.zone-optimal {
  border-color: #22c55e;
}

.zone-over {
  border-color: #fbbf24;
}

.zone-danger {
  border-color: #ef4444;
}

.gauge-zones {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.65rem;
  color: rgba(148, 163, 184, 0.95);
}

.zone-tag {
  display: inline-block;
}

.zone-tag.zone-optimal {
  color: #22c55e;
}

.zone-tag.zone-over {
  color: #fbbf24;
}

.zone-tag.zone-danger {
  color: #ef4444;
}

.acwr-status {
  margin-top: 8px;
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.95);
}

.status-pill {
  margin-left: 4px;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid rgba(148, 163, 184, 0.7);
  font-size: 0.7rem;
}

.status-pill.zone-optimal {
  border-color: #22c55e;
  color: #22c55e;
}

.status-pill.zone-over {
  border-color: #fbbf24;
  color: #fbbf24;
}

.status-pill.zone-danger {
  border-color: #ef4444;
  color: #ef4444;
}

/* Recent Telemetry */
.telemetry-feed {
  display: flex;
  flex-direction: column;
}

.telemetry-empty {
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.95);
}

.telemetry-list {
  margin-top: 4px;
}

.telemetry-item {
  padding: 6px 4px;
}

.telemetry-line {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: rgba(243, 244, 246, 0.96);
}

.telemetry-type {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.telemetry-date {
  color: rgba(148, 163, 184, 0.95);
}

.telemetry-load {
  font-size: 0.7rem;
  color: rgba(156, 163, 175, 0.95);
}
</style>