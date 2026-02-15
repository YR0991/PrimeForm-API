<template>
  <CoachDashboard v-if="authStore.isCoach" />
  <q-page v-else class="dashboard-page">
    <div class="dashboard-container">
      <!-- Header -->
      <div class="dashboard-header">
        <div class="brand">PRIMEFORM</div>
        <div class="subtitle">Atleet dashboard</div>
      </div>

      <!-- Today-first dashboard (daily brief) -->
      <q-card class="dashboard-card" flat>
        <q-inner-loading :showing="dashboardStore.loading" color="#fbbf24">
          <q-spinner-gears size="48px" color="#fbbf24" />
        </q-inner-loading>

        <q-card-section>
          <div class="dashboard-grid minimal-grid">
            <!-- A) VANDAAG — OPDRACHT (Dagopdracht card: deterministic copy from instructionClass + prescriptionHint) -->
            <div class="widget directive-widget">
              <q-banner v-if="needsCheckin" dense class="needs-checkin-banner bg-amber-9 text-black">
                Geen check-in vandaag. Vul readiness (en slaap) in voor een gericht advies.
                <template #action>
                  <q-btn flat no-caps label="Check-in invullen" @click="checkinDialog = true" />
                </template>
              </q-banner>
              <q-card v-if="needsCheckin" flat dark class="advice-card advice-card-placeholder">
                <q-card-section>
                  <div class="advice-header">
                    <span class="signal-dot signal-ORANGE">🟠</span>
                    <span class="tag-label mono">MAINTAIN</span>
                  </div>
                  <div class="text-h6 advice-title">Stabiel; train met mate.</div>
                  <div class="advice-subtitle caption">Vul je check-in in voor een advies op maat.</div>
                  <div class="advice-note caption text-grey-6 q-mt-sm">Status is neutraal omdat je vandaag nog geen check-in hebt gedaan.</div>
                </q-card-section>
                <q-card-actions class="directive-actions">
                  <q-btn unelevated no-caps class="btn-prebrief" label="Check-in invullen" @click="checkinDialog = true" />
                </q-card-actions>
              </q-card>
              <q-card v-else flat dark class="advice-card">
                <q-card-section class="q-pb-none">
                  <div class="advice-header">
                    <span class="signal-dot" :class="'signal-' + (brief?.status?.signal || 'ORANGE')">{{ signalEmoji(brief?.status?.signal) }}</span>
                    <span class="tag-label mono">{{ brief?.status?.tag ?? 'MAINTAIN' }}</span>
                    <span v-if="showBlindSpotBadge" class="blind-badge-subtle mono">Blind spot</span>
                  </div>
                  <div class="text-h6 advice-title">{{ adviceCopy.title }}</div>
                  <div class="advice-subtitle caption">{{ adviceCopy.summary }}</div>
                  <q-chip v-if="adviceCopy.badge" dense size="sm" class="advice-badge" color="amber-9" text-color="black">
                    {{ adviceCopy.badge }}
                  </q-chip>
                </q-card-section>
                <q-card-section class="q-pt-sm">
                  <div class="advice-opdracht-label mono">Opdracht</div>
                  <div class="advice-task mono">{{ adviceCopy.task }}</div>
                </q-card-section>
                <q-separator dark />
                <q-card-section class="q-pt-sm">
                  <div class="advice-waarom-label mono">Waarom</div>
                  <ul v-if="adviceCopy.whyBullets.length" class="advice-why-list">
                    <li v-for="(bullet, i) in adviceCopy.whyBullets" :key="i" class="mono">{{ bullet }}</li>
                  </ul>
                  <div v-else class="advice-why-empty caption">Geen extra context beschikbaar.</div>
                </q-card-section>
                <q-banner v-if="adviceCopy.guardrail" dense class="advice-guardrail bg-amber-9 text-black">
                  {{ adviceCopy.guardrail }}
                </q-banner>
                <q-card-actions class="directive-actions">
                  <q-btn
                    v-if="!hasTodayCheckIn"
                    unelevated
                    no-caps
                    class="btn-prebrief"
                    label="Start check-in"
                    @click="checkinDialog = true"
                  />
                  <q-btn
                    v-else
                    flat
                    no-caps
                    class="btn-prebrief-secondary"
                    label="Bekijk check-in"
                    @click="checkinDialog = true"
                  />
                  <q-btn
                    v-if="brief?.todayDirective?.detailsMarkdown"
                    flat
                    no-caps
                    class="btn-dagrapport mono"
                    label="Open dagrapport"
                    @click="dagrapportModal = true"
                  />
                </q-card-actions>
              </q-card>
            </div>

            <!-- TELEMETRY (28D) — HRV + RHR line chart -->
            <div class="widget telemetry-28d-card">
              <div class="widget-title">TELEMETRY (28D)</div>
              <div class="telemetry-28d-chart-wrap">
                <Line
                  v-if="telemetry28dChartData.labels.length"
                  :data="telemetry28dChartData"
                  :options="telemetry28dChartOptions"
                />
                <div v-else class="telemetry-28d-empty mono">
                  Geen HRV/RHR-data voor de laatste 28 dagen.
                </div>
              </div>
            </div>

            <!-- B) LOG -->
            <div class="widget telemetry-feed">
              <div class="telemetry-header">
                <div class="widget-title">LOG</div>
                <q-btn
                  v-if="isStravaConnected"
                  dense
                  flat
                  class="manual-toggle-btn mono"
                  label="Handmatig workout toevoegen"
                  @click="manualPanelOpen = !manualPanelOpen"
                />
              </div>

              <!-- Strava status: connection, last webhook, last sync, error/backoff, Sync nu -->
              <div v-if="isStravaConnected" class="strava-status mono">
                <span class="strava-status-badge connected">Strava gekoppeld</span>
                <template v-if="stravaMeta">
                  <span v-if="stravaMeta.lastWebhookAt" class="strava-meta">
                    Webhook: {{ formatStravaTime(stravaMeta.lastWebhookAt) }}
                    <span v-if="stravaMeta.lastWebhookEvent?.event_type" class="strava-meta-event">({{ stravaMeta.lastWebhookEvent.event_type }})</span>
                  </span>
                  <span v-if="stravaMeta.lastSyncedAt" class="strava-meta">Sync: {{ formatStravaTime(stravaMeta.lastSyncedAt) }}</span>
                  <span v-if="stravaBackoffActive" class="strava-meta strava-backoff">Rate limit — probeer later</span>
                  <span v-else-if="stravaMeta.lastError" class="strava-meta strava-error">{{ stravaMeta.lastError }}</span>
                </template>
                <q-btn
                  dense
                  flat
                  size="sm"
                  class="strava-sync-btn"
                  :disable="stravaBackoffActive || dashboardStore.syncing"
                  :loading="dashboardStore.syncing"
                  label="Sync nu"
                  @click="triggerStravaSync"
                />
              </div>

              <!-- Inline manual injection panel (openable from empty state or header) -->
              <div
                v-if="manualPanelOpen"
                class="manual-inline mono"
              >
                <div class="manual-row">
                  <span class="manual-label">Duur (min)</span>
                  <q-input
                    v-model.number="manualDuration"
                    type="number"
                    dense
                    borderless
                    class="manual-input"
                    input-class="manual-input-field"
                    :min="0"
                    :step="5"
                  />
                </div>
                <div class="manual-row manual-rpe-row">
                  <span class="manual-label">RPE</span>
                  <q-slider
                    v-model.number="manualRpe"
                    :min="1"
                    :max="10"
                    :step="1"
                    color="#fbbf24"
                    track-color="grey-8"
                    thumb-color="amber-5"
                  />
                  <span class="manual-rpe-value">
                    {{ manualRpe }}
                  </span>
                </div>
                <div class="manual-row manual-include-acwr-row">
                  <q-checkbox
                    v-model="manualIncludeInAcwr"
                    label="Meetellen in ACWR"
                    color="amber-5"
                    dense
                  />
                </div>
                <div class="manual-row manual-actions">
                  <div class="manual-load-preview">
                    Prime load:
                    <span class="highlight">
                      {{ manualPrimeLoadPreview }}
                    </span>
                  </div>
                  <q-btn
                    dense
                    unelevated
                    class="manual-submit-btn"
                    :disable="!canSubmitManual || manualSubmitting"
                    :loading="manualSubmitting"
                    label="Toevoegen"
                    @click="handleManualInject"
                  />
                </div>
              </div>

              <!-- Empty state: no activities and/or Strava not connected -->
              <div
                v-if="showLogEmptyState"
                class="log-empty-state"
              >
                <div class="log-empty-msg mono">
                  <template v-if="!isStravaConnected">Geen recente activiteiten. Koppel Strava of voer handmatig in.</template>
                  <template v-else>
                    Nieuwe runs verschijnen meestal binnen 1–2 min via webhook. Geen activiteiten? Klik <strong>Sync nu</strong> of wacht even.
                  </template>
                </div>
                <div class="log-empty-actions">
                  <q-btn
                    v-if="!isStravaConnected"
                    unelevated
                    no-caps
                    class="log-empty-btn-primary"
                    label="Strava koppelen"
                    :disable="!activeUid"
                    @click="connectStrava"
                  />
                  <q-btn
                    v-else
                    unelevated
                    no-caps
                    class="log-empty-btn-primary"
                    label="Sync nu"
                    :disable="stravaBackoffActive"
                    :loading="dashboardStore.syncing"
                    @click="triggerStravaSync"
                  />
                  <q-btn
                    dense
                    flat
                    no-caps
                    class="log-empty-btn-secondary mono"
                    label="Workout handmatig invoeren"
                    @click="manualPanelOpen = true"
                  />
                </div>
              </div>
              <q-list v-else dense class="telemetry-list">
                <q-item
                  v-for="act in recentActivities"
                  :key="act.id"
                  class="telemetry-item"
                >
                  <q-item-section avatar>
                    <div class="telemetry-icon-wrapper">
                      <q-icon
                        :name="activityIcon(act.type)"
                        size="sm"
                        color="orange"
                      />
                      <q-icon
                        v-if="act.source === 'manual'"
                        name="build"
                        size="xs"
                        class="manual-source-icon"
                      />
                    </div>
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
                      Prime load:
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

      <!-- Dagrapport modal (detailsMarkdown) -->
      <q-dialog v-model="dagrapportModal" persistent class="dagrapport-dialog">
        <q-card class="dashboard-card dagrapport-card" dark flat>
          <q-card-section class="dagrapport-header">
            <span class="widget-title">Dagrapport</span>
            <q-btn flat round dense icon="close" @click="dagrapportModal = false" />
          </q-card-section>
          <q-card-section class="dagrapport-body">
            <div v-if="brief?.todayDirective?.detailsMarkdown && renderedDagrapport" v-html="renderedDagrapport" class="dagrapport-prose" />
            <div v-else class="mono">Geen dagrapport beschikbaar.</div>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Daily Check-in Dialog -->
      <q-dialog v-model="checkinDialog" persistent class="checkin-dialog-dark" @show="checkinResult = null">
        <q-card class="checkin-dialog-card" dark>
          <!-- Result view: Dagopdracht card after successful submit -->
          <template v-if="checkinResult">
            <q-card-section class="checkin-dialog-section text-white">
              <div class="checkin-dialog-title">Dagopdracht</div>
              <div class="mono checkin-subtitle text-white">Je advies voor vandaag</div>
            </q-card-section>
            <q-card-section class="q-pt-none checkin-dialog-section text-white">
              <q-card flat dark class="advice-card">
                <q-card-section class="q-pb-none">
                  <div class="text-h6 advice-title">{{ checkinAdviceCopy.title }}</div>
                  <div class="advice-subtitle caption">{{ checkinAdviceCopy.summary }}</div>
                  <q-chip v-if="checkinAdviceCopy.badge" dense size="sm" class="advice-badge" color="amber-9" text-color="black">
                    {{ checkinAdviceCopy.badge }}
                  </q-chip>
                </q-card-section>
                <q-card-section class="q-pt-sm">
                  <div class="advice-opdracht-label mono">Opdracht</div>
                  <div class="advice-task mono">{{ checkinAdviceCopy.task }}</div>
                </q-card-section>
                <q-separator dark />
                <q-card-section class="q-pt-sm">
                  <div class="advice-waarom-label mono">Waarom</div>
                  <ul v-if="checkinAdviceCopy.whyBullets.length" class="advice-why-list">
                    <li v-for="(bullet, i) in checkinAdviceCopy.whyBullets" :key="i" class="mono">{{ bullet }}</li>
                  </ul>
                  <div v-else class="advice-why-empty caption">Geen extra context.</div>
                </q-card-section>
                <q-banner v-if="checkinAdviceCopy.guardrail" dense class="advice-guardrail bg-amber-9 text-black">
                  {{ checkinAdviceCopy.guardrail }}
                </q-banner>
              </q-card>
            </q-card-section>
            <q-card-actions align="right" class="checkin-dialog-actions">
              <q-btn unelevated no-caps label="Sluiten" class="bg-amber-9" @click="checkinResult = null; checkinDialog = false" />
            </q-card-actions>
          </template>
          <!-- Form view -->
          <template v-else>
          <q-card-section class="checkin-dialog-section text-white">
            <div class="checkin-dialog-title">Dagelijkse check-in</div>
            <div class="mono checkin-subtitle text-white">
              Vul je readiness en bio-signalen in voor vandaag.
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none checkin-dialog-section text-white">
            <div class="checkin-field">
              <div class="field-label mono">Trainingsbereidheid (1–10)</div>
              <div class="row items-center q-gutter-sm">
                <q-slider
                  v-model.number="checkinReadiness"
                  :min="1"
                  :max="10"
                  :step="1"
                  color="#fbbf24"
                  track-color="grey-8"
                  thumb-color="amber-5"
                  class="col"
                />
                <span class="mono readiness-slider-value">
                  {{ checkinReadiness }}/10 — {{ readinessLabelFor(checkinReadiness) }}
                </span>
              </div>
              <div class="mono readiness-hints">
                <div class="readiness-scale-row">
                  <span class="readiness-scale-label">1–3:</span>
                  <span class="readiness-scale-text">Herstel / Buiten gebruik</span>
                </div>
                <div class="readiness-scale-row">
                  <span class="readiness-scale-label">4–6:</span>
                  <span class="readiness-scale-text">Lage energie / Matig</span>
                </div>
                <div class="readiness-scale-row">
                  <span class="readiness-scale-label">7–8:</span>
                  <span class="readiness-scale-text">Stabiel / Heel goed</span>
                </div>
                <div class="readiness-scale-row">
                  <span class="readiness-scale-label">9–10:</span>
                  <span class="readiness-scale-text">Topvorm / Onstuitbaar</span>
                </div>
              </div>
            </div>

            <div class="checkin-field">
              <div class="field-label mono">HRV (ms)</div>
              <q-input
                v-model.number="checkinHrv"
                type="number"
                dense
                outlined
                dark
                class="checkin-input"
                input-class="mono"
                :min="0"
              />
            </div>

            <div class="checkin-field">
              <div class="field-label mono">RHR (bpm)</div>
              <q-input
                v-model.number="checkinRhr"
                type="number"
                dense
                outlined
                dark
                class="checkin-input"
                input-class="mono"
                :min="0"
              />
            </div>

            <div class="checkin-field">
              <div class="field-label mono">SLAAP (uur)</div>
              <div class="row items-center q-gutter-sm">
                <q-slider
                  v-model.number="checkinSleep"
                  :min="3"
                  :max="12"
                  :step="0.5"
                  color="#fbbf24"
                  track-color="grey-8"
                  thumb-color="amber-5"
                  class="col"
                />
                <span class="mono readiness-slider-value">{{ checkinSleep }}h</span>
              </div>
            </div>

            <div class="checkin-toggles">
              <q-btn
                :outline="!checkinMenstruationStarted"
                :unelevated="checkinMenstruationStarted"
                no-caps
                class="checkin-toggle-btn"
                :class="{ 'toggle-active': checkinMenstruationStarted }"
                label="Menstruatie gestart"
                @click="checkinMenstruationStarted = !checkinMenstruationStarted"
              />
              <q-btn
                :outline="!checkinIsSick"
                :unelevated="checkinIsSick"
                no-caps
                class="checkin-toggle-btn checkin-toggle-sick"
                :class="{ 'toggle-active': checkinIsSick }"
                label="Ziek / handrem"
                @click="checkinIsSick = !checkinIsSick"
              />
            </div>
          </q-card-section>
          <q-card-actions align="right" class="checkin-dialog-actions">
            <q-btn flat no-caps label="Annuleren" class="text-white" @click="checkinDialog = false" />
            <q-btn
              unelevated
              no-caps
              class="btn-prebrief"
              label="Check-in opslaan"
              :disable="!canSubmitCheckin"
              :loading="checkinSubmitting"
              @click="handleSubmitCheckin"
            />
          </q-card-actions>
          </template>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { useAuthStore } from '../stores/auth'
