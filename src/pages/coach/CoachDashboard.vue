<template>
  <q-page class="coach-page">
    <div class="coach-container">
      <!-- Header -->
      <div class="header-row">
        <div>
          <div class="title">SQUADRON TELEMETRY</div>
          <div class="subtitle">
            {{ squadronSize }} pilots active in this constructor.
          </div>
        </div>
        <q-btn
          flat
          round
          icon="refresh"
          color="white"
          :loading="squadronStore.loading"
          @click="refresh"
        />
      </div>

      <!-- Telemetry Grid -->
      <q-card class="telemetry-card" flat>
        <q-card-section class="telemetry-header row items-center justify-between">
          <div class="telemetry-title">TelemetryGrid</div>
          <div class="telemetry-meta">
            <span class="mono-text">
              AT RISK:
              <span :class="['risk-count', atRiskCount > 0 ? 'text-negative' : 'text-positive']">
                {{ atRiskCount }}
              </span>
            </span>
          </div>
        </q-card-section>

        <q-separator dark />

        <q-card-section class="q-pa-none">
          <q-table
            :rows="squadronStore.athletes"
            :columns="columns"
            row-key="id"
            flat
            dark
            :loading="squadronStore.loading"
            :rows-per-page-options="[10, 25, 50]"
            class="telemetry-table"
            @row-click="onRowClick"
          >
            <!-- PILOT -->
            <template #body-cell-name="props">
              <q-td :props="props">
                <div class="pilot-name">
                  {{ pilotName(props.row) }}
                </div>
                <div class="pilot-email mono-text">
                  {{ pilotEmail(props.row) }}
                </div>
              </q-td>
            </template>

            <!-- BIO-CLOCK -->
            <template #body-cell-cyclePhase="props">
              <q-td :props="props" class="text-center">
                <div class="mono-text">
                  {{ cycleDisplay(props.row) }}
                </div>
              </q-td>
            </template>

            <!-- FORM (Readiness) -->
            <template #body-cell-readiness="props">
              <q-td :props="props" class="text-center">
                <div v-if="telemetry(props.row).hasData" class="readiness-chip">
                  <span
                    class="readiness-dot"
                    :class="readinessColorClass(telemetry(props.row).readiness)"
                  />
                  <span class="mono-text readiness-value">
                    {{ telemetry(props.row).readiness ?? '—' }}
                  </span>
                </div>
                <div v-else class="mono-text no-data">
                  NO DATA
                </div>
              </q-td>
            </template>

            <!-- LOAD RATIO (ACWR) -->
            <template #body-cell-acwr="props">
              <q-td :props="props" class="text-right">
                <span
                  v-if="telemetry(props.row).hasData && telemetry(props.row).acwr != null"
                  class="mono-text"
                  :class="acwrColorClass(telemetry(props.row).acwr)"
                >
                  {{ telemetry(props.row).acwr.toFixed(2) }}
                </span>
                <span v-else class="mono-text no-data">
                  NO DATA
                </span>
              </q-td>
            </template>

            <!-- DIRECTIVE -->
            <template #body-cell-status="props">
              <q-td :props="props" class="text-right">
                <div v-if="telemetry(props.row).hasData" class="directive-badge" :class="directiveClass(telemetry(props.row).directive)">
                  <span class="mono-text directive-label">
                    {{ telemetry(props.row).directive }}
                  </span>
                </div>
                <div v-else class="mono-text no-data">
                  NO DATA
                </div>
              </q-td>
            </template>

            <template #no-data>
              <div class="text-grey text-caption q-pa-md mono-text">
                No pilots found for this squadron.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { Notify } from 'quasar'
import { useSquadronStore } from '../../stores/squadron'

const squadronStore = useSquadronStore()

const columns = [
  {
    name: 'name',
    label: 'PILOT',
    field: 'name',
    align: 'left',
    sortable: true,
  },
  {
    name: 'cyclePhase',
    label: 'BIO-CLOCK',
    field: 'cyclePhase',
    align: 'center',
    sortable: false,
  },
  {
    name: 'readiness',
    label: 'FORM',
    field: 'readiness',
    align: 'center',
    sortable: false,
  },
  {
    name: 'acwr',
    label: 'LOAD RATIO',
    field: 'acwr',
    align: 'right',
    sortable: true,
  },
  {
    name: 'status',
    label: 'DIRECTIVE',
    field: 'status',
    align: 'right',
    sortable: false,
  },
]

