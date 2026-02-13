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
          <div class="dashboard-grid today-first-grid">
            <!-- Row1: VANDAAG — DIRECTIEF (dominant) + HERSTEL -->
            <div class="widget directive-widget">
              <div class="widget-title">VANDAAG — DIRECTIEF</div>
              <div class="directive-header">
                <span class="signal-dot" :class="'signal-' + (brief?.status?.signal || 'ORANGE')">{{ signalEmoji(brief?.status?.signal) }}</span>
                <span class="tag-label mono">{{ brief?.status?.tag ?? 'MAINTAIN' }}</span>
                <span v-if="showBlindSpotBadge" class="blind-badge-subtle mono">Blind spot</span>
              </div>
              <div class="directive-one-liner mono">{{ brief?.status?.oneLiner ?? 'Stabiel; train met mate.' }}</div>
              <ul class="directive-list">
                <li v-for="(item, i) in (brief?.todayDirective?.doToday ?? ['Train volgens hoe je je voelt.']).slice(0, 3)" :key="'do-' + i" class="mono">{{ item }}</li>
              </ul>
              <div class="directive-why-label mono">Waarom</div>
              <ul class="directive-list">
                <li v-for="(item, i) in (brief?.todayDirective?.why ?? ['Data ontbreekt.']).slice(0, 3)" :key="'why-' + i" class="mono">{{ item }}</li>
              </ul>
              <div class="directive-stop mono">Stopregel: {{ brief?.todayDirective?.stopRule ?? 'Bij twijfel: intensiteit omlaag.' }}</div>
              <q-btn
                v-if="brief?.todayDirective?.detailsMarkdown"
                flat
                no-caps
                class="btn-dagrapport mono"
                label="Open dagrapport"
                @click="dagrapportModal = true"
              />
              <q-btn
                v-if="!hasTodayCheckIn"
                unelevated
                no-caps
                class="btn-prebrief q-mt-sm"
                label="Start dagelijkse check-in"
                @click="checkinDialog = true"
              />
              <q-btn
                v-else
                flat
                no-caps
                class="btn-prebrief-secondary q-mt-sm"
                label="Bekijk dagelijkse check-in"
                @click="checkinDialog = true"
              />
            </div>

            <div class="widget recovery-widget">
              <div class="widget-title">HERSTEL</div>
              <div class="recovery-body mono">
                <template v-if="brief?.inputs?.recovery">
                  <div class="recovery-row">
                    <span class="recovery-label">HRV vs 28d</span>
                    <span class="highlight">{{ brief.inputs.recovery.hrvVs28dPct != null ? brief.inputs.recovery.hrvVs28dPct + '%' : 'Blind spot' }}</span>
                  </div>
                  <div class="recovery-row">
                    <span class="recovery-label">RHR delta</span>
                    <span class="highlight">{{ brief.inputs.recovery.rhrDelta != null ? (brief.inputs.recovery.rhrDelta >= 0 ? '+' : '') + brief.inputs.recovery.rhrDelta : 'Blind spot' }}</span>
                  </div>
                </template>
                <template v-else>
                  <div class="recovery-row"><span class="recovery-label">HRV vs 28d</span><span>Blind spot</span></div>
                  <div class="recovery-row"><span class="recovery-label">RHR delta</span><span>Blind spot</span></div>
                </template>
              </div>
            </div>

            <!-- Row2: LOAD RISK / CYCLE CONTEXT / DATA QUALITY / INTERNAL COST -->
            <div class="widget load-risk-widget">
              <div class="widget-title">LOAD RISK</div>
              <div class="load-risk-body mono">
                <template v-if="brief?.inputs?.acwr != null">
                  <div class="acwr-brief-value">{{ brief.inputs.acwr.value != null ? Number(brief.inputs.acwr.value).toFixed(2) : '—' }}</div>
                  <div class="acwr-band">{{ brief.inputs.acwr.band ?? '—' }}</div>
                </template>
                <template v-else>
                  <div class="acwr-brief-value">—</div>
                  <div class="acwr-band">Blind spot</div>
                </template>
              </div>
            </div>

            <div class="widget cycle-context-widget">
              <div class="widget-title">CYCLE CONTEXT</div>
              <div class="cycle-context-body mono">
                <template v-if="brief?.inputs?.cycle">
                  <div>{{ brief.inputs.cycle.mode ?? 'UNKNOWN' }}</div>
                  <div>Vertrouwen: {{ brief.inputs.cycle.confidence ?? '—' }}</div>
                  <div v-if="brief.inputs.cycle.phase">{{ brief.inputs.cycle.phase }} · dag {{ brief.inputs.cycle.phaseDay ?? '?' }}</div>
                  <div v-else>—</div>
                  <div v-if="cycleContextOff" class="cycle-context-off mono">Cycluscontext staat uit → advies draait op load + HRV/RHR.</div>
                  <router-link v-if="cycleContextOff" to="/profile" class="cycle-cta-link">Stel cyclusmodus in</router-link>
                </template>
                <template v-else>
                  <div>Blind spot</div>
                  <router-link to="/profile" class="cycle-cta-link">Stel cyclusmodus in</router-link>
                </template>
              </div>
            </div>

            <div class="widget data-quality-widget">
              <div class="widget-title">DATA QUALITY</div>
              <div class="data-quality-body mono">
                <div>Check-ins 7d <span class="target-label">(streef ≥70%)</span>: <span :class="compliance7dClass">{{ brief?.compliance?.checkins7dPct != null ? brief.compliance.checkins7dPct + '%' : 'Blind spot' }}</span></div>
                <div>Check-ins 28d <span class="target-label">(streef ≥60%)</span>: <span :class="compliance28dClass">{{ brief?.compliance?.checkins28dPct != null ? brief.compliance.checkins28dPct + '%' : 'Blind spot' }}</span></div>
                <div>Ontbrekend HRV (28d): {{ brief?.compliance?.missingHrvDays != null ? brief.compliance.missingHrvDays : '—' }}</div>
                <div>Ontbrekend RHR (28d): {{ brief?.compliance?.missingRhrDays != null ? brief.compliance.missingRhrDays : '—' }}</div>
                <div class="data-quality-microcopy">Hoe hoger compliance, hoe strakker het advies.</div>
              </div>
            </div>

            <div class="widget internal-cost-widget">
              <div class="widget-title">INTERNAL COST</div>
              <div class="internal-cost-body mono">
                <template v-if="brief?.internalCost">
                  <div :class="'cost-state cost-' + (brief.internalCost.state || 'NORMAL')">{{ brief.internalCost.state }}</div>
                  <div class="cost-explanation">{{ internalCostExplanation }}</div>
                </template>
                <template v-else>
                  <div class="cost-state">—</div>
                  <div class="cost-explanation">Blind spot: internal cost niet berekend.</div>
                </template>
              </div>
            </div>

            <!-- Row3: NEXT 48H + WEEK-STATUS -->
            <div class="widget next48-widget">
              <div class="widget-title">NEXT 48H</div>
              <div class="next48-body mono">
                <div><strong>Vandaag:</strong> {{ brief?.next48h?.today ?? '—' }}</div>
                <div><strong>Morgen:</strong> {{ brief?.next48h?.tomorrow ?? '—' }}</div>
                <div class="next48-trigger next48-trigger-mono">{{ formattedNext48Trigger }}</div>
              </div>
            </div>

            <div class="widget week-status-widget">
              <div class="widget-title">WEEK-STATUS</div>
              <div class="week-status-body mono">
                <div>Laatste 7 dagen — load totaal: {{ brief?.inputs?.activity?.last7dLoadTotal != null ? brief.inputs.activity.last7dLoadTotal : 'Blind spot' }}</div>
                <div>
                  Laatste 7 dagen — High-intensity exposures:
                  <q-icon name="info" size="14px" class="q-ml-xs">
                    <q-tooltip anchor="top middle" self="bottom middle" class="mono">Sessies met gem. HR ≥85% max HR of suffer score ≥80.</q-tooltip>
                  </q-icon>
                  {{ brief?.inputs?.activity?.hardExposures7d != null ? brief.inputs.activity.hardExposures7d : 'Blind spot' }}
                </div>
                <div>Laatste 7 dagen — grootste load: {{ formatLargestLoad7d(brief?.inputs?.activity?.largestLoad7d) }}</div>
              </div>
            </div>

            <!-- HRV TREND (full-width) -->
            <div class="hrv-chart-full">
              <HRVHistoryChart :history-logs="historyLogs" />
            </div>

            <!-- Row4: INTAKE + LOG -->
            <div class="widget intake-widget">
              <div class="widget-title">INTAKE</div>
              <div class="intake-body mono">
                <template v-if="brief?.intake && (brief.intake.goal || brief.intake.eventDate || brief.intake.sportFocus)">
                  <div v-if="brief.intake.goal"><strong>Doel:</strong> {{ brief.intake.goal }}</div>
                  <div v-if="brief.intake.eventDate"><strong>Event:</strong> {{ brief.intake.eventDate }}</div>
                  <div v-if="brief.intake.sportFocus"><strong>Sport:</strong> {{ brief.intake.sportFocus }}</div>
                  <div v-if="brief.intake.availabilityDaysPerWeek != null">Dagen/week: {{ brief.intake.availabilityDaysPerWeek }}</div>
                  <div v-if="brief.intake.oneLineNotes">{{ brief.intake.oneLineNotes }}</div>
                </template>
                <template v-else>
                  <div class="intake-prompts">
                    <div>Doel?</div>
                    <div>Eventdatum?</div>
                    <div>Sport / focus?</div>
                  </div>
                  <router-link to="/profile" class="intake-cta-btn">Vul intake aan</router-link>
                </template>
              </div>
            </div>

            <div class="widget telemetry-feed">
              <div class="telemetry-header">
                <div class="widget-title">LOG</div>
                <q-btn
                  v-if="hasStravaConnection"
                  dense
                  flat
                  class="manual-toggle-btn mono"
                  label="Handmatig workout toevoegen"
                  @click="manualPanelOpen = !manualPanelOpen"
                />
              </div>

              <!-- Inline manual injection panel when Strava is connected -->
              <div
                v-if="hasStravaConnection && manualPanelOpen"
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

              <div
                v-if="hasStravaConnection && recentActivities.length === 0"
                class="telemetry-sync-state"
              >
                <q-spinner v-if="dashboardStore.syncing" size="24" color="amber-5" class="q-mr-sm" />
                <span v-if="dashboardStore.syncing" class="mono">Historie synchroniseren…</span>
                <template v-else>
                  <span class="mono telemetry-empty">Nog geen activiteiten.</span>
                  <q-btn
                    dense
                    flat
                    no-caps
                    class="manual-toggle-btn q-mt-sm"
                    label="Data importeren"
                    :loading="dashboardStore.syncing"
                    @click="triggerStravaSync"
                  />
                </template>
              </div>
              <div v-else-if="!hasStravaConnection && recentActivities.length === 0" class="telemetry-empty mono">
                Geen recente activiteiten.
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
      <q-dialog v-model="checkinDialog" persistent class="checkin-dialog-dark">
        <q-card class="checkin-dialog-card" dark>
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
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { useAuthStore } from '../stores/auth'
import { useDashboardStore } from '../stores/dashboard'
import CoachDashboard from './coach/CoachDashboard.vue'
import HRVHistoryChart from '../components/HRVHistoryChart.vue'

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

