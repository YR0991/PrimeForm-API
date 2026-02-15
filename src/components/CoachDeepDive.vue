<template>
  <div class="coach-deep-dive">
    <q-dialog v-model="deepDiveOpen" position="right" full-height @hide="onDeepDiveClose">
      <q-card class="dashboard-card" flat>
        <!-- TOP: Atleet name + Directive badge + Data Integrity (7-day compliance) -->
        <q-card-section class="dashboard-header">
          <div class="header-top row items-center justify-between">
            <span class="atleet-name">{{ atleetDisplayName }}</span>
            <q-btn flat round icon="close" dense @click="deepDiveOpen = false" />
          </div>
          <div class="header-badges row items-center q-gutter-sm q-mt-sm">
            <div class="directive-badge" :class="directiveBadgeClass">
              [{{ directiveLabel }}]
            </div>
            <div class="compliance-wrap row items-center q-gutter-xs">
              <span class="compliance-label">Consistentie:</span>
              <div class="compliance-bars row no-wrap q-gutter-x-xs">
                <div
                  v-for="(filled, idx) in (atleet?.complianceDays ?? Array(7).fill(false))"
                  :key="idx"
                  class="compliance-bar"
                  :class="{ filled }"
                />
              </div>
              <span
                class="compliance-value mono-text"
                :class="{ 'compliance-full': (atleet?.complianceLast7 ?? 0) === 7 }"
              >
                {{ atleet?.complianceLast7 ?? 0 }}/7
                <template v-if="(atleet?.complianceLast7 ?? 0) === 7"> CONSISTENTIE</template>
              </span>
              <span v-if="(atleet?.currentStreak ?? 0) > 7" class="streak-badge mono-text">
                🔥 {{ atleet.currentStreak }} DAGEN STREAK
              </span>
            </div>
          </div>
        </q-card-section>

        <q-inner-loading :showing="squadronStore.deepDiveLoading" color="#fbbf24">
          <q-spinner-grid size="48px" color="#fbbf24" />
        </q-inner-loading>

        <q-card-section v-if="squadronStore.selectedAtleet" class="dashboard-body">
          <div class="split-layout row">
            <!-- LEFT: Fysiologische Data (charts) -->
            <div class="left-panel">
              <div class="panel-label">FYSIOLOGISCHE DATA</div>
              <div class="chart-tile">
                <div class="chart-title">Trainingsvolume (ATL dagelijks)</div>
                <div v-if="loadHistorySeries.length" class="apex-wrap">
                  <VueApexCharts
                    type="bar"
                    height="140"
                    :options="atlChartOptions"
                    :series="[{ name: 'Load', data: loadHistorySeries }]"
                  />
                </div>
                <div v-else class="chart-empty mono-text">Geen data</div>
              </div>
              <div class="chart-tile">
                <div class="chart-title">Belastingsbalans</div>
                <div class="balance-value mono-text" :class="acwrColorClass">
                  {{ formatMetric(atleet?.metrics?.acwr, 2) }}
                </div>
                <div class="chart-sub">Opbouw t.o.v. chronische load</div>
              </div>
              <div class="chart-tile chart-tile-cxc">
                <div class="chart-title">CxC (Cycle-over-Cycle)</div>
                <div v-if="ghostComparison.length" class="apex-wrap apex-wrap-cxc">
                  <VueApexCharts
                    type="line"
                    height="450"
                    :options="cxcChartOptions"
                    :series="cxcSeries"
                  />
                </div>
                <div v-else class="chart-empty mono-text">Nog niet genoeg data</div>
              </div>
            </div>

            <!-- RIGHT: Mission Parameters -->
            <div class="right-panel">
              <div class="panel-label">MISSION PARAMETERS</div>
              <div class="sidebar-block">
                <div class="block-title">Doelen &amp; Success Scenario</div>
                <div class="block-content">
                  <template v-if="goalsText || successScenarioText">
                    <p v-if="goalsText" class="mission-text">{{ goalsText }}</p>
                    <p v-if="successScenarioText" class="mission-text success-scenario">{{ successScenarioText }}</p>
                  </template>
                  <p v-else class="no-data mono-text">Geen intake-data.</p>
                </div>
              </div>
              <div class="sidebar-block" :class="{ 'has-injury': hasInjury }">
                <div class="block-title">Blessurehistorie</div>
                <div class="block-content" :class="{ 'injury-warning': hasInjury }">
                  {{ injuryText || 'Geen blessures gemeld.' }}
                </div>
              </div>
              <div class="sidebar-block">
                <div class="block-title">Coach Logbook (Engineering Notes)</div>
                <q-input
                  v-model="localNotes"
                  type="textarea"
                  outlined
                  dark
                  dense
                  autogrow
                  placeholder="Notities voor deze opdracht..."
                  class="logbook-input"
                  @update:model-value="onNotesInput"
                />
                <div v-if="notesSaving" class="notes-status mono-text">Opslaan…</div>
                <div v-else-if="notesSavedAt" class="notes-status mono-text saved">Opgeslagen</div>
              </div>
              <q-expansion-item
                v-if="authStore.isAdmin && atleet?.id"
                icon="timeline"
                label="Why (timeline)"
                header-class="timeline-expansion-header"
                class="sidebar-block timeline-expansion"
              >
                <DebugTimeline :uid="atleet.id" :days="14" :is-admin="authStore.isAdmin" />
              </q-expansion-item>
            </div>
          </div>

          <!-- Activiteiten Historie (last 10; manual sessions can be removed by coach) -->
          <div class="activities-section">
            <div class="panel-label">ACTIVITEITEN HISTORIE</div>
            <div v-if="squadronStore.deepDiveLoading && !(atleet?.activities?.length)" class="no-data mono-text">Laden…</div>
            <template v-else>
              <div
                v-for="(act, i) in activitiesList"
                :key="act.id || i"
                class="activity-row"
              >
                <span class="mono-text">{{ formatActivityDate(act.date) }}</span>
                <span class="activity-type">
                  <q-icon v-if="act.source === 'manual'" name="edit" size="xs" class="prime-icon" />
                  <q-icon v-else name="bolt" size="xs" class="strava-icon" />
                  {{ act.type || 'Session' }}
                </span>
                <span class="mono-text load-val">{{ formatMetric(act.load, 0) }}</span>
                <q-btn
                  v-if="act.source === 'manual'"
                  flat
                  round
                  dense
                  size="sm"
                  icon="delete"
                  color="negative"
                  class="activity-delete-btn"
                  aria-label="Sessie verwijderen"
                  :loading="deletingActivityId === act.id"
                  @click="confirmDeleteActivity(act)"
                />
              </div>
              <div v-if="!activitiesList.length" class="no-data mono-text">Geen activiteiten.</div>
            </template>
          </div>

          <!-- BOTTOM: Action Center -->
          <q-card-section class="action-center">
            <q-btn
              unelevated
              no-caps
              icon="auto_awesome"
              label="Genereer performance opdracht"
              color="amber"
              class="action-btn"
              :loading="false"
              @click="openReportDialog"
            />
          </q-card-section>
        </q-card-section>
      </q-card>
    </q-dialog>

    <WeekReportDialog
      v-model="reportDialogOpen"
      :athlete-id="atleet?.id || ''"
      :coach-notes="localNotes"
      :directive="directiveLabel"
      :injuries="injuryText"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useQuasar } from 'quasar'
