# Global Search Audit — Term Occurrences

**Scope:** Codebase-wide grep for specified terms. Per term: files + one-line context.

---

## ACWR

| File | Context |
|------|--------|
| `PrimeForm-backed/routes/dashboardRoutes.js` | Returns telemetry (ACWR, phase, todayLog) for cockpit. |
| `PrimeForm-backed/services/calculationService.js` | `calculateACWR(acuteLoad7d, chronicLoad28d)` — ratio; 0 or 1 if chronic === 0. |
| `PrimeForm-backed/services/dailyBriefService.js` | `acwrBand(acwr)`, `statusTag(acwr, isSick)`; blind spot "ACWR niet berekend". |
| `PrimeForm-backed/services/reportService.js` | `calculateACWR` used; acute = 7d total, chronic = sum28/4; load_ratio returned as acwr. |
| `PrimeForm-backed/services/coachService.js` | `acwrToStatus`, `acwrToDirective`; ACWR from reportService.getDashboardStats. |
| `PrimeForm-backed/routes/dailyRoutes.js` | `calculateACWR(acuteLoad, chronicLoad)`; acwr written to user stats. |
| `PrimeForm-backed/routes/adminRoutes.js` | Enrich users with acwr for status dots; directive derived from acwr bands. |
| `PrimeForm-backed/knowledge/logic.md` | ACWR interpretatie: <0.8 Detraining, 0.8–1.3 Sweet Spot, 1.3–1.5 Warning, >1.5 Danger. |
| `PrimeForm-backed/services/aiService.js` | Load numbers from reportService; prompt says use Belastingsbalans, never "ACWR" in output. |
| `PrimeForm/src/stores/dashboard.js` | `acwr: data.acwr ?? data.ACWR`; getter loadStatus maps acwr to DANGER/OVERREACHING/OPTIMAL. |
| `PrimeForm/src/pages/coach/CoachDashboard.vue` | Column "Belastingsbalans (was ACWR)"; `inferDirectiveFromAcwr`, `acwrColorClass`. |
| `PrimeForm/src/pages/user/ProfilePage.vue` | Label "Waarschuwing bij hoog risico (ACWR > 1.3)". |
| `PrimeForm/src/pages/admin/AdminPage.vue` | `directiveFromAcwr(acwr)`; report table ACWR styling. |
| `PrimeForm/src/components/CoachDeepDive.vue` | Chart title "Belastingsbalans"; `formatMetric(atleet?.metrics?.acwr)`. |
| `PrimeForm/src/stores/squadron.js` | Count athletes with acwr > 1.5; display acwr from metrics. |
| `PrimeForm/src/services/telemetryService.js` | Recompute stats including ACWR on user document. |
| `PrimeForm/docs/BACKEND_FIRST_LEGACY_AUDIT.md` | loadStatus getter uses acwr from API. |

---

## Belastingsbalans

| File | Context |
|------|--------|
| `PrimeForm-backed/services/aiService.js` | Prompt: use "Belastingsbalans" not "ACWR"; stats string "Belastingsbalans X.XX". |
| `PrimeForm/src/pages/coach/CoachDashboard.vue` | Comment "Belastingsbalans (was ACWR)"; metric-label "Belastingsbalans". |
| `PrimeForm/src/components/CoachDeepDive.vue` | Chart title "Belastingsbalans"; delete confirmation "beïnvloedt de Belastingsbalans". |

**Conclusion:** Backend uses `acwr` in data; frontend coach/admin UIs show label "Belastingsbalans". AI prompts explicitly forbid "ACWR" in user-facing text.

---

## Directive / Opdracht

