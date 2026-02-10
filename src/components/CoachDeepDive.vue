<template>
  <div class="coach-deep-dive">
    <header class="engineer-header">
      <h2 class="engineer-title">SQUADRON VIEW</h2>
      <q-btn
        flat
        round
        icon="refresh"
        color="white"
        size="sm"
        :loading="loading"
        @click="loadSquad"
      />
    </header>

    <q-card class="squadron-card" flat>
      <q-table
        :rows="squad"
        :columns="squadColumns"
        row-key="id"
        :loading="loading"
        flat
        dark
        class="squadron-table"
        :rows-per-page-options="[10, 25, 50]"
        @row-click="onSquadRowClick"
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
              {{ props.row.acwr != null ? Number(props.row.acwr).toFixed(2) : '—' }}
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

        <template #no-data>
          <div class="text-grey text-caption q-pa-md">
            Geen squad data. Klik vernieuwen of log in als coach.
          </div>
        </template>
      </q-table>
    </q-card>

    <q-dialog v-model="deepDiveOpen" position="right" full-height @hide="onDeepDiveClose">
      <q-card class="deep-dive-card" flat>
        <q-card-section class="deep-dive-header">
          <div class="deep-dive-title">{{ pilotDisplayName }}</div>
          <q-btn flat round icon="close" @click="deepDiveOpen = false" />
        </q-card-section>

        <q-inner-loading :showing="squadronStore.deepDiveLoading" color="#fbbf24">
          <q-spinner-grid size="48px" color="#fbbf24" />
        </q-inner-loading>

        <q-card-section v-if="selectedPilotMapped && !squadronStore.deepDiveLoading" class="deep-dive-body">
          <div class="deep-dive-row">
            <span class="label">Bio-Clock</span>
            <span class="value elite-data">{{ selectedPilotMapped.cyclePhase }} · D{{ selectedPilotMapped.cycleDay }}</span>
          </div>
          <div class="deep-dive-row">
            <span class="label">ACWR</span>
            <span class="value elite-data" :class="acwrClass(selectedPilotMapped.acwr)">
              {{ selectedPilotMapped.acwr != null ? Number(selectedPilotMapped.acwr).toFixed(2) : 'Geen data' }}
            </span>
          </div>
          <div class="deep-dive-row">
            <span class="label">CTL</span>
            <span class="value elite-data">{{ selectedPilotMapped.ctl != null ? Number(selectedPilotMapped.ctl).toFixed(0) : 'Geen data' }}</span>
          </div>
          <div class="deep-dive-row">
            <span class="label">Readiness</span>
            <span class="value elite-data">{{ selectedPilotMapped.readiness != null ? `${selectedPilotMapped.readiness}/10` : 'Geen data' }}</span>
          </div>
          <div class="deep-dive-section-label">ACTIVITEITEN (Strava vs Prime)</div>
          <div
            v-for="(act, i) in (selectedPilotMapped.activities || [])"
            :key="act.id || i"
            class="deep-dive-activity"
          >
            <span class="elite-data">{{ formatActivityDate(act.date) }}</span>
            <span class="activity-type-cell">
              <q-icon v-if="act.source === 'manual'" name="build" size="xs" class="manual-icon" />
              <q-icon v-else :name="activityIcon(act.type)" size="xs" />
              {{ act.type || 'Session' }}
            </span>
            <span class="elite-data prime-load-value">{{ act.primeLoad != null ? act.primeLoad : '—' }}</span>
          </div>
          <div v-if="!(selectedPilotMapped.activities?.length)" class="no-data mono-text">
            Geen activiteiten.
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { getCoachSquad } from '../services/coachService.js'
import { useSquadronStore } from '../stores/squadron'

const squadronStore = useSquadronStore()

const loading = ref(false)
const squad = ref([])
const deepDiveOpen = ref(false)
const openingPilotId = ref(null)

const squadColumns = [
  { name: 'athlete', label: 'ATLEET', field: 'name', align: 'left' },
  { name: 'cycle', label: 'CYCUS', field: 'cyclePhase', align: 'left' },
  { name: 'acwr', label: 'ACWR', field: 'acwr', align: 'center', sortable: true },
  { name: 'compliance', label: 'CHECK-IN', field: 'compliance', align: 'center' },
  { name: 'lastActivity', label: 'LAATSTE ACTIVITEIT', field: 'lastActivity', align: 'left' },
]

