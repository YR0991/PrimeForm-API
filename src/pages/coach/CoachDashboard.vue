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

      <!-- Deep Dive: squadron view + pilot detail panel -->
      <CoachDeepDive />
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted as onMountedHook } from 'vue'
import { Notify } from 'quasar'
import { useSquadronStore } from '../../stores/squadron'
import CoachDeepDive from '../../components/CoachDeepDive.vue'

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

onMountedHook(() => {
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

  return {
    acwr: null,
    readiness: null,
    directive: 'NO DATA',
    hasData: false,
  }
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

const onRowClick = async (_evt, row) => {
  const id = row.id || row.uid
  if (!id) return
  try {
    await squadronStore.fetchPilotDeepDive(id)
  } catch (e) {
    console.error('Failed to load pilot deep dive', e)
    Notify.create({
      type: 'negative',
      message: e?.message || 'Kon pilootdetails niet laden.',
    })
  }
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
