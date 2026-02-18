# Daily Check-in Pipeline — Technical Reference

## 1. Overview

The daily check-in pipeline is the single entry point for athletes to submit readiness, HRV, RHR, sleep, and optional cycle/period data. It validates input, resolves effective last-period date (with profile and menstruation-started override), applies cycle gating for hormonaal spiraal / Telemetry-Only users, computes status (tag/signal) via the status engine, evaluates RED-S guardrails only for non-gated users, builds cycle context for AI, generates an AI coaching message, and writes to Firestore (users/{uid}/dailyLogs and root daily_logs). All behaviour below is traceable to the listed source files only.

---

## 2. Endpoints & entrypoint

| Item | Value |
|------|--------|
| **Endpoint** | `POST /api/save-checkin` |
| **Handler location** | `PrimeForm-backed/routes/dailyRoutes.js`: router handler for `router.post('/save-checkin', auth, async (req, res) => { ... })` (starts ~line 263). |
| **Auth** | Protected by `auth` (= `[verifyIdToken(admin), requireUser()]`). User ID = `req.user.uid`. |

---

## 3. Data contracts

### 3.1 Request body (used fields)

From `dailyRoutes.js` save-checkin handler:

- **Required:** `rhr`, `rhrBaseline`, `hrv`, `hrvBaseline`, `readiness` (1–10).
- **Optional:** `lastPeriodDate`, `cycleLength` (21–35, default 28), `sleep`, `menstruationStarted` (boolean), `isSick` (boolean).

Validation: readiness 1–10; numeric fields must be non-negative and valid numbers; sleep (if present) 3–12 hours; date format YYYY-MM-DD when lastPeriodDate is provided.

### 3.2 Response payload

On success (`res.json`):

- `success: true`, `message: 'Check-in saved successfully'`
- `data`: `id` (dailyLog doc id), `status` (recommendation tag), `aiMessage`, `cycleInfo` (phase, isLuteal, currentCycleDay, lastPeriodDate, cycleLength), `date`, `recommendation` (status, reasons, instructionClass, prescriptionHint), `metrics` (readiness, redFlags, sleep, rhr, hrv), `guardrailWarnings` (array; empty when no warnings).

On error: 400 (validation), 503 (Firestore not initialized), 500 (generic) with `error` and optional `message` / `missingFields`.

---

## 4. Pipeline stap-voor-stap (call graph)

1. **Profile load**  
   - Fetch `users/{userId}` for `profile` and `cycleData.lastPeriodDate` (or root `cycleData.lastPeriodDate`).  
   - Used for: effective last-period date, gating (`isHormonallySuppressedOrNoBleed(profileForGating)`), and later for `profileContext` and `buildCycleContext`.

2. **Effective date & cycle gating**  
   - `effectiveLastPeriodDate` = menstruationStarted ? today : (body lastPeriodDate ?? profile lastPeriodDate) ?? null.  
   - `effectiveForCycle` = gated ? null : effectiveLastPeriodDate. So when user is hormonaal spiraal / Telemetry-Only (no-bleed), `effectiveForCycle` is null and no cycle phase is used for status/guardrails/cycleInfo.

3. **buildCycleContext (dailyBriefService)**  
   - Called with `{ profile: profileContext || {}, stats, cycleInfo, dateISO: todayIso }`.  
   - Returns `{ phaseName, phaseDay, confidence, phaseLabelNL, source }`. When confidence is LOW (e.g. HBC / IUD / unknown), `phaseName` and `phaseDay` are null and source is DISABLED.

4. **Cycle info for check-in**  
   - If `effectiveForCycle != null`: `cycleInfo = cycleService.calculateLutealPhase(effectiveForCycle, cycleLengthNum)`.  
   - If gated: `cycleInfo = { phaseName: null, isInLutealPhase: false, currentCycleDay: null, cycleLength: cycleLengthNum }`.