| File | Context |
|------|--------|
| `PrimeForm-backed/services/dailyBriefService.js` | `statusTag(acwr, isSick)` → tag; `buildTodayDirective` → doToday, why, stopRule, detailsMarkdown. |
| `PrimeForm-backed/services/coachService.js` | `acwrToDirective(acwr)` → PUSH, MAINTAIN, RECOVER, REST or "Niet genoeg data". |
| `PrimeForm-backed/routes/dailyRoutes.js` | `directiveFromAcwr(acwr)`; directive written to user stats. |
| `PrimeForm-backed/routes/adminRoutes.js` | directive derived from acwr bands for user list. |
| `PrimeForm/src/pages/IndexPage.vue` | "VANDAAG — OPDRACHT"; `brief?.todayDirective?.doToday`, stopRule, detailsMarkdown. |
| `PrimeForm/src/pages/coach/CoachDashboard.vue` | "DIRECTIVE — from stored ACWR only"; `directiveLabel(row)`, `inferDirectiveFromAcwr`. |
| `PrimeForm/src/pages/admin/AdminPage.vue` | `directiveFromAcwr`; row.directive or from metrics.acwr. |

**Conclusion:** "Directive" = status/tag (PUSH/MAINTAIN/RECOVER/REST). "Opdracht" = today's directive copy (doToday, stopRule) in atleet UI. Backend produces both; frontend displays.

---

## Pilot

| File | Context |
|------|--------|
| `PrimeForm/docs/BACKEND_FIRST_LEGACY_AUDIT.md` | `updatePilotProfile` in auth.js writes profile (lastPeriodDate, cycleLength); suggests replace with PUT /api/profile. |

**Conclusion:** "Pilot" appears only in legacy audit doc as legacy function name; not used in active code paths.

---

## dailyBrief

| File | Context |
|------|--------|
| `PrimeForm-backed/routes/dashboardRoutes.js` | GET /api/daily-brief calls `dailyBriefService.getDailyBrief`. |
| `PrimeForm-backed/services/dailyBriefService.js` | `getDailyBrief` builds status, todayDirective, compliance, confidence, blindSpots. |
| `PrimeForm/src/stores/dashboard.js` | State `dailyBrief: null`; set from briefRes.json().data. |
| `PrimeForm/src/pages/IndexPage.vue` | `const brief = computed(() => dashboardStore.dailyBrief || null)`; used for OPDRACHT, one-liner, doToday, stopRule. |
| `PrimeForm/src/pages/user/ProfilePage.vue` | `prefDailyBriefing` preference. |

**Conclusion:** dailyBrief = payload from GET /api/daily-brief; consumed by IndexPage for today's directive and status.

---

## readiness

| File | Context |
|------|--------|
| `PrimeForm-backed/routes/dashboardRoutes.js` | readiness_today from todayLog.metrics.readiness. |
| `PrimeForm-backed/services/dailyBriefService.js` | metrics.readiness in log; readinessScore default 10 for prime_load. |
| `PrimeForm-backed/routes/dailyRoutes.js` | save-checkin: readiness 1–10 required; Lethargy/Elite overrides use readiness. |
| `PrimeForm-backed/services/coachService.js` | readiness from userData.readiness or user doc for squadron view. |
| `PrimeForm/src/pages/IndexPage.vue` | readinessToday from telemetry; checkinReadiness slider; readinessLabelFor(); scale 1–10. |
| `PrimeForm/src/stores/dashboard.js` | submitDailyCheckIn({ readiness }); telemetry.readinessToday. |
| `PrimeForm/src/pages/coach/CoachDashboard.vue` | readiness-chip, readiness-dot, readiness-high/mid/low. |
| `PrimeForm/src/stores/squadron.js` | athlete.metrics?.readiness ?? athlete.readiness. |
| `PrimeForm-backed/README.md` | readiness (required) in daily-advice and save-checkin examples. |

**Conclusion:** readiness = subjective 1–10 score; stored in dailyLogs and optionally on user doc; used for prime_load multiplier and overrides.

---

## prime_load