import { startStravaConnect } from '../services/stravaConnect.js'
import { useDashboardStore } from '../stores/dashboard'
import { getAdviceCopy } from '../lib/adviceCopy.js'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend
} from 'chart.js'
import { Line } from 'vue-chartjs'
import CoachDashboard from './coach/CoachDashboard.vue'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Tooltip, Legend)

const $q = useQuasar()
const authStore = useAuthStore()
const dashboardStore = useDashboardStore()

onMounted(() => {
  if (!dashboardStore.telemetry && !dashboardStore.loading) {
    dashboardStore.fetchUserDashboard().catch(() => {
      // error stored in store; UI stays graceful
    })
  }
})

// Webhook-first: no automatic Strava sync on dashboard load

function triggerStravaSync() {
  dashboardStore.syncNow().catch((err) => {
    $q.notify({
      type: 'warning',
      message: err?.message || 'Sync mislukt',
      caption: err?.message?.includes('Rate limit') ? 'Max 1x per 10 min.' : undefined
    })
  })
}

const telemetry = computed(() => dashboardStore.telemetry || {})

/** 28d telemetry for chart. Source: dashboard API → telemetry.raw.history_logs (reportService hrvHistory: { date, hrv, rhr }[]). */
function mapHistoryLogsTo28dTelemetry(historyLogs) {
  if (!Array.isArray(historyLogs) || !historyLogs.length) return []
  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 27)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return historyLogs
    .filter((h) => h && (h.date || '').slice(0, 10) >= cutoffStr && (h.date || '').slice(0, 10) <= today)
    .map((h) => ({
      date: (h.date || '').slice(0, 10),
      hrv: h.hrv != null && Number.isFinite(Number(h.hrv)) ? Number(h.hrv) : null,
      rhr: h.rhr != null && Number.isFinite(Number(h.rhr)) ? Number(h.rhr) : null
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const telemetry28dList = computed(() =>
  mapHistoryLogsTo28dTelemetry(telemetry.value?.raw?.history_logs)
)

const telemetry28dChartData = computed(() => {
  const list = telemetry28dList.value
  if (!list.length) return { labels: [], datasets: [] }
  return {
    labels: list.map((d) => d.date.slice(5)),
    datasets: [
      {
        label: 'HRV',
        data: list.map((d) => d.hrv),
        borderColor: '#fbbf24',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointBackgroundColor: '#fbbf24',
        spanGaps: true
      },
      {
        label: 'RHR',
        data: list.map((d) => d.rhr),
        borderColor: 'rgba(100, 116, 139, 0.9)',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointBackgroundColor: 'rgba(100, 116, 139, 0.9)',
        spanGaps: true
      }
    ]
  }
})

const telemetry28dChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top',
      labels: {
        color: 'rgba(255,255,255,0.8)',
        font: { size: 10 },
        usePointStyle: true
      }
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: 'rgba(255,255,255,0.7)', maxTicksLimit: 10 }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: 'rgba(255,255,255,0.7)' }
    }
  }
}))