import VueApexCharts from 'vue3-apexcharts'
import { useSquadronStore } from '../stores/squadron'
import { useAuthStore } from '../stores/auth'
import { formatMetric } from '../utils/formatters'
import { saveAthleteNotes, deleteManualActivity } from '../services/coachService'
import WeekReportDialog from './coach/WeekReportDialog.vue'
import DebugTimeline from './DebugTimeline.vue'

const $q = useQuasar()

const squadronStore = useSquadronStore()
const authStore = useAuthStore()

const deepDiveOpen = ref(false)
const reportDialogOpen = ref(false)
const localNotes = ref('')
const notesSaving = ref(false)
const notesSavedAt = ref(null)
const deletingActivityId = ref(null)
let notesDebounceTimer = null
const NOTES_DEBOUNCE_MS = 600

const activitiesList = computed(() => (atleet.value?.activities || []).slice(0, 10))

const atleet = computed(() => squadronStore.selectedAtleet)

const atleetDisplayName = computed(() => {
  const p = atleet.value
  if (!p) return 'Atleet'
  const profile = p.profile || {}
  if (profile.firstName) {
    const full = `${profile.firstName} ${profile.lastName || ''}`.trim()
    if (full) return full
  }
  if (p.name) return p.name
  const email = p.email || profile.email
  if (typeof email === 'string' && email.includes('@')) return email.split('@')[0]
  return 'Onbekend'
})