const squadronSize = computed(() => squadronStore.squadronSize || 0)
const atRiskCount = computed(() => squadronStore.atRiskCount || 0)

const refresh = async () => {
  try {
    await squadronStore.fetchSquadron()
  } catch (err) {
    if (err?.message === 'No Team Assigned') {
      Notify.create({
        type: 'warning',
        message: 'Geen team gekoppeld aan dit coach-profiel.',
      })
    } else {
      Notify.create({
        type: 'negative',
        message: err?.message || 'Kon squadron-data niet laden.',
      })
    }
  }
}

onMounted(() => {
  if (!squadronStore.athletes.length) {
    refresh()
  }
})

// Helpers
const pilotName = (row) =>
  row.displayName ||
  row.name ||
  row.profile?.fullName ||
  row.profile?.name ||
  'Unknown Pilot'

const pilotEmail = (row) => row.email || row.profile?.email || '—'

const cycleDisplay = (row) => {
  const cd = row.cycleData || row.profile?.cycleData || {}
  const day = cd.cycleDay ?? cd.day ?? null
  const phaseRaw = cd.currentPhase || cd.phase || ''
  const phase = phaseRaw.toLowerCase()

  const phaseCode =
    phase.startsWith('fol') ? 'FOL' :
    phase.startsWith('ovu') ? 'OVU' :
    phase.startsWith('lut') ? 'LUT' :
    phase.startsWith('men') ? 'MEN' :
    ''

  if (!day && !phaseCode) return '—'
  if (!day) return phaseCode
  if (!phaseCode) return `Day ${day}`
  return `Day ${day} • ${phaseCode}`
}

/**
 * Telemetry resolver with mock fallback.
 * If acwr/readiness/directive are missing, generate a deterministic mock
 * from the pilot id/email to keep the UI informative without real data.
 */
const telemetry = (row) => {
  const realAcwr = typeof row.acwr === 'number' ? row.acwr : Number(row.acwr)
  const realReadiness =
    typeof row.readiness === 'number' ? row.readiness : Number(row.readiness)
  const realDirective = row.directive || row.status || row.recommendation?.status

  const hasReal =
    (Number.isFinite(realAcwr) && realAcwr > 0) ||
    (Number.isFinite(realReadiness) && realReadiness > 0) ||
    !!realDirective

  if (hasReal) {
    return {
      acwr: Number.isFinite(realAcwr) ? realAcwr : null,
      readiness: Number.isFinite(realReadiness) ? Math.round(realReadiness) : null,
      directive: (realDirective || '').toUpperCase() || inferDirectiveFromAcwr(realAcwr),
      hasData: true,
    }
  }

  // Mock path: generate pseudo-random but deterministic bucket based on id/email
  const seedSource = String(row.id || row.uid || row.email || row.profile?.email || '')
  if (!seedSource) {
    return {
      acwr: null,
      readiness: null,
      directive: 'NO DATA',
      hasData: false,
    }
  }

  const hash = simpleHash(seedSource)
  const bucket = hash % 3

  if (bucket === 0) {
    // Safe / Maintain
    return {
      acwr: 1.0,
      readiness: 7,
      directive: 'MAINTAIN',
      hasData: true,
    }
  }
  if (bucket === 1) {
    // Push window
    return {
      acwr: 1.15,
      readiness: 8,
      directive: 'PUSH',
      hasData: true,
    }
  }

  // At risk / Rest
  return {
    acwr: 1.7,
    readiness: 3,
    directive: 'REST',
    hasData: true,
  }
}

const simpleHash = (str) => {
  let h = 0
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h
}

const inferDirectiveFromAcwr = (acwr) => {
  const v = Number(acwr)
  if (!Number.isFinite(v)) return 'MAINTAIN'
  if (v > 1.5) return 'REST'
  if (v >= 0.8 && v <= 1.3) return 'PUSH'
  return 'MAINTAIN'
}