5. **Red flags**  
   - If not sick: `cycleService.calculateRedFlags(sleep, rhr, rhrBaseline, hrv, hrvBaseline, isInLutealForRedFlags)`. Luteal only when `effectiveForCycle != null`. Populates `metricsForAI` with adjusted baselines and luteal correction flags.

6. **ACWR & computeStatus (statusEngine)**  
   - ACWR from `reportService.getDashboardStats({ db, admin, uid: userId })` when not sick.  
   - `computeStatus({ acwr, isSick, readiness, redFlags: redFlags.count, cyclePhase: cycleContext.phaseName, hrvVsBaseline, phaseDay: cycleContext.phaseDay, goalIntent, fixedClasses, fixedHiitPerWeek })`.  
   - Lethargy/Elite overrides use cyclePhase and phaseDay; when cycleContext has phaseName/phaseDay null (LOW confidence), those overrides do not trigger.

7. **Guardrails (statusEngine + guardrails.md)**  
   - `getGuardrailWarnings({ daysSinceLastPeriod, cycleGated: effectiveForCycle == null })`.  
   - Only NATURAL (non-gated) users can get POSSIBLE_ANOVULATION when daysSinceLastPeriod > 35. Gated users always get `[]`.  
   - Before write: `guardrailWarningsSafe = Array.isArray(guardrailWarnings) ? guardrailWarnings : []`; Firestore and response use `guardrailWarningsSafe` (never undefined).

8. **Load / PrimeLoad (calculationService)**  
   - Used inside Learning Loop: `getYesterdayComplianceContext` uses `calculateActivityLoad` and `calculatePrimeLoad(rawLoad, phaseName, readinessYesterday, avgHr, maxHr)`. When gated, `phaseName` is null so no luteal tax in Prime Load (see calculationService: “Bij null/undefined/empty cyclePhase wordt geen luteal tax toegepast”).

9. **AI coaching message (aiService)**  
   - Local `generateAICoachingMessage(status, cycleContext, metricsForAI, redFlags, profileContext, detectedWorkout, flags, complianceContext)` in dailyRoutes.js builds system/user prompts and calls `openai.chat.completions.create`.  
   - Cycle context is passed as JSON in the prompt: `phaseName`, `phaseDay`, `confidence`, `phaseLabelNL`, `source`.  
   - After generation, `aiService.normalizePhaseMentions(aiMessage, cycleContext, { uid, db, admin, source: 'daily-checkin' })` is called so that when confidence !== HIGH, explicit phase terms in AI output are replaced with “cyclusfase” (no false phase claims for gated users).

10. **Firestore writes**  
    - **users/{uid}/dailyLogs.add(docData)**: timestamp, date, userId, source: 'checkin', metrics, cycleInfo (phase, isLuteal, currentCycleDay, lastPeriodDate, cycleLength), cyclePhase (null when gated), periodStarted, isSickOrInjured, recommendation, adviceContext, aiMessage, advice, redFlags, **guardrailWarnings: guardrailWarningsSafe** (always array).  
    - **daily_logs (root).add(rootLogData)**: userId, timestamp, date, metrics (flat), cycleInfo, redFlags, recommendation, adviceContext (no guardrailWarnings in root doc).  
    - If periodStarted: user doc profile.cycleData updated with lastPeriodDate and avgDuration.  
    - Rolling 7d/28d HRV/RHR and lastCheckin merged into user doc.

---

## 5. Hormoonspiraal / Telemetry-Only regels (hard invariants)

- **Gating predicate (used in save-checkin):** When `isHormonallySuppressedOrNoBleed(profileForGating)` is true, `effectiveForCycle` is set to `null` in dailyRoutes (so cycle is “off” for this request).  
  *(Definition of the predicate lives in `lib/profileValidation.js`, out of scope of the listed files; behaviour in save-checkin is as above.)*