const brief = computed(() => dashboardStore.dailyBrief || null)
const needsCheckin = computed(() => brief.value?.meta?.needsCheckin === true)
const dagrapportModal = ref(false)

const adviceCopy = computed(() => {
  const b = brief.value
  const tag = b?.status?.tag ?? 'MAINTAIN'
  const instructionClass = b?.status?.instructionClass ?? null
  const prescriptionHint = b?.status?.prescriptionHint ?? null
  const readiness = b?.inputs?.readiness ?? telemetry.value?.readinessToday ?? null
  const redFlagsCount = b?.inputs?.redFlagsCount ?? null
  const acwrBand = b?.inputs?.acwr?.band ?? null
  return getAdviceCopy({ tag, instructionClass, prescriptionHint, readiness, redFlagsCount, acwrBand })
})

const checkinAdviceCopy = computed(() => {
  const r = checkinResult.value
  if (!r?.recommendation) return getAdviceCopy({ tag: 'MAINTAIN' })
  const rec = r.recommendation
  const tag = rec.status ?? 'MAINTAIN'
  return getAdviceCopy({
    tag,
    instructionClass: rec.instructionClass ?? null,
    prescriptionHint: rec.prescriptionHint ?? null,
    readiness: checkinReadiness.value ?? null,
    redFlagsCount: r.metrics?.redFlags ?? null,
    acwrBand: null
  })
})

