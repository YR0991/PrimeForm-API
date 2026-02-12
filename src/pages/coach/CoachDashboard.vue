<template>
  <q-page class="coach-page">
    <div class="coach-container">
      <!-- Header -->
      <div class="header-row">
        <div>
          <div class="title">TEAM DATA</div>
          <div class="subtitle">
            {{ squadronSize }} atleten actief in dit team.
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
          <div class="telemetry-title">Atleet Overzicht</div>
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
            :rows="rows"
            :columns="columns"
            row-key="id"
            flat
            dark
            :loading="squadronStore.loading"
            :rows-per-page-options="[10, 25, 50]"
            class="telemetry-table"
            :grid="$q.screen.xs"
            :hide-header="$q.screen.xs"
            @row-click="onRowClick"
          >
            <!-- ATLEET -->
            <template #body-cell-name="props">
              <q-td :props="props">
                <div class="athlete-name">
                  {{ pilotName(props.row) }}
                </div>
                <div v-if="athleteLevelLabel(props.row)" class="level-badge" :class="athleteLevelClass(props.row)">
                  {{ athleteLevelLabel(props.row) }}
                </div>
                <div class="athlete-email mono-text">
                  {{ pilotEmail(props.row) }}
                </div>
              </q-td>
            </template>

            <!-- BIO-CLOCK -->
            <template #body-cell-cyclePhase="props">
              <q-td :props="props" class="text-center">
                <div class="mono-text" :class="bioClockColorClass(props.row)">
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

            <!-- Card view for mobile (grid mode) -->
            <template #item="props">
              <q-card
                class="athlete-card"
                flat
                bordered
                @click="onRowClick(null, props.row)"
              >
                <div class="athlete-card-header row items-center justify-between">
                  <div>
                    <div class="athlete-name">
                      {{ pilotName(props.row) }}
                    </div>
                    <div v-if="athleteLevelLabel(props.row)" class="level-badge" :class="athleteLevelClass(props.row)">
                      {{ athleteLevelLabel(props.row) }}
                    </div>
                    <div class="athlete-email mono-text">
                      {{ pilotEmail(props.row) }}
                    </div>
                  </div>
                  <div
                    v-if="telemetry(props.row).hasData"
                    class="directive-badge"
                    :class="directiveClass(telemetry(props.row).directive)"
                  >
                    <span class="mono-text directive-label">
                      {{ telemetry(props.row).directive }}
                    </span>
                  </div>
                  <div v-else class="mono-text no-data">
                    NO DATA
                  </div>
                </div>

                <div class="athlete-card-body">
                  <div class="athlete-card-metric">
                    <div class="metric-label mono-text">BIO-CLOCK</div>
                    <div class="metric-value mono-text">
                      {{ cycleDisplay(props.row) }}
                    </div>
                  </div>
                  <div class="athlete-card-metric">
                    <div class="metric-label mono-text">READINESS</div>
                    <div
                      class="metric-value mono-text"
                      :class="readinessColorClass(telemetry(props.row).readiness)"
                    >
                      {{ telemetry(props.row).readiness != null ? `${telemetry(props.row).readiness}/10` : '—' }}
                    </div>
                  </div>
                  <div class="athlete-card-metric">
                    <div class="metric-label mono-text">ACWR</div>
                    <div
                      class="metric-value mono-text"
                      :class="acwrColorClass(telemetry(props.row).acwr)"
                    >
                      {{
                        telemetry(props.row).acwr != null
                          ? telemetry(props.row).acwr.toFixed(2)
                          : '—'
                      }}
                    </div>
                  </div>
                </div>
              </q-card>
            </template>

            <template #no-data>
              <div class="no-athletes-state mono-text">
                Geen atleten gevonden in dit team. Voeg atleten toe via de Admin.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- Detail modal: opent bij klik op rij via onRowClick -> fetchPilotDeepDive -->
      <CoachDeepDive />
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted as onMountedHook } from 'vue'
import { Notify, useQuasar } from 'quasar'
import { useSquadronStore } from '../../stores/squadron'
import CoachDeepDive from '../../components/CoachDeepDive.vue'

const squadronStore = useSquadronStore()
const $q = useQuasar()

const rows = computed(() => squadronStore.athletes || [])