const readinessColorClass = (readiness) => {
  const v = Number(readiness)
  if (!Number.isFinite(v)) return 'readiness-neutral'
  if (v >= 7) return 'readiness-high'
  if (v <= 4) return 'readiness-low'
  return 'readiness-mid'
}

const acwrColorClass = (acwr) => {
  const v = Number(acwr)
  if (!Number.isFinite(v)) return ''
  if (v > 1.5) return 'text-negative'
  if (v >= 0.8 && v <= 1.3) return 'text-positive'
  return 'text-warning'
}

const directiveClass = (directive) => {
  const d = String(directive || '').toUpperCase()
  if (d === 'PUSH') return 'directive-push'
  if (d === 'REST' || d === 'RECOVER') return 'directive-rest'
  if (d === 'MAINTAIN') return 'directive-maintain'
  return 'directive-neutral'
}

const onRowClick = (_evt, row) => {
  // Placeholder: hook into detailed pilot telemetry
  // eslint-disable-next-line no-console
  console.log('Open Pilot Details', row.id || row.uid || '(unknown id)')
}
</script>

<style scoped lang="scss">
.coach-page {
  background: #050505;
  min-height: 100vh;
  padding: 24px;
}

.coach-container {
  max-width: 1200px;
  margin: 0 auto;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 900;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  font-size: 1.2rem;
  color: #fbbf24;
}

.subtitle {
  margin-top: 4px;
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.telemetry-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border-radius: 2px !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
}

.telemetry-header {
  padding: 12px 16px;
}

.telemetry-title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: rgba(229, 231, 235, 0.9);
}

.telemetry-meta {
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
}

.mono-text {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.risk-count {
  margin-left: 4px;
  font-weight: 700;
}

.telemetry-table :deep(.q-table__top),
.telemetry-table :deep(.q-table__bottom) {
  background: transparent !important;
}

.telemetry-table :deep(.q-table thead tr th) {
  background: rgba(15, 23, 42, 0.9) !important;
  color: rgba(249, 250, 251, 0.9) !important;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  border-color: rgba(55, 65, 81, 0.8) !important;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
}

.telemetry-table :deep(.q-table tbody tr) {
  background: rgba(15, 23, 42, 0.6) !important;
}

.telemetry-table :deep(.q-table tbody tr:hover) {
  background: rgba(31, 41, 55, 0.9) !important;
}

.telemetry-table :deep(.q-table tbody td) {
  border-color: rgba(55, 65, 81, 0.8) !important;
  color: rgba(243, 244, 246, 0.9) !important;
  font-size: 0.8rem;
}

.pilot-name {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(243, 244, 246, 0.95);
}

.pilot-email {
  margin-top: 2px;
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.9);
}

.readiness-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.readiness-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(15, 23, 42, 1);
}

.readiness-high {
  background-color: #22c55e;
}

.readiness-mid {
  background-color: #eab308;
}

.readiness-low {
  background-color: #ef4444;
}

.readiness-neutral {
  background-color: rgba(148, 163, 184, 0.9);
}

.readiness-value {
  font-size: 0.8rem;
}

.no-data {
  color: rgba(148, 163, 184, 0.8);
  font-size: 0.75rem;
}

.directive-badge {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 72px;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid rgba(148, 163, 184, 0.6);
}

.directive-label {
  font-size: 0.75rem;
  letter-spacing: 0.12em;
}