function signalEmoji(signal) {
  if (signal === 'GREEN') return '🟢'
  if (signal === 'RED') return '🔴'
  return '🟠'
}

const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'br']
const mdIt = new MarkdownIt({ html: false })

/** Render markdown to safe HTML: markdown-it (no raw HTML) + DOMPurify allowlist; links get target="_blank" and rel="noopener noreferrer". */
function renderSafeMarkdown(md) {
  if (md == null || typeof md !== 'string' || md.trim() === '') return ''
  const rawHtml = mdIt.render(md.trim())
  const hook = (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  }
  DOMPurify.addHook('afterSanitizeAttributes', hook)
  const out = DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'target', 'rel'] })
  DOMPurify.removeHook('afterSanitizeAttributes')
  return out
}

const renderedDagrapport = computed(() => {
  const md = brief.value?.todayDirective?.detailsMarkdown
  if (!md || typeof md !== 'string') return ''
  return renderSafeMarkdown(md)
})

const showBlindSpotBadge = computed(() => {
  const b = brief.value
  if (!b) return false
  if (b.confidence?.grade === 'C') return true
  const spots = b.confidence?.blindSpots ?? []
  if (spots.some((s) => /HRV vandaag|RHR vandaag/.test(String(s)))) return true
  const pct28 = b.compliance?.checkins28dPct
  if (pct28 != null && Number(pct28) < 40) return true
  return false
})