// Auto-trigger Strava sync once when connected but no activities (so Recent Telemetry fills)
const stravaSyncTriggered = ref(false)
watch(
  () => ({
    loading: dashboardStore.loading,
    connected: authStore.stravaConnected,
    activities: (dashboardStore.telemetry?.activities || []).length,
  }),
  (curr) => {
    if (curr.loading || stravaSyncTriggered.value) return
    if (curr.connected && curr.activities === 0) {
      stravaSyncTriggered.value = true
      dashboardStore.syncStrava().catch(() => {
        stravaSyncTriggered.value = false
      })
    }
  },
  { immediate: true }
)

function triggerStravaSync() {
  dashboardStore.syncStrava().catch(() => {})
}

const telemetry = computed(() => dashboardStore.telemetry || {})
const brief = computed(() => dashboardStore.dailyBrief || null)
const dagrapportModal = ref(false)

function signalEmoji(signal) {
  if (signal === 'GREEN') return '🟢'
  if (signal === 'RED') return '🔴'
  return '🟠'
}

/** Format largestLoad7d for WEEK-STATUS: null → "—"; object → "YYYY-MM-DD · TYPE · LOAD" (omit missing parts); number → as-is */
function formatLargestLoad7d(val) {
  if (val == null) return '—'
  if (typeof val === 'number' && Number.isFinite(val)) return String(val)
  if (typeof val !== 'object') return '—'
  const date = val.date ?? val.start_date ?? val.dateStr ?? null
  const dateStr = date != null ? String(date).slice(0, 10) : null
  const type = val.type ?? val.activity_type ?? null
  const typeStr = type != null && type !== '' ? String(type) : null
  const load = val.load ?? val.prime_load ?? null
  const loadStr = load != null && Number.isFinite(Number(load)) ? String(Number(load)) : null
  const parts = [dateStr, typeStr, loadStr].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
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

const cycleContextOff = computed(() => {
  const c = brief.value?.inputs?.cycle
  if (!c) return true
  return c.mode === 'UNKNOWN' || c.confidence === 'LOW'
})

const compliance7dClass = computed(() => {
  const pct = brief.value?.compliance?.checkins7dPct
  if (pct == null || !Number.isFinite(Number(pct))) return ''
  const v = Number(pct)
  if (v >= 70) return 'compliance-ok'
  if (v >= 40) return 'compliance-warn'
  return 'compliance-low'
})

const compliance28dClass = computed(() => {
  const pct = brief.value?.compliance?.checkins28dPct
  if (pct == null || !Number.isFinite(Number(pct))) return ''
  const v = Number(pct)
  if (v >= 60) return 'compliance-ok'
  if (v >= 40) return 'compliance-warn'
  return 'compliance-low'
})

const internalCostExplanation = computed(() => {
  const cost = brief.value?.internalCost
  const rec = brief.value?.inputs?.recovery
  if (!cost) return ''
  const parts = []
  if (rec?.hrvVs28dPct != null && Number.isFinite(rec.hrvVs28dPct)) {
    const delta = rec.rhrDelta != null && Number.isFinite(rec.rhrDelta) ? (rec.rhrDelta >= 0 ? '+' : '') + rec.rhrDelta : '?'
    parts.push(`HRV ~${rec.hrvVs28dPct}% baseline, RHR delta ${delta}`)
  }
  const expl = cost.explanation ?? ''
  if (expl) parts.push(expl)
  if (parts.length === 0) return 'Geen verhoogde interne belasting.'
  return parts.join(' → ')
})

const formattedNext48Trigger = computed(() => {
  const t = brief.value?.next48h?.trigger
  if (!t || typeof t !== 'string') return '—'
  return 'IF HRV↓ en RHR↑ morgen → THEN intensiteit laag houden.'
})

const historyLogs = computed(() => telemetry.value.raw?.history_logs || [])

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
  const s = Number(checkinSleep.value)
  if (!Number.isFinite(r) || r < 1 || r > 10) return false
  if (!Number.isFinite(h) || h <= 0) return false
  if (!Number.isFinite(rr) || rr <= 0) return false
  if (!Number.isFinite(s) || s < 3 || s > 12) return false
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
    await dashboardStore.submitDailyCheckIn({
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
    checkinDialog.value = false
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

// Strava connection: use auth store so connection status is visible even before dashboard payload
const hasStravaConnection = computed(() => Boolean(authStore.stravaConnected))

// Manual injection state
const manualDuration = ref(null)
const manualRpe = ref(5)
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
    })
    // reset duration, keep RPE where it is
    manualDuration.value = null
  } catch (e) {
    // error already surfaced via store or console; keep dashboard silent
    console.error('Manual injection failed', e)
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

/* Dagrapport modal prose — compact terminal-style typography only */
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

.dagrapport-prose h1 {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  margin: 0 0 10px;
  color: #f9fafb;
}

.dagrapport-prose h2 {
  font-size: 0.95rem;
  font-weight: 800;
  margin: 16px 0 8px;
  color: #f9fafb;
}

.dagrapport-prose h3 {
  font-size: 0.85rem;
  font-weight: 700;
  margin: 14px 0 6px;
  color: #fbbf24;
}

.dagrapport-prose p {
  font-size: 0.875rem;
  line-height: 1.45;
  margin: 8px 0;
}

.dagrapport-prose ul,
.dagrapport-prose ol {
  margin: 8px 0 8px 18px;
  padding-left: 8px;
}

.dagrapport-prose li {
  margin: 4px 0;
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
  padding: 12px;
  overflow-x: auto;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  margin: 8px 0;
}

.dagrapport-prose pre code {
  background: none;
  border: none;
  padding: 0;
}

.dagrapport-prose blockquote {
  border-left: 3px solid rgba(251, 191, 36, 0.5);
  padding-left: 12px;
  margin: 8px 0;
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

.today-first-grid .directive-widget {
  grid-column: 1 / -1;
}
@media (min-width: 900px) {
  .today-first-grid .directive-widget { grid-column: span 2; }
  .today-first-grid .recovery-widget { grid-column: span 1; }
}

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
.directive-why-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: #9ca3af; margin-top: 8px; margin-bottom: 4px; }
.directive-stop { font-size: 0.78rem; color: #9ca3af; margin-top: 8px; }
.btn-dagrapport { color: #fbbf24 !important; font-size: 0.75rem; letter-spacing: 0.08em; }

.recovery-body { font-size: 0.85rem; }
.recovery-row { display: flex; justify-content: space-between; margin: 4px 0; }
.recovery-label { color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; }

.load-risk-body { font-size: 0.85rem; }
.acwr-brief-value { font-size: 1.2rem; font-weight: 600; color: #fbbf24; }
.acwr-band { font-size: 0.75rem; color: #9ca3af; margin-top: 4px; }

.cycle-context-body, .data-quality-body, .internal-cost-body { font-size: 0.85rem; }
.cycle-context-off { font-size: 0.78rem; color: #9ca3af; margin-top: 6px; }
.cycle-cta-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 0.75rem;
  color: #fbbf24;
  text-decoration: none;
  letter-spacing: 0.06em;
}
.cycle-cta-link:hover { text-decoration: underline; }
.target-label { font-size: 0.7rem; color: #6b7280; font-weight: normal; }
.compliance-ok { color: #22c55e; }
.compliance-warn { color: #fbbf24; }
.compliance-low { color: #ef4444; }
.data-quality-microcopy { font-size: 0.78rem; color: #9ca3af; margin-top: 8px; font-style: italic; }
.cost-state { font-weight: 700; }
.cost-state.cost-LOW { color: #22c55e; }
.cost-state.cost-ELEVATED { color: #ef4444; }
.cost-state.cost-NORMAL { color: #fbbf24; }
.cost-explanation { font-size: 0.78rem; color: #9ca3af; margin-top: 4px; }

.next48-body, .week-status-body { font-size: 0.85rem; }
.next48-trigger { font-size: 0.78rem; color: #9ca3af; margin-top: 6px; }
.next48-trigger-mono { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; }

.intake-body { font-size: 0.85rem; }
.intake-body div { margin: 4px 0; }
.intake-prompts { font-size: 0.8rem; color: #9ca3af; margin-bottom: 8px; }
.intake-prompts div { margin: 2px 0; }
.intake-cta-btn {
  display: inline-block;
  margin-top: 6px;
  font-size: 0.75rem;
  color: #fbbf24;
  text-decoration: none;
  letter-spacing: 0.06em;
}
.intake-cta-btn:hover { text-decoration: underline; }

.dagrapport-dialog .q-dialog__backdrop { background: rgba(0, 0, 0, 0.75); }
.dagrapport-card { max-width: 560px; max-height: 85vh; overflow: hidden; display: flex; flex-direction: column; }
.dagrapport-header { display: flex; justify-content: space-between; align-items: center; }
.dagrapport-body { overflow-y: auto; font-size: 0.9rem; }

.hrv-chart-full {
  grid-column: 1 / -1;
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
.telemetry-feed {
  display: flex;
  flex-direction: column;
}

.telemetry-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

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