const directiveLabel = computed(() => {
  const p = atleet.value
  const d = p?.directive
  if (d && String(d).trim()) return String(d).trim()
  const acwr = p?.metrics?.acwr
  if (acwr != null && Number.isFinite(Number(acwr))) {
    const v = Number(acwr)
    if (v > 1.5) return 'REST'
    if (v > 1.3) return 'RECOVER'
    if (v >= 0.8 && v <= 1.3) return 'PUSH'
    if (v < 0.8) return 'DELOAD'
  }
  return 'Niet genoeg data'
})

const directiveBadgeClass = computed(() => {
  const d = directiveLabel.value.toUpperCase()
  if (d === 'PUSH') return 'directive-push'
  if (d === 'MAINTAIN' || d === 'DELOAD') return 'directive-maintain'
  if (d === 'RECOVER' || d === 'REST') return 'directive-rest'
  return 'directive-neutral'
})

const goalsText = computed(() => {
  const g = atleet.value?.profile?.goals
  if (Array.isArray(g) && g.length) return g.join(', ')
  if (g && typeof g === 'string') return g
  return ''
})

const successScenarioText = computed(() => {
  return atleet.value?.profile?.successScenario || ''
})

const injuryText = computed(() => {
  const inj = atleet.value?.profile?.injuryHistory ?? atleet.value?.profile?.injuries
  if (Array.isArray(inj) && inj.length) return inj.join(', ')
  if (inj && typeof inj === 'string') return inj
  return ''
})

const hasInjury = computed(() => !!injuryText.value?.trim())

const loadHistory = computed(() => atleet.value?.load_history || [])
const loadHistorySeries = computed(() => loadHistory.value.map((h) => h.dailyLoad ?? 0))

const atlChartOptions = computed(() => ({
  chart: { type: 'bar', background: 'transparent', toolbar: { show: false } },
  plotOptions: { bar: { columnWidth: '60%', distributed: false } },
  colors: ['#fbbf24'],
  xaxis: {
    categories: loadHistory.value.map((h) => (h.date || '').slice(5)),
    labels: { style: { colors: '#9ca3af', fontSize: '10px' } }
  },
  yaxis: { labels: { style: { colors: '#9ca3af' } }, title: { text: '' } },
  grid: { borderColor: 'rgba(255,255,255,0.06)', strokeDashArray: 2 },
  dataLabels: { enabled: false },
  legend: { show: false }
}))

const acwrColorClass = computed(() => {
  const v = Number(atleet.value?.metrics?.acwr)
  if (!Number.isFinite(v)) return ''
  if (v > 1.5) return 'text-negative'
  if (v >= 0.8 && v <= 1.3) return 'text-positive'
  return 'text-warning'
})

const ghostComparison = computed(() => atleet.value?.ghost_comparison || [])
const cxcSeries = computed(() => {
  const rows = ghostComparison.value.filter((r) => r.hrv != null || r.ghostHrv != null)
  if (!rows.length) return []
  return [
    { name: 'HRV', data: rows.map((r) => r.hrv ?? null) },
    { name: 'Vorige cyclus', data: rows.map((r) => r.ghostHrv ?? null) }
  ]
})