const readinessToday = computed(() => {
  const t = telemetry.value
  if (t.readinessToday != null) return t.readinessToday
  const raw = t.raw || {}
  if (raw.readiness_today != null) return raw.readiness_today
  if (raw.readiness != null) return raw.readiness
  return null
})

const hasTodayCheckIn = computed(() => readinessToday.value != null)

// Daily Check-in dialog state
const checkinDialog = ref(false)
const checkinResult = ref(null)
const checkinReadiness = ref(7)
const checkinSleep = ref(8)
const checkinHrv = ref(null)
const checkinRhr = ref(null)
const checkinMenstruationStarted = ref(false)
const checkinIsSick = ref(false)
const checkinSubmitting = ref(false)

const canSubmitCheckin = computed(() => {
  const r = Number(checkinReadiness.value)
  const h = Number(checkinHrv.value)
  const rr = Number(checkinRhr.value)
  const s = checkinSleep.value != null && checkinSleep.value !== '' ? Number(checkinSleep.value) : null
  if (!Number.isFinite(r) || r < 1 || r > 10) return false
  if (!Number.isFinite(h) || h <= 0) return false
  if (!Number.isFinite(rr) || rr <= 0) return false
  if (s != null && (!Number.isFinite(s) || s < 3 || s > 12)) return false
  return true
})

function readinessLabelFor(vRaw) {
  const v = Number(vRaw)
  if (!Number.isFinite(v)) return ''
  if (v === 10) return 'Onstuitbaar'
  if (v === 9) return 'Topvorm'
  if (v === 8) return 'Heel goed'
  if (v === 7) return 'Stabiel'
  if (v === 6) return 'Voldoende'
  if (v === 5) return 'Matig'
  if (v === 4) return 'Lage energie'
  if (v === 3) return 'Herstel nodig'
  if (v === 2) return 'Overbelast'
  if (v === 1) return 'Buiten gebruik'
  return ''
}

const handleSubmitCheckin = async () => {
  if (!canSubmitCheckin.value || checkinSubmitting.value) return
  try {
    checkinSubmitting.value = true
    const data = await dashboardStore.submitDailyCheckIn({
      readiness: checkinReadiness.value,
      hrv: checkinHrv.value,
      rhr: checkinRhr.value,
      sleep: checkinSleep.value,
      menstruationStarted: checkinMenstruationStarted.value,
      isSick: checkinIsSick.value,
    })
    await dashboardStore.fetchUserDashboard().catch(() => {})
    $q.notify({
      type: 'positive',
      color: 'amber-5',
      message: 'Daily check-in opgeslagen',
    })
    checkinResult.value = data ?? {}
  } catch (err) {
    console.error('submitDailyCheckIn failed', err)
    $q.notify({
      type: 'negative',
      message: err?.message || 'Daily check-in opslaan mislukt',
    })
  } finally {
    checkinSubmitting.value = false
  }
}

// Strava connection: auth store (from profile fetch — data.strava?.connected)
const isStravaConnected = computed(() => Boolean(authStore.stravaConnected))
const activeUid = computed(() => authStore.activeUid || authStore.user?.uid || null)