const pilotDisplayName = computed(() => {
  const p = squadronStore.selectedPilot
  return p?.name || p?.email || 'Pilot'
})

/** Map store selectedPilot to UI shape: cyclePhase, cycleDay, acwr, ctl, readiness, activities */
const selectedPilotMapped = computed(() => {
  const p = squadronStore.selectedPilot
  if (!p) return null

  const { profile = {}, metrics = {}, activities = [] } = p
  const lastPeriod = profile.lastPeriodDate || profile.lastPeriod || null
  const len = Number(profile.cycleLength) || 28

  let cyclePhase = '—'
  let cycleDay = null
  if (lastPeriod) {
    const { phaseName, currentCycleDay } = computeCycleFromLMP(lastPeriod, len)
    cyclePhase = phaseName || '—'
    cycleDay = currentCycleDay
  }

  return {
    cyclePhase,
    cycleDay: cycleDay != null ? cycleDay : '—',
    acwr: metrics.acwr != null ? metrics.acwr : null,
    ctl: metrics.ctl != null ? metrics.ctl : null,
    readiness: p.readiness != null ? p.readiness : null,
    activities: Array.isArray(activities) ? activities : [],
  }
})

function computeCycleFromLMP(lastPeriodDate, cycleLength = 28) {
  const last = new Date(String(lastPeriodDate).replace(/-/g, '/').slice(0, 10))
  const today = new Date()
  last.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  const daysSince = Math.floor((today - last) / (1000 * 60 * 60 * 24))
  const currentCycleDay = (daysSince % cycleLength) + 1
  const ov = Math.floor(cycleLength / 2)
  let phaseName = 'Menstrual'
  if (currentCycleDay > 5 && currentCycleDay <= ov) phaseName = 'Follicular'
  else if (currentCycleDay > ov && currentCycleDay <= cycleLength) phaseName = 'Luteal'
  return { phaseName, currentCycleDay }
}

function acwrClass(acwr) {
  if (acwr == null || !Number.isFinite(acwr)) return ''
  if (acwr > 1.5) return 'acwr-spike'
  if (acwr >= 0.8 && acwr <= 1.3) return 'acwr-sweet'
  return 'acwr-undertraining'
}

function formatActivityDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(String(dateStr).replace(/-/g, '/').slice(0, 10))
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function activityIcon(type) {
  const t = (type || '').toLowerCase()
  if (t.includes('run')) return 'directions_run'
  if (t.includes('ride') || t.includes('bike')) return 'directions_bike'
  if (t.includes('swim')) return 'pool'
  if (t.includes('manual')) return 'build'
  return 'insights'
}

function getInitials(name) {
  return name?.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function getLevelIcon(level) {
  if (level === 'elite') return 'emoji_events'
  if (level === 'active') return 'directions_run'
  return 'person'
}

async function loadSquad() {
  loading.value = true
  try {
    squad.value = await getCoachSquad()
  } catch (e) {
    console.error('Squad load failed:', e)
  } finally {
    loading.value = false
  }
}

async function onSquadRowClick(_evt, row) {
  openingPilotId.value = row.id
  squadronStore.clearSelectedPilot()
  deepDiveOpen.value = true
  try {
    await squadronStore.fetchPilotDeepDive(row.id)
  } catch (e) {
    console.error('Deep dive failed:', e)
  } finally {
    openingPilotId.value = null
  }
}

function onDeepDiveClose() {
  squadronStore.clearSelectedPilot()
}

onMounted(() => loadSquad())

// Also open the deep dive dialog when an external selection is made (e.g. from CoachDashboard row click)
watch(
  () => squadronStore.selectedPilot,
  (val) => {
    if (val && !deepDiveOpen.value) {
      deepDiveOpen.value = true
    }
    if (!val && deepDiveOpen.value) {
      deepDiveOpen.value = false
    }
  }
)
</script>

<style scoped lang="scss">
@use '../css/quasar.variables' as q;

.coach-deep-dive {
  margin-top: 24px;
}

.engineer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.engineer-title {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1.1rem;
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

.elite-data {
  font-family: q.$mono-font;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.9);
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
  position: relative;
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  font-size: 0.8rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.activity-type-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.manual-icon {
  color: q.$prime-gold;
}

.prime-load-value {
  color: q.$prime-gold;
  min-width: 2.5rem;
  text-align: right;
}

.no-data {
  font-size: 0.75rem;
  color: q.$prime-gray;
  padding: 8px 0;
}
</style>