const columns = [
  {
    name: 'name',
    label: 'ATLEET',
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
        message: err?.message || 'Kon teamdata niet laden.',
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
const getName = (row) => {
  const profile = row.profile || {}

  if (profile.firstName) {
    return `${profile.firstName} ${profile.lastName || ''}`.trim() || 'Onbekend'
  }

  if (row.displayName) return row.displayName

  if (profile.fullName) return profile.fullName

  const email = row.email || profile.email
  if (typeof email === 'string' && email.includes('@')) {
    return email.split('@')[0]
  }

  return 'Onbekend'
}

const pilotName = (row) => getName(row)

const pilotEmail = (row) => row.email || row.profile?.email || '—'

/** Level from athlete.level (1|2|3) or athlete.status (e.g. 'rookie'|'elite'). */
const athleteLevelLabel = (row) => {
  const raw = row.level ?? row.status
  if (raw == null || raw === '') return ''
  const v = String(raw).toLowerCase()
  if (v === '1' || v === 'rookie') return 'Rookie'
  if (v === '2' || v === 'active') return 'Active'
  if (v === '3' || v === 'elite') return 'Elite'
  return String(raw)
}

const athleteLevelClass = (row) => {
  const raw = row.level ?? row.status
  if (raw == null || raw === '') return ''
  const v = String(raw).toLowerCase()
  if (v === '3' || v === 'elite') return 'level-elite'
  if (v === '2' || v === 'active') return 'level-active'
  return 'level-rookie'
}

const cycleDisplay = (row) => {
  const bc = row.stats?.bioClock
  if (bc && bc.phase && bc.day != null) {
    return `${bc.phase} (Dag ${bc.day})`
  }

  // Fallback to legacy cycleData if present
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

const bioClockColorClass = (row) => {
  const color = row.stats?.bioClock?.color
  if (color === 'negative') return 'text-negative'
  if (color === 'positive') return 'text-positive'
  if (color === 'warning') return 'text-warning'
  return 'text-grey-6'
}

/** Alleen database-metrics; geen herberekening. row.acwr is door store gezet uit row.metrics.acwr. */
const telemetry = (row) => {
  const metrics = row.metrics || {}
  const acwr = metrics.acwr != null ? Number(metrics.acwr) : (row.acwr != null ? Number(row.acwr) : null)
  const readiness =
    row.readiness != null ? Number(row.readiness)
    : (row.stats?.currentReadiness != null ? Number(row.stats.currentReadiness) : null)
  const hasAcwr = Number.isFinite(acwr)
  const hasReadiness = Number.isFinite(readiness)
  const directive = hasAcwr ? inferDirectiveFromAcwr(acwr) : 'NO DATA'
  const hasData = hasAcwr || hasReadiness

  return {
    acwr: hasAcwr ? acwr : null,
    readiness: hasReadiness ? Math.round(readiness) : null,
    directive: hasData ? directive : 'NO DATA',
    hasData,
  }
}

/** Status alleen op basis van ACWR uit database: 0.8–1.3 = Build, >1.5 = Rest. */
const inferDirectiveFromAcwr = (acwr) => {
  const v = Number(acwr)
  if (!Number.isFinite(v)) return 'MAINTAIN'
  if (v > 1.5) return 'REST'
  if (v >= 0.8 && v <= 1.3) return 'BUILD'
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
  if (d === 'BUILD' || d === 'PUSH') return 'directive-push'
  if (d === 'REST' || d === 'RECOVER') return 'directive-rest'
  if (d === 'MAINTAIN') return 'directive-maintain'
  return 'directive-neutral'
}

const onRowClick = async (_evt, row) => {
  const id = row.id || row.uid
  if (!id) return
  // Eerst modal vullen met rijdata (juiste metrics.acwr); daarna activiteiten ophalen
  squadronStore.setSelectedPilotFromRow(row)
  try {
    await squadronStore.fetchPilotDeepDive(id)
  } catch (e) {
    console.error('Failed to load pilot deep dive', e)
    Notify.create({
      type: 'negative',
      message: e?.message || 'Kon atleetdetails niet laden.',
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
  background: transparent !important;
  color: #9ca3af !important;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
}

.telemetry-table :deep(.q-table tbody tr) {
  background: transparent !important;
}

.telemetry-table :deep(.q-table tbody tr:hover) {
  background: rgba(255, 255, 255, 0.04) !important;
}

.telemetry-table :deep(.q-table tbody td) {
  border-color: rgba(255, 255, 255, 0.08) !important;
  color: rgba(243, 244, 246, 0.95) !important;
  font-size: 0.8rem;
}

.athlete-name {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(243, 244, 246, 0.95);
}

.level-badge {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.level-badge.level-elite {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.5);
  background: rgba(251, 191, 36, 0.08);
}

.level-badge.level-active {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.06);
}

.level-badge.level-rookie {
  color: #9ca3af;
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
}

.athlete-email {
  margin-top: 4px;
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

.athlete-card {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f9fafb;
  padding: 10px 12px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.athlete-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.12);
}

.athlete-card-header {
  margin-bottom: 8px;
}

.athlete-card-body {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.athlete-card-metric {
  flex: 1;
}

.metric-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgba(156, 163, 175, 0.9);
}

.metric-value {
  margin-top: 2px;
  font-size: 0.85rem;
  color: #e5e7eb;
}

.no-athletes-state {
  padding: 16px;
  text-align: center;
  font-size: 0.8rem;
  color: rgba(148, 163, 184, 0.9);
}
</style>