.directive-push {
  border-color: #22c55e;
  background-color: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.directive-rest {
  border-color: #ef4444;
  background-color: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.directive-maintain {
  border-color: #fbbf24;
  background-color: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.directive-neutral {
  border-color: rgba(148, 163, 184, 0.7);
  background-color: rgba(30, 64, 175, 0.15);
  color: rgba(209, 213, 219, 0.9);
}
</style>

<template>
  <q-page class="coach-dashboard elite-page">
    <div class="engineer-container">
      <header class="engineer-header">
        <h1 class="engineer-title">SQUADRON VIEW</h1>
        <q-btn
          flat
          round
          icon="refresh"
          color="white"
          size="sm"
          @click="loadSquad"
          :loading="loading"
        />
      </header>

      <q-card class="squadron-card" flat>
        <q-table
          :rows="squad"
          :columns="columns"
          row-key="id"
          :loading="loading"
          flat
          dark
          class="squadron-table"
          @row-click="onRowClick"
        >
          <template #body-cell-athlete="props">
            <q-td :props="props">
              <div class="athlete-cell">
                <q-avatar size="32px" color="rgba(255,255,255,0.1)" text-color="#9ca3af">
                  {{ getInitials(props.row.name) }}
                </q-avatar>
                <div class="athlete-info">
                  <span class="athlete-name">{{ props.row.name }}</span>
                  <span class="athlete-level" :class="`level-${props.row.level}`">
                    <q-icon :name="getLevelIcon(props.row.level)" size="12px" />
                    {{ props.row.level }}
                  </span>
                </div>
              </div>
            </q-td>
          </template>

          <template #body-cell-cycle="props">
            <q-td :props="props">
              <span class="elite-data">{{ props.row.cyclePhase }} · D{{ props.row.cycleDay }}</span>
            </q-td>
          </template>

          <template #body-cell-acwr="props">
            <q-td :props="props">
              <span
                class="acwr-cell elite-data"
                :class="`acwr-${props.row.acwrStatus}`"
              >
                {{ props.row.acwr?.toFixed(2) }}
              </span>
            </q-td>
          </template>

          <template #body-cell-compliance="props">
            <q-td :props="props">
              <span
                class="compliance-badge"
                :class="props.row.compliance ? 'done' : 'pending'"
              >
                {{ props.row.compliance ? 'Gedaan' : '—' }}
              </span>
            </q-td>
          </template>

          <template #body-cell-lastActivity="props">
            <q-td :props="props">
              <span v-if="props.row.lastActivity" class="elite-data">
                {{ props.row.lastActivity.time }} · {{ props.row.lastActivity.type }}
              </span>
              <span v-else class="elite-data" style="color: #9ca3af">—</span>
            </q-td>
          </template>
        </q-table>
      </q-card>

      <!-- Deep Dive Modal -->
      <q-dialog v-model="deepDiveOpen" position="right" full-height>
        <q-card class="deep-dive-card" flat>
          <q-card-section class="deep-dive-header">
            <div class="deep-dive-title">{{ selectedAthlete?.name }}</div>
            <q-btn flat round icon="close" @click="deepDiveOpen = false" />
          </q-card-section>
          <q-card-section v-if="selectedAthlete" class="deep-dive-body">
            <div class="deep-dive-row">
              <span class="label">Cyclus</span>
              <span class="value elite-data">{{ selectedAthlete.cyclePhase }} · D{{ selectedAthlete.cycleDay }}</span>
            </div>
            <div class="deep-dive-row">
              <span class="label">ACWR</span>
              <span class="value elite-data" :class="`acwr-${selectedAthlete.acwrStatus}`">
                {{ selectedAthlete.acwr?.toFixed(2) }}
              </span>
            </div>
            <div class="deep-dive-row">
              <span class="label">Prime Load 7d</span>
              <span class="value elite-data">{{ selectedAthlete.primeLoad7d }}</span>
            </div>
            <div class="deep-dive-row">
              <span class="label">Readiness</span>
              <span class="value elite-data">{{ selectedAthlete.readiness }}/10</span>
            </div>
            <div class="deep-dive-section-label">ACTIVITEITEN (Strava vs Prime)</div>
            <div
              v-for="(act, i) in selectedAthlete.activities"
              :key="i"
              class="deep-dive-activity"
            >
              <span class="elite-data">{{ act.date }}</span>
              <span>{{ act.type }}</span>
              <span class="elite-data">Raw {{ act.rawLoad }}</span>
              <span class="elite-data" style="color: #fbbf24">Prime {{ act.load }}</span>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getCoachSquad } from '../../services/coachService.js'
import { getAthleteDeepDive } from '../../services/userService.js'

const loading = ref(false)
const squad = ref([])
const deepDiveOpen = ref(false)
const selectedAthlete = ref(null)

const columns = [
  { name: 'athlete', label: 'ATLEET', field: 'name', align: 'left' },
  { name: 'cycle', label: 'CYCUS', field: 'cyclePhase', align: 'left' },
  { name: 'acwr', label: 'ACWR', field: 'acwr', align: 'center', sortable: true },
  { name: 'compliance', label: 'CHECK-IN', field: 'compliance', align: 'center' },
  { name: 'lastActivity', label: 'LAATSTE ACTIVITEIT', field: 'lastActivity', align: 'left' },
]

const getInitials = (name) =>
  name?.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || '?'

const getLevelIcon = (level) => {
  if (level === 'elite') return 'emoji_events'
  if (level === 'active') return 'directions_run'
  return 'person'
}

const loadSquad = async () => {
  loading.value = true
  try {
    squad.value = await getCoachSquad()
  } catch (e) {
    console.error('Squad load failed:', e)
  } finally {
    loading.value = false
  }
}

const onRowClick = async (_evt, row) => {
  selectedAthlete.value = null
  deepDiveOpen.value = true
  try {
    selectedAthlete.value = await getAthleteDeepDive(row.id)
  } catch (e) {
    console.error('Deep dive failed:', e)
  }
}

onMounted(() => loadSquad())
</script>

<style scoped lang="scss">
@use '../../css/quasar.variables' as q;

.coach-dashboard {
  background: q.$prime-black;
  min-height: 100vh;
  padding: 24px;
}

.engineer-container {
  max-width: 1100px;
  margin: 0 auto;
}

.engineer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.engineer-title {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1.25rem;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin: 0;
}

.squadron-card {
  background: q.$prime-surface !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: q.$radius-sm !important;
  box-shadow: none !important;
}

.squadron-table :deep(.q-table__top) {
  background: transparent;
}

.squadron-table :deep(thead tr th) {
  background: rgba(255, 255, 255, 0.04) !important;
  color: q.$prime-gray !important;
  font-family: q.$typography-font-family !important;
  font-size: 0.7rem !important;
  text-transform: uppercase !important;
  letter-spacing: 0.1em !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
}

.squadron-table :deep(tbody tr) {
  cursor: pointer;
}

.squadron-table :deep(tbody tr:hover) {
  background: rgba(255, 255, 255, 0.04) !important;
}

.athlete-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.athlete-name {
  font-family: q.$typography-font-family;
  font-weight: 500;
  color: #ffffff;
  display: block;
}

.athlete-level {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: q.$prime-gray;
}

.athlete-level.level-elite {
  color: q.$prime-gold;
}

.acwr-cell.acwr-spike {
  color: q.$status-recover;
}

.acwr-cell.acwr-undertraining {
  color: q.$status-maintain;
}

.acwr-cell.acwr-sweet {
  color: q.$status-push;
}

.compliance-badge {
  display: inline-block;
  border: 1px solid;
  padding: 2px 8px;
  font-size: 0.65rem;
  font-weight: 700;
  font-family: q.$mono-font;
  text-transform: uppercase;
  border-radius: 2px;
}

.compliance-badge.done {
  color: q.$status-push;
  border-color: q.$status-push;
  background: rgba(34, 197, 94, 0.1);
}

.compliance-badge.pending {
  color: q.$prime-gray;
  border-color: rgba(255, 255, 255, 0.2);
}

.deep-dive-card {
  background: q.$prime-black !important;
  border-left: 1px solid rgba(255, 255, 255, 0.08) !important;
  min-width: 360px;
  max-width: 420px;
}

.deep-dive-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 20px;
}

.deep-dive-title {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1rem;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.deep-dive-body {
  padding: 20px;
}

.deep-dive-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.deep-dive-row .label {
  font-family: q.$typography-font-family;
  font-size: 0.7rem;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.deep-dive-row .value {
  font-family: q.$mono-font;
  font-size: 0.9rem;
  color: #ffffff;
}

.deep-dive-section-label {
  font-family: q.$typography-font-family;
  font-size: 0.65rem;
  font-weight: 700;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 20px 0 12px 0;
}

.deep-dive-activity {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 0.8rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
</style>