- **When effectiveForCycle is null (gated / Telemetry-Only):**
  - **cycleInfo** written and used: `phaseName: null`, `isInLutealPhase: false`, `currentCycleDay: null`; `lastPeriodDate` in payload only if periodStarted (today).
  - **cycleContext** (from buildCycleContext): `confidence === 'LOW'`; `phaseName` and `phaseDay` are null; `source === 'DISABLED'`. So: no phase, no phaseDay.
  - **Luteal tax:** Not applied. Prime Load in calculationService uses cyclePhase; when phase is null/empty, no luteal multiplier (see calculationService: “Bij null/undefined/empty cyclePhase wordt geen luteal tax toegepast”).
  - **Red flags:** `isInLutealForRedFlags` is false, so no luteal-adjusted RHR/HRV baselines for red-flag calculation.
  - **Status overrides:** Lethargy override (Luteal + readiness 4–6 + HRV > 105%) and Elite override (Menstrual day 1–3 + readiness ≥ 8 + HRV ≥ 98%) require cyclePhase and phaseDay; with phaseName/phaseDay null they do not trigger.
  - **Guardrails:** `getGuardrailWarnings` is called with `cycleGated: true`, so it always returns `[]` (no POSSIBLE_ANOVULATION for gated users per guardrails.md).
  - **AI:** cycleContext has confidence LOW; `normalizePhaseMentions` replaces explicit phase terms with “cyclusfase” so the model does not claim a specific phase.

- **cycleContext shape when confidence is LOW (from dailyBriefService.buildCycleContext):**  
  `phaseName: null`, `phaseDay: null`, `confidence: 'LOW'`, `phaseLabelNL: null` (from phaseLabelNLFromName(null)), `source: 'DISABLED'`. The block `if (confidence !== 'LOW')` is skipped, so phaseName/phaseDay/source stay at their default (null, null, 'DISABLED').

---

## 6. Failure modes & debugging

- **Firestore undefined values:** Firestore does not accept `undefined`. The pipeline normalises `guardrailWarnings` to an array before write (`guardrailWarningsSafe`). If `guardrailWarnings` were ever undefined, a warning is logged: `[GUARDRAIL_WARNINGS_UNDEFINED] uidHash=... defaulted to []`.
- **Missing required fields:** 400 with `missingFields` array (rhr, rhrBaseline, hrv, hrvBaseline, readiness).
- **Invalid readiness / sleep / dates:** 400 with error message.
- **Firestore not initialized:** 503.
- **Profile fetch / getDashboardStats / getYesterdayComplianceContext / getDetectedWorkoutForAI errors:** Logged with `logger.error`; pipeline continues with fallbacks (e.g. acwr null, complianceContext default, detectedWorkout '').
- **Log keys:** `save-checkin guardrail` (when guardrailWarningsSafe.length > 0), `Profile fetch for lastPeriodDate failed`, `Profile fetch for check-in failed`, `getDashboardStats for save-checkin failed`, `getYesterdayComplianceContext failed`, `Detected workout fetch failed`, `Error generating AI message`, `Period reset profile update failed`, `Rolling averages update failed`, `Error saving check-in`. Logger is `../lib/logger`.

---

## 7. Code evidence

Snippets are from the listed files only; max ~10 lines each, with file path, function/section, and relevance.

**1) Entrypoint and auth**  
`PrimeForm-backed/routes/dailyRoutes.js` — handler registration and uid.

```javascript
  // POST /api/save-checkin — unified daily check-in: ...
  router.post('/save-checkin', auth, async (req, res) => {
    try {
      const userId = req.user.uid;
```

Relevance: Exact endpoint and that uid comes from auth token.

**2) Effective last-period and gating**  
`PrimeForm-backed/routes/dailyRoutes.js` — effectiveForCycle drives cycle on/off.

```javascript
      const effectiveLastPeriodDate = periodStarted ? todayIso : (lastPeriodDate ?? profileLastPeriodDate ?? null);
      const effectiveForCycle = isHormonallySuppressedOrNoBleed(profileForGating) ? null : effectiveLastPeriodDate;
```

