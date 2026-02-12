<template>
  <div class="coach-deep-dive">
    <q-dialog v-model="deepDiveOpen" position="right" full-height @hide="onDeepDiveClose">
      <q-card class="deep-dive-card" flat>
        <q-card-section class="deep-dive-header">
          <div class="deep-dive-title-row">
            <span class="deep-dive-title">{{ pilotDisplayName }}</span>
            <q-btn
              outline
              unelevated
              icon="auto_awesome"
              label="Weekrapport"
              color="amber"
              size="sm"
              dense
              class="weekrapport-btn"
              @click="reportDialogOpen = true"
            />
          </div>
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
            <span class="value elite-data" :class="acwrClass(modalAcwr)">
              {{ modalAcwr != null ? Number(modalAcwr).toFixed(2) : '—' }}
            </span>
          </div>
          <div class="deep-dive-row">
            <span class="label">CTL</span>
            <span class="value elite-data">{{ selectedPilotMapped.ctl != null ? Number(selectedPilotMapped.ctl).toFixed(0) : 'Geen data' }}</span>
          </div>
          <div class="deep-dive-row">
            <span class="label">RHR</span>
            <span class="value elite-data">
              {{ selectedPilotMapped.rhr != null ? `${Number(selectedPilotMapped.rhr).toFixed(0)} bpm` : 'Geen data' }}
            </span>
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
              <q-icon
                v-if="act.source === 'manual'"
                name="auto_awesome"
                size="xs"
                class="primeform-icon"
              />
              <q-icon
                v-else
                name="bolt"
                size="xs"
                class="strava-icon"
              />
              {{ act.type || 'Session' }}
            </span>
            <span class="elite-data prime-load-value">{{ activityLoadDisplay(act) }}</span>
          </div>
          <div v-if="!(selectedPilotMapped.activities?.length)" class="no-data mono-text">
            Geen activiteiten.
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <WeekReportDialog
      v-model="reportDialogOpen"
      :athlete-id="squadronStore.selectedPilot?.id || ''"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useSquadronStore } from '../stores/squadron'
import WeekReportDialog from './coach/WeekReportDialog.vue'

const squadronStore = useSquadronStore()

const deepDiveOpen = ref(false)
const reportDialogOpen = ref(false)

const pilotDisplayName = computed(() => {
  const p = squadronStore.selectedPilot
  if (!p) return 'Atleet'

  const profile = p.profile || {}
  if (profile.firstName) {
    const full = `${profile.firstName} ${profile.lastName || ''}`.trim()
    if (full) return full
  }

  if (p.name) return p.name

  const email = p.email || profile.email
  if (typeof email === 'string' && email.includes('@')) {
    return email.split('@')[0]
  }

  return 'Onbekend'
})

/** ACWR: alleen metrics.acwr, geen berekening. Tabel is de waarheid. */
const modalAcwr = computed(() => {
  const p = squadronStore.selectedPilot
  if (!p || !p.metrics) return null
  const v = p.metrics.acwr
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null
})

/** Map store selectedPilot (Atleet) to UI shape: cyclePhase, cycleDay, ctl, readiness, activities */
const selectedPilotMapped = computed(() => {
  const p = squadronStore.selectedPilot
  if (!p) return null

  const { profile = {}, stats = {}, metrics = {}, activities = [] } = p
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
    ctl:
      stats.chronicLoad != null
        ? Number(stats.chronicLoad)
        : metrics.ctl != null
          ? Number(metrics.ctl)
          : null,
    readiness:
      stats.currentReadiness != null
        ? Number(stats.currentReadiness)
        : p.readiness != null
          ? Number(p.readiness)
          : null,
    rhr:
      stats.currentRHR != null
        ? Number(stats.currentRHR)
        : metrics.rhr != null
          ? Number(metrics.rhr)
          : null,
    activities: Array.isArray(activities) ? activities : [],
  }
})

function computeCycleFromLMP(lastPeriodDate, cycleLength = 28) {
  let dateStr = lastPeriodDate
  if (dateStr && typeof dateStr === 'object' && 'seconds' in dateStr) {
    dateStr = new Date(dateStr.seconds * 1000).toISOString().slice(0, 10)
  } else {
    dateStr = String(dateStr || '').replace(/-/g, '/').slice(0, 10)
  }
  const last = new Date(dateStr)
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

/** Load voor activiteit: primeLoad, load, trainingLoad of Strava suffer_score; geen eigen berekening. */
function activityLoadDisplay(act) {
  const load =
    act.primeLoad != null ? act.primeLoad
    : act.load != null ? act.load
    : act.trainingLoad != null ? act.trainingLoad
    : act.suffer_score != null ? act.suffer_score
    : null
  if (load != null && Number.isFinite(Number(load))) return Number(load)
  return '—'
}

function onDeepDiveClose() {
  squadronStore.clearSelectedPilot()
  reportDialogOpen.value = false
}

// Open the deep dive dialog when selection is made from CoachDashboard table
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
  margin-top: 0;
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

.deep-dive-card .compliance-badge {
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

.deep-dive-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.deep-dive-title {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1rem;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.weekrapport-btn {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
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

.primeform-icon {
  color: q.$prime-gold;
}

.strava-icon {
  color: #fc4c02; // Strava orange
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