| File | Context |
|------|--------|
| `PrimeForm-backed/services/calculationService.js` | `calculatePrimeLoad(rawLoad, cyclePhase, readinessScore, avgHr, maxHr)` — Luteal + symptom tax. |
| `PrimeForm-backed/services/reportService.js` | activities56WithPrime: stored prime_load or calculatePrimeLoad; acute/chronic from _primeLoad. |
| `PrimeForm-backed/services/dailyBriefService.js` | primeLoad from activity or calculatePrimeLoad with cycleService.getPhaseForDate. |
| `PrimeForm-backed/routes/dailyRoutes.js` | Prime load per activity via calculatePrimeLoad; update-user-stats sums prime_load. |
| `PrimeForm-backed/server.js` | Manual activity: prime_load = duration * rpe (rounded). |
| `PrimeForm/src/stores/dashboard.js` | Optimistic update: prime_load in injected manual session. |
| `PrimeForm/src/pages/IndexPage.vue` | Display: primeLoad from activity. |
| `PrimeForm-backed/services/stravaService.js` | mapActivity does not set prime_load; report/daily compute it. |
| `PrimeForm-backed/services/stravaWebhookService.js` | buildActivityDoc: suffer_score, no prime_load; downstream uses calculationService. |

**Conclusion:** prime_load = physiologically corrected load; computed in backend from raw load + phase + readiness; manual = duration×RPE. Strava ingestion stores raw/suffer_score; prime_load computed at report/dashboard time.

---

## cycleService

| File | Context |
|------|--------|
| `PrimeForm-backed/services/cycleService.js` | calculateLutealPhase, getPhaseForDate, calculateRedFlags, determineRecommendation. |
| `PrimeForm-backed/routes/dashboardRoutes.js` | cycleService.getPhaseForDate for phase fallback. |
| `PrimeForm-backed/services/dailyBriefService.js` | require('./cycleService'); getPhaseForDate for prime_load and recovery. |
| `PrimeForm-backed/services/reportService.js` | getPhaseForDate per activity date for prime_load. |
| `PrimeForm-backed/routes/dailyRoutes.js` | calculateLutealPhase, getPhaseForDate, calculateRedFlags, determineRecommendation. |
| `PrimeForm-backed/services/coachService.js` | getPhaseForDate for squadron and athlete detail. |

**Conclusion:** cycleService = single module for phase (Menstrual/Follicular/Luteal), cycle day, red flags, recommendation; used by dashboard, brief, report, daily, coach.

---

## webhook

| File | Context |
|------|--------|
| `PrimeForm-backed/routes/stravaWebhookRoutes.js` | GET/POST /webhooks/strava; verification and event delivery. |
| `PrimeForm-backed/services/stravaWebhookService.js` | handleStravaWebhookEvent; ingestion.source = 'webhook'. |
| `PrimeForm-backed/services/stravaFallbackJob.js` | Sync users when stravaLastWebhookAt older than 12h. |
| `PrimeForm-backed/routes/stravaRoutes.js` | Comment "webhook-first flow"; POST /sync-now. |
| `PrimeForm-backed/README.md` | STRAVA_VERIFY_TOKEN, STRAVA_WEBHOOK_CALLBACK_URL; subscription steps. |
| `PrimeForm/src/pages/IndexPage.vue` | "via webhook" in empty state copy; strava status "Webhook: ...". |

**Conclusion:** Strava webhook = /webhooks/strava; events upsert activities; fallback job when webhook stale; UI shows last webhook time.

---

## polling

| File | Context |
|------|--------|
| (geen treffers) | — |

**Conclusion:** Term "polling" komt niet voor in de codebase. Strava sync is webhook-first + handmatige "Sync nu" + 6u fallback job; geen polling-loop gedocumenteerd.

---

## Audit bevindingen (global search)

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | "Pilot" alleen in legacy-audit; geen actieve referentie. | Verwarring bij zoeken naar "pilot". | Verwijder of hernoem in audit-doc naar "legacy profile update". |
| P2 | "polling" nergens; expliciete polling verwijderd, term niet gedocumenteerd. | Nieuwe devs zoeken mogelijk naar "polling". | In 04_strava_integratie.md expliciet vermelden: geen polling, webhook + sync-now + fallback. |
| P1 | ACWR vs Belastingsbalans: backend altijd acwr; frontend label varieert (Belastingsbalans in coach, ACWR in Profile waarschuwing). | Consistente copy. | Eén terminologie-beslissing (bijv. overal "Belastingsbalans" in UI) en doorvoeren. |