Relevance: When profile is gated, cycle is disabled for this check-in.

**3) buildCycleContext and LOW confidence**  
`PrimeForm-backed/services/dailyBriefService.js` — buildCycleContext.

```javascript
function buildCycleContext(opts) {
  const { profile = {}, stats = {}, cycleInfo = null, dateISO } = opts || {};
  const mode = cycleMode(profile);
  const confidence = cycleConfidence(mode, profile);

  // Default: disabled/gated
  let phaseName = null;
  let phaseDay = null;
  let source = 'DISABLED';

  if (confidence !== 'LOW') {
```

Relevance: When confidence is LOW, phaseName/phaseDay stay null and source stays DISABLED.

**4) cycleConfidence**  
`PrimeForm-backed/services/dailyBriefService.js` — cycleConfidence.

```javascript
function cycleConfidence(mode, profile) {
  if (mode !== 'NATURAL') return 'LOW';
  const cd = profile && profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  if (!cd.lastPeriodDate) return 'MED';
  return 'HIGH';
}
```

Relevance: Only NATURAL + lastPeriodDate get HIGH; IUD/HBC/unknown get LOW.

**5) Guardrails only for non-gated**  
`PrimeForm-backed/services/statusEngine.js` — getGuardrailWarnings.

```javascript
function getGuardrailWarnings(opts) {
  const { daysSinceLastPeriod = null, cycleGated = true } = opts || {};
  if (cycleGated || daysSinceLastPeriod == null || !Number.isFinite(Number(daysSinceLastPeriod))) return [];
  const days = Number(daysSinceLastPeriod);
  if (days <= 35) return [];
  return [
    { code: 'POSSIBLE_ANOVULATION', text: '...' }
  ];
}
```

Relevance: Gated users always get empty array; no RED-S flag for IUD/Telemetry-Only.

**6) No luteal tax when phase null**  
`PrimeForm-backed/services/calculationService.js` — calculatePrimeLoad.

```javascript
  const phase = (cyclePhase || '').toLowerCase();
  if (phase && LUTEAL_PHASE_NAMES.includes(phase)) {
    multiplier = 1.05; // +5% base tax
```

Relevance: When cyclePhase is null (gated), the luteal block is skipped.

**7) normalizePhaseMentions when confidence !== HIGH**  
`PrimeForm-backed/services/aiService.js` — normalizePhaseMentions.

```javascript
  // 2) confidence != HIGH → neutralise explicit phase terms
  if (confidence !== 'HIGH') {
    PHASE_PATTERNS.forEach((p) => {
      text = text.replace(p.regex, 'cyclusfase');
    });
```

Relevance: For LOW confidence (gated), AI phase terms are replaced so we never claim a specific phase.

**8) Firestore docData guardrailWarnings**  
`PrimeForm-backed/routes/dailyRoutes.js` — docData for dailyLogs.

```javascript
        redFlags: { count: redFlags.count, reasons: redFlags.reasons, details: redFlags.details },
        guardrailWarnings: guardrailWarningsSafe
      };
```

Relevance: Firestore write uses normalised array only; no undefined.

**9) Guardrails applied at check-in, NATURAL only**  
`PrimeForm-backed/knowledge/guardrails.md` — RED-S.

```markdown
   - **Applied at:** Check-in (save-checkin) for **NATURAL only**; never for gated users (IUD / no-bleed / Telemetry-Only), to avoid false alarms.
```

Relevance: Spec alignment: guardrails only for non-gated users.

---

## Unknown / TODO

- Exact mapping from profile (e.g. contraceptionMode / bleedingPattern) to “gated” is implemented in `lib/profileValidation.js` (`isHormonallySuppressedOrNoBleed`); that file was not in the read-only scope. Behaviour in save-checkin is: when that function returns true, `effectiveForCycle = null`.
- Root collection `daily_logs` does not store `guardrailWarnings`; only `users/{uid}/dailyLogs` documents do.