const cxcChartOptions = computed(() => {
  const categories = ghostComparison.value.map((r) => (r.date || '').slice(5))
  const rows = ghostComparison.value

  // Phase markers: vertical line at first cycleDay >= 15 (Luteal start), label at top
  let lutealCategory = null
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i].cycleDay
    if (d != null && d >= 15) {
      lutealCategory = categories[i] ?? ''
      break
    }
  }
  const follicularCategory = categories[0] ?? ''
  const xaxisAnnotations = []
  if (lutealCategory != null && lutealCategory !== follicularCategory) {
    xaxisAnnotations.push({
      x: lutealCategory,
      borderColor: 'rgba(255, 255, 255, 0.2)',
      strokeDashArray: 2,
      label: {
        borderColor: '#fbbf24',
        style: {
          background: '#050505',
          color: '#ffffff',
          fontSize: '10px',
          fontWeight: 700,
          fontFamily: 'Inter, sans-serif'
        },
        text: 'LUTEAL',
        position: 'top',
        offsetY: 0
      }
    })
    xaxisAnnotations.push({
      x: follicularCategory,
      borderColor: 'transparent',
      label: {
        borderColor: '#fbbf24',
        style: {
          background: '#050505',
          color: '#ffffff',
          fontSize: '10px',
          fontWeight: 700,
          fontFamily: 'Inter, sans-serif'
        },
        text: 'FOLLICULAR',
        position: 'top',
        offsetY: 0
      }
    })
  }

  return {
    chart: { type: 'line', background: 'transparent', toolbar: { show: false } },
    stroke: {
      curve: 'smooth',
      width: [3, 2],
      dashArray: [0, 6]
    },
    colors: ['#fbbf24', 'rgba(255, 255, 255, 0.2)'],
    plotOptions: {
      line: { dataLabels: { enabled: false } }
    },
    markers: {
      size: 4,
      hover: { size: 7, sizeOffset: 3 }
    },
    xaxis: {
      categories,
      labels: {
        style: {
          colors: '#9ca3af',
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif'
        }
      },
      axisBorder: { show: true, color: 'rgba(255, 255, 255, 0.08)' },
      axisTicks: { show: true, color: 'rgba(255, 255, 255, 0.08)' }
    },
    yaxis: {
      labels: {
        style: {
          colors: '#9ca3af',
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif'
        }
      },
      axisBorder: { show: true, color: 'rgba(255, 255, 255, 0.08)' },
      axisTicks: { show: true, color: 'rgba(255, 255, 255, 0.08)' }
    },
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.05)',
      strokeDashArray: 1,
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: true } }
    },
    legend: {
      position: 'top',
      fontSize: '11px',
      fontWeight: 600,
      fontFamily: 'Inter, sans-serif',
      labels: { colors: '#9ca3af' },
      itemMargin: { horizontal: 12 }
    },
    annotations: xaxisAnnotations.length ? { xaxis: xaxisAnnotations } : undefined,
    tooltip: {
      theme: 'dark',
      cssClass: 'cxc-tooltip',
      style: { fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' },
      y: { formatter: (v) => (v != null ? String(v) : '—') }
    }
  }
})

function onNotesInput() {
  if (notesDebounceTimer) clearTimeout(notesDebounceTimer)
  notesDebounceTimer = setTimeout(() => {
    if (!atleet.value?.id) return
    notesSaving.value = true
    notesSavedAt.value = null
    saveAthleteNotes(atleet.value.id, localNotes.value)
      .then(() => {
        notesSavedAt.value = Date.now()
      })
      .catch((err) => console.error('Save notes failed', err))
      .finally(() => {
        notesSaving.value = false
      })
  }, NOTES_DEBOUNCE_MS)
}

function openReportDialog() {
  reportDialogOpen.value = true
}

function confirmDeleteActivity(act) {
  if (!act?.id || act.source !== 'manual' || !atleet.value?.id) return
  $q.dialog({
    title: 'Sessie verwijderen',
    message: 'Weet je zeker dat je deze sessie wilt verwijderen? Dit beïnvloedt de Belastingsbalans.',
    cancel: { label: 'Annuleren', flat: true },
    ok: { label: 'Verwijderen', color: 'negative' },
    persistent: true,
  }).onOk(async () => {
    deletingActivityId.value = act.id
    try {
      await deleteManualActivity(act.id, atleet.value.id)
      $q.notify({ type: 'positive', message: 'Sessie verwijderd. Data wordt ververst.' })
      await squadronStore.fetchAtleetDeepDive(atleet.value.id)
    } catch (err) {
      $q.notify({ type: 'negative', message: err?.message || 'Verwijderen mislukt' })
    } finally {
      deletingActivityId.value = null
    }
  })
}

function formatActivityDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(String(dateStr).replace(/-/g, '/').slice(0, 10))
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function onDeepDiveClose() {
  squadronStore.clearSelectedAtleet()
  reportDialogOpen.value = false
  localNotes.value = ''
  notesSavedAt.value = null
  if (notesDebounceTimer) clearTimeout(notesDebounceTimer)
}

watch(atleet, (p) => {
  localNotes.value = (p?.adminNotes != null ? String(p.adminNotes) : '') || ''
}, { immediate: true })

watch(
  () => squadronStore.selectedAtleet,
  (val) => {
    if (val && !deepDiveOpen.value) deepDiveOpen.value = true
    if (!val && deepDiveOpen.value) deepDiveOpen.value = false
  }
)
</script>

<style scoped lang="scss">
@use '../css/quasar.variables' as q;

.coach-deep-dive { margin-top: 0; }

.dashboard-card {
  background: q.$prime-black !important;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  min-width: 480px;
  max-width: 720px;
  display: flex;
  flex-direction: column;
}

.dashboard-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 16px 20px;
}