// Strava observability (dashboard strava_meta)
const stravaMeta = computed(() => telemetry.value?.raw?.strava_meta || null)
const stravaBackoffActive = computed(() => {
  const until = stravaMeta.value?.backoffUntil
  if (!until) return false
  return new Date(until).getTime() > Date.now()
})
function formatStravaTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return 'zojuist'
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`
  if (diff < 86400) return `${Math.floor(diff / 3600)} u geleden`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// LOG empty state: show when no activities or Strava not connected
const showLogEmptyState = computed(
  () => recentActivities.value.length === 0 || !isStravaConnected.value
)

// Strava connect: call backend with Authorization, then redirect to Location
async function connectStrava() {
  if (!activeUid.value) {
    $q.notify({ type: 'negative', message: 'Niet ingelogd. Log in om Strava te koppelen.' })
    return
  }
  try {
    await startStravaConnect()
  } catch (err) {
    $q.notify({ type: 'negative', message: err?.message || 'Strava koppelen mislukt.' })
  }
}

// Manual injection state
const manualDuration = ref(null)
const manualRpe = ref(5)
const manualIncludeInAcwr = ref(true)
const manualSubmitting = ref(false)
const manualPanelOpen = ref(false)

const manualPrimeLoadPreview = computed(() => {
  const d = Number(manualDuration.value)
  const r = Number(manualRpe.value)
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(r)) return '--'
  return Math.round(d * r)
})

const canSubmitManual = computed(() => {
  const d = Number(manualDuration.value)
  const r = Number(manualRpe.value)
  if (!Number.isFinite(d) || d <= 0) return false
  if (!Number.isFinite(r) || r < 1 || r > 10) return false
  return true
})

const handleManualInject = async () => {
  if (!canSubmitManual.value || manualSubmitting.value) return
  try {
    manualSubmitting.value = true
    await dashboardStore.injectManualSession({
      duration: manualDuration.value,
      rpe: manualRpe.value,
      includeInAcwr: manualIncludeInAcwr.value,
    })
    manualDuration.value = null
    manualPanelOpen.value = false
    $q.notify({ type: 'positive', color: 'amber-5', message: 'Workout toegevoegd' })
    await dashboardStore.fetchUserDashboard().catch(() => {})
  } catch (e) {
    console.error('Manual injection failed', e)
    const msg = e?.message || e?.response?.data?.error || 'Workout toevoegen mislukt'
    $q.notify({ type: 'negative', message: msg })
  } finally {
    manualSubmitting.value = false
  }
}

// Recent activities (Date, Type, Prime Load) — support backend _primeLoad and _dateStr
const recentActivities = computed(() => {
  const list = telemetry.value.activities || []
  return list.slice(0, 10).map((a) => ({
    id: a.id || a.activity_id || `${a.date || a.start_date || a._dateStr || ''}-${a.type || ''}`,
    type: a.type || a.sport_type || 'Session',
    date: a.date || a.start_date || a.start_date_local || a._dateStr || null,
    primeLoad: a.prime_load ?? a.primeLoad ?? a._primeLoad ?? a.load ?? null,
    source: a.source || a.activity_source || null,
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

.dashboard-page {
  background: #050505;
  min-height: 100vh;
  padding: 24px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.dashboard-container {
  max-width: 1100px;
  width: 100%;
}

.dashboard-header {
  margin-bottom: 16px;
}

.brand {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 700;
  font-style: italic;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  font-size: 0.9rem;
  color: #D4AF37;
}

.subtitle {
  margin-top: 4px;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #F5F5F5;
}

.dashboard-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.pre-briefing {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pre-brief-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pre-brief-summary {
  font-size: 0.8rem;
  color: rgba(209, 213, 219, 0.95);
}

.pre-brief-actions {
  margin-top: 8px;
}

.btn-prebrief {
  background: #fbbf24 !important;
  color: #050505 !important;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 2px;
}

.btn-prebrief-secondary {
  color: #fbbf24 !important;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.directive-label {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(156, 163, 175, 0.95);
  margin-right: 6px;
}

.directive-status {
  font-weight: 700;
  letter-spacing: 0.06em;
}

.directive-status.directive-rest {
  color: #ef4444;
}

.directive-status.directive-recover {
  color: #fbbf24;
}

.directive-status.directive-maintain {
  color: #fbbf24;
}

.directive-status.directive-push {
  color: #22c55e;
}

.directive-message {
  margin-top: 8px;
  padding: 8px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(209, 213, 219, 0.95);
  font-size: 0.85rem;
  line-height: 1.4;
}

/* Dagrapport modal — opaque, terminal-style, compact */
.dagrapport-dialog .q-dialog__backdrop {
  background: rgba(0, 0, 0, 0.75);
}

.dagrapport-card {
  background: #050505 !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 2px !important;
  min-width: 360px;
  max-width: 560px;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dagrapport-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #050505 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.dagrapport-body {
  overflow-y: auto;
  font-size: 0.875rem;
  line-height: 1.45;
  background: #050505 !important;
  color: rgba(229, 231, 235, 0.95);
}

.dagrapport-prose {
  font-size: 0.875rem;
  line-height: 1.45;
  color: rgba(229, 231, 235, 0.95);
  max-width: 72ch;
  margin-left: auto;
  margin-right: auto;
  padding-left: 4px;
  padding-right: 4px;
}

.dagrapport-prose h1,
.dagrapport-prose h2,
.dagrapport-prose h3 {
  font-size: inherit;
  font-weight: 800;
  text-transform: none;
  letter-spacing: normal;
  margin: 6px 0 2px;
  color: #f9fafb;
}

.dagrapport-prose h1:first-child,
.dagrapport-prose h2:first-child,
.dagrapport-prose h3:first-child {
  margin-top: 0;
}

.dagrapport-prose p {
  font-size: inherit;
  line-height: 1.45;
  margin: 6px 0;
}

.dagrapport-prose ul,
.dagrapport-prose ol {
  margin: 6px 0 6px 18px;
  padding-left: 8px;
}

.dagrapport-prose li {
  margin: 2px 0;
}

.dagrapport-prose code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 4px;
  border-radius: 2px;
}

.dagrapport-prose pre {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.82rem;
  padding: 10px;
  overflow-x: auto;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  margin: 6px 0;
}

.dagrapport-prose pre code {
  background: none;
  border: none;
  padding: 0;
}

.dagrapport-prose blockquote {
  border-left: 3px solid rgba(251, 191, 36, 0.5);
  padding-left: 10px;
  margin: 6px 0;
  color: #9ca3af;
}

.dagrapport-prose a {
  color: #fbbf24;
  text-decoration: underline;
}

.dagrapport-prose a:hover {
  color: #fcd34d;
}

.dagrapport-prose strong,
.dagrapport-prose b {
  font-weight: 700;
  color: #f9fafb;
}

/* Daily Check-in Dialog (Elite Dark — opaque, readable) */
.checkin-dialog-dark .q-dialog__backdrop {
  background: rgba(0, 0, 0, 0.7);
}

.checkin-dialog-card {
  background: #050505 !important;
  border: 1px solid rgba(251, 191, 36, 0.4) !important;
  border-radius: 2px !important;
  min-width: 360px;
  color: #ffffff;
}

.checkin-dialog-section {
  background: #050505 !important;
  color: #ffffff;
}

.checkin-dialog-title {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.9rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #fbbf24 !important;
  margin-bottom: 4px;
}

.checkin-dialog-card .field-label {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 4px;
}

.checkin-dialog-actions .q-btn {
  color: rgba(255, 255, 255, 0.9);
}

.checkin-dialog-actions .q-btn:hover {
  color: #fbbf24;
}

.checkin-dialog-card .q-field__control,
.checkin-dialog-card .q-field__native,
.checkin-dialog-card input {
  color: #ffffff !important;
}

.checkin-dialog-card .q-field--outlined .q-field__control:before {
  border-color: rgba(255, 255, 255, 0.2);
}

.checkin-dialog-card .q-slider__track {
  background: rgba(255, 255, 255, 0.15);
}

.checkin-field {
  margin-bottom: 16px;
}

.checkin-input {
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px;
}

.checkin-dialog-card .checkin-subtitle {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 10px;
}

.readiness-slider-value {
  min-width: 48px;
  color: #fbbf24;
  font-size: 0.85rem;
}

.readiness-hints {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.7rem;
  color: rgba(156, 163, 175, 0.9);
}

.readiness-scale-row {
  display: flex;
  gap: 4px;
}

.readiness-scale-label {
  width: 56px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.readiness-scale-text {
  flex: 1;
}

.checkin-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
  margin-bottom: 8px;
}

.checkin-toggle-btn {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(156, 163, 175, 0.95);
}

.checkin-toggle-btn.toggle-active {
  background: #fbbf24 !important;
  color: #050505 !important;
  border-color: #fbbf24;
}

.checkin-toggle-btn.checkin-toggle-sick.toggle-active {
  background: #ef4444 !important;
  color: #fff !important;
  border-color: #ef4444;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.minimal-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.advice-card { background: transparent !important; }
.advice-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.advice-title { font-size: 1.1rem; font-weight: 700; color: #f9fafb; margin-top: 4px; }
.advice-subtitle { color: #9ca3af; margin-top: 4px; }
.advice-badge { margin-top: 6px; }
.advice-opdracht-label { font-size: 0.8rem; letter-spacing: 0.04em; color: #9ca3af; margin-bottom: 4px; }
.advice-task { font-size: 0.9rem; color: #e5e7eb; }
.advice-waarom-label { font-size: 0.8rem; letter-spacing: 0.04em; color: #9ca3af; margin-bottom: 4px; }
.advice-why-list { list-style: none; padding-left: 0; margin: 4px 0 0; }
.advice-why-list li { position: relative; padding-left: 14px; margin: 4px 0; font-size: 0.85rem; color: #9ca3af; }
.advice-why-list li::before {
  content: ''; position: absolute; left: 0; top: 0.5em; width: 4px; height: 4px;
  border-radius: 999px; background: #fbbf24;
}
.advice-why-empty { color: #6b7280; }
.advice-guardrail { border-radius: 2px; }

.directive-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.signal-dot { font-size: 1rem; }
.signal-dot.signal-GREEN { color: #22c55e; }
.signal-dot.signal-ORANGE { color: #fbbf24; }
.signal-dot.signal-RED { color: #ef4444; }
.tag-label { font-weight: 700; letter-spacing: 0.08em; color: #f9fafb; }
.blind-badge-subtle {
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  color: #6b7280;
  opacity: 0.9;
}
.directive-one-liner { font-size: 0.85rem; color: #9ca3af; margin-bottom: 10px; }
.directive-list { list-style: none; padding-left: 0; margin: 4px 0 8px; }
.directive-list li { position: relative; padding-left: 14px; margin: 4px 0; }
.directive-list li::before {
  content: ''; position: absolute; left: 0; top: 0.5em; width: 4px; height: 4px;
  border-radius: 999px; background: #fbbf24;
}
.directive-stop { font-size: 0.78rem; color: #9ca3af; margin-top: 8px; }
.directive-opdracht-label { font-size: 0.8rem; letter-spacing: 0.04em; color: #9ca3af; margin-top: 8px; margin-bottom: 4px; }
.directive-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; align-items: center; }
.btn-dagrapport { color: #fbbf24 !important; font-size: 0.75rem; letter-spacing: 0.08em; }

.widget {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  padding: 16px 14px;
  background: rgba(15, 23, 42, 0.8);
}

.widget-title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #D4AF37;
  margin-bottom: 10px;
}

/* Readiness Gauge */
.readiness-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.8rem;
  color: rgba(243, 244, 246, 0.96);
}

.readiness-label-row,
.readiness-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.readiness-label {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(156, 163, 175, 0.9);
}

.readiness-value {
  font-weight: 600;
}

.readiness-gauge {
  margin: 4px 0;
}

.readiness-rail {
  position: relative;
  height: 4px;
  background: rgba(31, 41, 55, 0.9);
  border-radius: 2px;
  overflow: hidden;
}

.readiness-fill {
  height: 100%;
  transition: width 0.2s ease;
}

.zone-high.readiness-fill {
  background: #22c55e;
}

.zone-mid.readiness-fill {
  background: #fbbf24;
}

.zone-low.readiness-fill {
  background: #ef4444;
}

.zone-neutral.readiness-fill {
  background: rgba(156, 163, 175, 0.7);
}

.readiness-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 0.7rem;
  color: rgba(156, 163, 175, 0.9);
}

.readiness-status {
  font-weight: 600;
}

.zone-high.readiness-status {
  color: #22c55e;
}

.zone-mid.readiness-status {
  color: #fbbf24;
}

.zone-low.readiness-status {
  color: #ef4444;
}

.zone-neutral.readiness-status {
  color: rgba(156, 163, 175, 0.9);
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
.telemetry-28d-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  padding: 16px 14px;
}

.telemetry-28d-chart-wrap {
  height: 220px;
  position: relative;
}

.telemetry-28d-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(156, 163, 175, 0.8);
  font-size: 0.85rem;
}

.telemetry-feed {
  display: flex;
  flex-direction: column;
}

.telemetry-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.strava-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  font-size: 0.7rem;
  color: rgba(156, 163, 175, 0.9);
  margin-bottom: 10px;
}
.strava-status-badge.connected {
  color: #22c55e;
  font-weight: 600;
}
.strava-meta { color: rgba(156, 163, 175, 0.85); }
.strava-meta-event { opacity: 0.9; }
.strava-backoff { color: #fbbf24; }
.strava-error { color: #ef4444; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.strava-sync-btn { font-size: 0.7rem; color: #fbbf24; margin-left: auto; }

.manual-toggle-btn {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #fbbf24;
  padding: 2px 6px;
}

.telemetry-empty {
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.95);
}

.telemetry-sync-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.95);
}

.log-empty-state {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-empty-msg {
  font-size: 0.8rem;
  color: #9ca3af;
}

.log-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.log-empty-btn-primary {
  background: #fbbf24 !important;
  color: #050505 !important;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 2px;
  padding: 6px 12px;
}

.log-empty-btn-secondary {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: #9ca3af;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
}

.log-empty-btn-secondary:hover {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.4);
}

.telemetry-list {
  margin-top: 4px;
}

.telemetry-item {
  padding: 6px 4px;
}

.telemetry-icon-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.manual-source-icon {
  position: absolute;
  bottom: -4px;
  right: -4px;
  color: #fbbf24;
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

/* Manual Injection */
.manual-injection,
.manual-inline {
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  padding: 12px 10px;
}

.manual-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.75rem;
  color: rgba(229, 231, 235, 0.96);
}

.manual-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.manual-label {
  min-width: 110px;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(156, 163, 175, 0.95);
}

.manual-input {
  flex: 1;
  border: 1px solid rgba(75, 85, 99, 0.9);
  border-radius: 2px;
  padding-left: 6px;
  background: rgba(15, 23, 42, 0.9);
}

.manual-input-field {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.8rem;
  color: #fbbf24;
}

.manual-rpe-row {
  align-items: center;
}

.manual-rpe-value {
  width: 28px;
  text-align: right;
  color: #fbbf24;
  font-size: 0.8rem;
}

.manual-include-acwr-row {
  margin-top: 4px;
}

.manual-actions {
  justify-content: space-between;
}

.manual-load-preview {
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.95);
}

.manual-submit-btn {
  background-color: #fbbf24;
  color: #050505;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border-radius: 2px;
  padding: 4px 10px;
}
</style>