.header-top { align-items: center; }
.atleet-name {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1.1rem;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.header-badges { flex-wrap: wrap; }
.directive-badge {
  font-family: q.$mono-font;
  font-size: 0.85rem;
  font-weight: 700;
  padding: 4px 10px;
  border: 1px solid;
  border-radius: 2px;
  text-transform: uppercase;
}
.directive-badge.directive-push {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.08);
}
.directive-badge.directive-maintain {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.5);
  background: rgba(251, 191, 36, 0.08);
}
.directive-badge.directive-rest {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.08);
}
.directive-badge.directive-neutral {
  color: #9ca3af;
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.03);
}

.compliance-wrap { align-items: center; }
.compliance-label {
  font-size: 0.65rem;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.compliance-bars { align-items: flex-end; }
.compliance-bar {
  width: 10px;
  height: 16px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 1px;
  transition: background 0.2s;
}
.compliance-bar.filled {
  background: #22c55e;
}
.compliance-value {
  font-size: 0.75rem;
  color: q.$prime-gray;
  margin-left: 4px;
}
.compliance-value.compliance-full {
  color: q.$prime-gold;
  font-weight: 700;
}
.streak-badge {
  font-size: 0.65rem;
  color: q.$prime-gold;
  margin-left: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.dashboard-body {
  padding: 16px 20px;
  flex: 1;
  overflow-y: auto;
}

.split-layout { gap: 24px; }
.left-panel { flex: 1; min-width: 0; }
.right-panel { width: 260px; flex-shrink: 0; }

.panel-label {
  font-family: q.$typography-font-family;
  font-size: 0.65rem;
  font-weight: 700;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 10px;
}

.chart-tile {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.chart-title {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.chart-sub { font-size: 0.65rem; color: q.$prime-gray; margin-top: 2px; }
.apex-wrap { min-height: 100px; }
.chart-tile-cxc { padding: 12px 14px; }
.apex-wrap-cxc {
  min-height: 450px;
  width: 100%;
}
.chart-empty { font-size: 0.75rem; color: q.$prime-gray; padding: 8px 0; }
.balance-value { font-size: 1.25rem; font-weight: 600; }

.sidebar-block {
  margin-bottom: 16px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
}
.sidebar-block.has-injury { border-color: rgba(239, 68, 68, 0.3); }
.block-title {
  font-size: 0.65rem;
  font-weight: 700;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}
.block-content {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.9);
  white-space: pre-wrap;
  word-break: break-word;
}
.block-content.injury-warning {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  padding: 8px;
  border-radius: 2px;
}
.mission-text { margin: 0 0 6px 0; }
.success-scenario { color: rgba(255, 255, 255, 0.7); font-size: 0.75rem; }
.no-data { font-size: 0.75rem; color: q.$prime-gray; }

.logbook-input :deep(.q-field__control) {
  background: rgba(255, 255, 255, 0.03) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}
.logbook-input :deep(textarea) {
  font-family: q.$mono-font;
  font-size: 0.8rem;
  min-height: 80px;
  color: #fff;
}
.notes-status { font-size: 0.65rem; color: q.$prime-gray; margin-top: 4px; }
.notes-status.saved { color: #22c55e; }

.timeline-expansion {
  margin-bottom: 16px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.02);
}
.timeline-expansion :deep(.q-item) {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: q.$prime-gray;
}
.timeline-expansion :deep(.q-expansion-item__content) {
  background: transparent;
}

.activities-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.activity-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  font-size: 0.8rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.activity-type { display: inline-flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.prime-icon { color: q.$prime-gold; }
.strava-icon { color: #fc4c02; }
.load-val { color: q.$prime-gold; min-width: 2.5rem; text-align: right; }
.activity-delete-btn { flex-shrink: 0; }

.action-center {
  padding: 16px 0 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.action-btn {
  width: 100%;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.mono-text { font-family: q.$mono-font; }

/* CxC tooltip: dark bg, white text, gold border (PrimeForm telemetry) */
:deep(.cxc-tooltip.apexcharts-tooltip) {
  background: #050505 !important;
  border: 1px solid q.$prime-gold !important;
  color: #ffffff !important;
  font-family: q.$mono-font;
  padding: 8px 12px;
  border-radius: 2px;
}
:deep(.cxc-tooltip.apexcharts-tooltip .apexcharts-tooltip-title),
:deep(.cxc-tooltip.apexcharts-tooltip .apexcharts-tooltip-series-group) {
  color: #ffffff !important;
}
</style>
