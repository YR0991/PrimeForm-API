# Audit PrimeForm — vNEXT (technisch)

Technisch auditdocument. Geen marketing; alleen geverifieerde feiten uit de repo. Waar gedrag niet door code of scenarios bewezen is: **UNPROVEN**.

---

## §0 TL;DR — Huidige status

- **AuthZ:** User-routes gebruiken `req.user.uid` (token); admin-routes `verifyIdToken` + `requireUser` + `requireRole('admin')`; break-glass via `BREAKGLASS_ENABLED` + `BREAKGLASS_ADMIN_EMAIL` (`middleware/auth.js`). Geen `X-User-Uid` of query-`userId` op user-routes. **DELETE /api/activities/:id:** token-only delete (geen body.userId/query); admin delete alleen via `DELETE /api/admin/users/:uid/activities/:id`.
- **Engine:** Eén bron van waarheid: `statusEngine.computeStatus()`; Option B (geen PUSH bij acwr null); `instructionClass` / `prescriptionHint` consistent in brief en save-checkin; redFlags null vs 0 correct afgehandeld in `cycleService.determineRecommendation` en `dailyBriefService`.
- **Simulaties:** Life scenarios 01–33 (incl. 33 includeInAcwr) gedefinieerd; runner (`simulations/runner/runLifeSimulations.js`) roept `computeStatus` en assert tegen expected; spec ENGINE_SPEC_v1.0 en README scenarios stemmen overeen.
- **Strava:** OAuth state gebonden aan uid + TTL 10 min, one-time consume (`stravaOAuthState.js`); callback schrijft `strava.connectedAt`, `scope`, `stravaSync`; sync-now user + admin met rate limit (429) en instrumentatie (`afterStrategy`, `afterTimestampUsed`, `stravaResponseMeta`).
- **Data:** `dailyLogs.source` gecanonicaliseerd in `dailyBriefService.normalizeSource` (checkin | import | strava; legacy `imported=true` → import); baseline merge-by-date; compliance/streak op basis van check-in dagen; profile completeness backend single source (`lib/profileValidation.isProfileComplete`, server.js GET/PUT profile).
- **P0 hardening (afgerond):** Token-only delete; redacting logger (geen token/email/payload in structured logs); nuclear delete met confirm + audit log + cleanup root `daily_logs`; intake idempotency via `intakeMailSentAt`-gate.
- **Open risico’s:** N+1 admin users (RISK_REGISTER #3); overige zie §3.

---

## §1 Architectuur en dataflow

### Relevante modules

| Module | Rol |
|--------|-----|
| `PrimeForm-backed/middleware/auth.js` | `verifyIdToken(admin)`, `requireUser()`, `requireRole(role)`; 401 bij ontbrekende/ongeldige token; 403 bij ontbrekende claim; break-glass op e-mail. |
| `PrimeForm-backed/server.js` | Mount: `userAuth` op `/api/profile`, `/api/history`, `/api/activities` (POST), `/api/save-checkin`, `/api/update-user-stats` via dailyRoutes; dashboardRoutes op `/api/dashboard`, `/api/daily-brief`; stravaRoutes `apiRouter` op `/api/strava`; admin `createAdminRouter` op `/api/admin`. |
| `PrimeForm-backed/routes/dailyRoutes.js` | `POST /api/save-checkin`, `POST /api/update-user-stats`; uid = `req.user.uid`; save-checkin gebruikt `statusEngine.computeStatus` en schrijft o.a. `source: 'checkin'`. |
| `PrimeForm-backed/routes/dashboardRoutes.js` | `GET /api/dashboard`, `GET /api/daily-brief`; uid = `req.user.uid`; daily-brief via `dailyBriefService.getDailyBrief`. |
| `PrimeForm-backed/routes/activityRoutes.js` | `DELETE /api/activities/:id`; uid alleen uit token (geen body/query); admin delete via `DELETE /api/admin/users/:uid/activities/:id`. |
| `PrimeForm-backed/routes/stravaRoutes.js` | Connect-url (state = `createState(req.user.uid)`), callback (`consumeState` → uid), disconnect, sync-now, activities; uid = `req.user.uid`; sync-now 429 bij cooldown. |
| `PrimeForm-backed/routes/adminRoutes.js` | `router.use(verifyIdToken(admin), requireUser(), requireRole('admin'))`; alle admin-endpoints; body-`userId`/params-`uid` als target (niet als identiteit). |
| `PrimeForm-backed/services/statusEngine.js` | `computeStatus(opts)` → tag, signal, reasons, instructionClass, prescriptionHint; Option B; clampToAcwrBounds; TAG_TO_INSTRUCTION_CLASS. |
| `PrimeForm-backed/services/cycleService.js` | `determineRecommendation(readiness, redFlags, phaseName)`; redFlags null ≠ 0; `calculateRedFlags`, `getPhaseForDate`. |
| `PrimeForm-backed/services/dailyBriefService.js` | `normalizeSource`, `selectTodayCheckin`, `getDailyLogsInRange` (merge-by-date), `getDailyBrief`; redFlags null → flagsConfidence LOW, needsCheckin-semantiek. |
| `PrimeForm-backed/services/stravaService.js` | `getAuthUrl` (scope `activity:read_all`), `syncActivitiesAfter` (retourneert stravaResponseMeta). |
| `PrimeForm-backed/services/stravaOAuthState.js` | `createState(uid)`, `consumeState(state)`; state-uid binding, TTL 10 min, one-time. |
| `PrimeForm-backed/lib/profileValidation.js` | `isProfileComplete(profile)`; canonical completeness; gebruikt in server.js GET/PUT profile. |

### Uid source of truth

- **User-endpoints:** `req.user.uid` na `verifyIdToken` + `requireUser()`. Geen gebruik van `X-User-Uid`, `query.userId` of `body.userId` voor identiteit op profile, history, save-checkin, update-user-stats, dashboard, daily-brief, strava (sync-now, disconnect, activities).  
- **Admin-endpoints:** Identiteit van de ingelogde gebruiker blijft token; `params.uid` of `body.userId` is het **target**-account (atleet) waarop de actie wordt uitgevoerd.  
- **DELETE activities:** `DELETE /api/activities/:id` gebruikt alleen `req.user.uid` (geen body/query). Admin verwijdert activiteit van atleet via `DELETE /api/admin/users/:uid/activities/:id`.

---

## §2 Bewezen invarianten (verwijzing naar scenario’s)

De volgende invarianten worden ondersteund door de life-simulations (fixtures + expected in `simulations/fixtures/life/` en `simulations/expected/life/`) en de runner `simulations/runner/runLifeSimulations.js`:

- **01** (`01_stable_sweet_spot_push`): Sweet spot ACWR, base PUSH → tag PUSH, instructionClass HARD_PUSH.
- **02** (`02_spike_acwr_recover`): ACWR spike → RECOVER.
- **03** (`03_low_load_maintain`): ACWR < 0.8 → floor, MAINTAIN.
- **04** (`04_luteal_lethargy_maintain`): Lethargy-override (Luteal, readiness 4–6, HRV >105%) → MAINTAIN.
- **05** (`05_elite_menstrual_push`): Elite-override (Menstrual 1–3, readiness ≥8, HRV ≥98%) → PUSH.
- **06** (`06_sick_recover`): isSick → RECOVER.
- **07** (`07_red_flags_recover`): redFlags 1 → RECOVER.
- **08** (`08_missing_activity_no_push`): Ontbrekende activiteit/ACWR-context → geen PUSH (Option B of conservatief).
- **09** (`09_conflicting_low_readiness_no_push`): Lage readiness, conflict → geen PUSH.
- **10** (`10_long_term_fatigue_hrv_depressed`): Langdurige vermoeidheid/HRV.
- **11–13** (Route B): Zelfde data, ander contraceptionMode; 11 NATURAL (phaseDayPresent, HIGH), 12/13 HBC_LNG_IUD/COPPER_IUD (LOW, phaseDayPresent false).
- **14** (`14_elite_would_trigger_but_gated_hbc`): Elite zou PUSH geven maar HBC → confidence LOW → MAINTAIN.
- **15** (`15_lethargy_would_trigger_but_gated_copper`): Lethargy zou MAINTAIN geven maar COPPER → LOW → basis-beslissing.
- **16** (`16_progress_intent_soft_rule`): goalIntent PROGRESS, sweet spot, redFlags 0 → prescriptionHint PROGRESSIVE_STIMULUS.
- **17–19** (ACWR-grenzen): 0.80 inclusief sweet spot; 1.30 inclusief; 1.50 → RECOVER (geen spike maar overreaching).
- **20** (redFlags 1 vs 2): RECOVER vs REST.
- **21–22** (missing HRV/RHR today): Geen crash; redFlags/advies zoals gedocumenteerd.
- **23** (`23_natural_missing_lastPeriodDate`): NATURAL zonder lastPeriodDate → cycleConfidence MED/LOW.
- **24** (`24_progress_intent_blocked_by_redflag`): redFlags 1 → geen prescriptionHint PROGRESS, tag RECOVER.
- **26** (`26_fixed_hiits_3x_week`): fixedClasses + redFlags 1 → prescriptionHint HIIT_MODULATE_RECOVERY, instructionClass ACTIVE_RECOVERY.
- **27, 29–32** (import/check-in/needsCheckin): needsCheckin true indien vandaag alleen import of geen geldige check-in; instructionClass/maintain zoals in expected.
- **30** (`30_import_baseline_then_checkin`): Na check-in vandaag → needsCheckin false, flagsConfidenceNotLow.
- **33** (`33_includeInAcwr_false_excluded_from_acwr`): includeInAcwr false activiteiten tellen niet mee voor ACWR-band.

De runner leest fixtures, leidt baselines/ACWR/cycle/redFlags op dezelfde wijze af als de productie-brief, roept `computeStatus` en vergelijkt met expected (tag, signal, instructionClass, prescriptionHint, meta.needsCheckin, acwrBand, etc.). Bewezen gedrag: zie deze scenario-IDs.

---

## §3 Risico’s

### Resolved (P0 hardening)

| # | Risico | Status | Oplossing |
|---|--------|--------|-----------|
| 1 | **DELETE /api/activities/:id** accepteerde bij admin **body.userId** / **query.userId** | RESOLVED | Token-only delete; admin gebruikt `DELETE /api/admin/users/:uid/activities/:id`. |
| 2 | **PII in logs** (RISK_REGISTER #10) | RESOLVED | Redacting logger (`lib/logger.js`); geen token/email/payload in structured logs. |
| 4 | **Nuclear Delete** verwijderde geen root **daily_logs** (RISK_REGISTER #4) | RESOLVED | Confirm vereist (`body.confirm === true`), audit log `admin_audit_log`, cleanup root `daily_logs` where userId == uid. |
| 6 | **Intake-mail idempotency** (RISK_REGISTER #5) | RESOLVED | `intakeMailSentAt`-gate op user; alleen mailen indien nog niet gezet; na verzenden veld zetten. |

### Open risico’s (top 6)

| # | Risico | Failure mode | Impact | Concrete fix |
|---|--------|--------------|--------|--------------|
| 1 | **N+1 bij GET /api/admin/users** (RISK_REGISTER #3) | Per user wordt o.a. getDashboardStats aangeroepen. | Latency en Firestore-reads bij veel users. | Batch/cache of aparte stats-collectie; paginatie. |
| 2 | **Strava-tokens at-rest** (RISK_REGISTER #6) | users.strava (accessToken, refreshToken) ongeëncrypteerd in Firestore. | Bij DB-lek exposure. | Firestore rules strikt; overweeg secrets manager of field-level encryptie. |
| 3 | **Firestore-index strava.athleteId** (RISK_REGISTER #8) | Webhook zoekt user op strava.athleteId; index niet in code aangemaakt. | Runtime-fout "index required" bij schaal. | Index in deploy-docs of createIndex in setup. |
| 4 | **Geen transactie bij Nuclear Delete** (RISK_REGISTER #9) | Auth deleteUser en Firestore deletes niet atomisch. | Orphan state bij partiële fout. | Compensatie of idempotent retry; documenteer recovery. |
| 5 | **Coach cross-team** (RISK_REGISTER blind spot) | Of coach alleen eigen team ziet is niet in dit audit getest. | Mogelijk cross-team toegang. | Expliciet autorisatie-check: teamId van coach === teamId van opgevraagde atleet. |
| 6 | **REST vs RECOVER uitlegbaarheid** | Beide → signal RED; verschil zit in instructionClass (NO_TRAINING vs ACTIVE_RECOVERY). UI/copy moet dit onderscheid maken. | Verkeerde verwachting bij atleet. | Copy/UI expliciet: REST = geen training; RECOVER = actief herstel. |

---

## §4 Security review

### AuthZ

- **User-routes:** `/api/profile`, `/api/history`, `/api/activities` (POST), `/api/save-checkin`, `/api/update-user-stats`, `/api/dashboard`, `/api/daily-brief` gebruiken `userAuth` = `[verifyIdToken(admin), requireUser()]`. Uid = `req.user.uid`. Geen legacy `X-User-Uid` of query/body userId voor identiteit.  
- **Strava:** `/api/strava/*` (disconnect, sync-now, activities, connect-url) achter dezelfde auth; uid uit token. GET `/api/strava/sync/:uid` en GET `/api/strava/activities/:uid` vergelijken `params.uid === req.user.uid` → 403 bij mismatch.  
- **Admin:** `router.use(verifyIdToken(admin), requireUser(), requireRole('admin'))` op alle `/api/admin/*`. Break-glass: `BREAKGLASS_ENABLED === 'true'` en `req.user.email === BREAKGLASS_ADMIN_EMAIL` → toegestaan, log `BREAKGLASS_USED`. Geen `x-admin-email`-header meer als enige check (RISK_REGISTER #2 afgesloten).

### Privilege escalation

- Normale user kan geen admin-claims toekennen (Firebase Auth). Admin-routes vereisen claim `admin: true` of break-glass e-mail.  
- Admin delete van activiteiten van een atleet alleen via `DELETE /api/admin/users/:uid/activities/:id`; user-route `DELETE /api/activities/:id` is token-only (eigen activiteiten).

### CSRF / CORS

- API is token-based (Bearer); geen cookie-based sessies. CSRF-risico voor state-changing requests beperkt bij correct gebruik van Authorization header.  
- CORS: server.js configureert origin; aanroepen vanaf andere origins afhankelijk van configuratie.

### Token handling

- Geen logging van access_token/refresh_token in strava-routes; alleen metadata/counts in sync-now responses.  
- ID-token alleen via Firebase `verifyIdToken`; niet in logs.

### Logging PII

- P0 hardening: centrale redacting logger (`lib/logger.js`); server en routes loggen geen token, email of payload; zie §3 Resolved.

---

## §5 Strava reliability

### Cold start en incremental

- **User sync-now** (`stravaRoutes.js`): Geen `newestStoredActivityDate` → cold start 30 dagen (`afterStrategy: 'cold_start_30d'`). Anders incremental: `newestStoredActivityDate - 1 dag` (`afterStrategy: 'incremental_newestStored'`).  
- **Admin sync-now** (`adminRoutes.js`): Body `{ afterDays?, afterTimestamp? }`. Geen opgeslagen nieuwste activiteit → default `afterDays=90` (`cold_start_90d`). Anders incremental (zelfde logica) of expliciet `afterTimestamp` (`explicit`).

### Idempotency en duplicates

- Activiteiten opgeslagen onder `users/{uid}/activities` met Strava activity-id als document-id; `set(..., { merge: true })`. Herhaalde sync overschrijftzelfde doc → idempotent voor eenzelfde Strava-activiteit.

### Rate limits

- User sync-now: cooldown 10 min per user (`lastSyncNowAt`); bij overschrijding 429 + `retryAfter`.  
- Strava API 429: service gooit error, backend schrijft `stravaBackoffUntil`; sync-now retourneert 429.

### Instrumentatie

- Beide sync-now (user + admin) retourneren o.a. `afterTimestampUsed`, `afterStrategy`, `stravaResponseMeta` (statusCode, isArray, length), `scopeStored`, `connectedAtStored` voor debug.

### OAuth en callback

- State: `createState(uid)` koppelt state aan uid; `consumeState(state)` éénmalig, TTL 10 min. Callback gebruikt alleen uid uit state, niet uit query/body.  
- Callback schrijft `strava.connectedAt`, `strava.scope`, `stravaSync: { lastSuccessAt, lastError, lastAttemptAt }` (en bij sync success verdere velden in stravaSync).

---

## §6 Engine productkwaliteit

### REST vs RECOVER

- **REST:** tag REST → signal RED, `instructionClass: 'NO_TRAINING'` (`statusEngine.js` TAG_TO_INSTRUCTION_CLASS).  
- **RECOVER:** tag RECOVER → signal RED, `instructionClass: 'ACTIVE_RECOVERY'`.  
- Beide zijn "rood" in signal; het verschil voor advies is NO_TRAINING vs ACTIVE_RECOVERY. ENGINE_SPEC_v1.0 en code zijn consistent; **uitlegbaarheid** in UI/copy moet dit onderscheid expliciet maken (zie §3 open #6).

### instructionClass en prescriptionHint

- `computeStatus` retourneert altijd `instructionClass` (afgeleid van tag via TAG_TO_INSTRUCTION_CLASS) en optioneel `prescriptionHint` (PROGRESSIVE_STIMULUS, HIIT_MODULATE_*, null).  
- `dailyBriefService.getDailyBrief` en `dailyRoutes.js` save-checkin gebruiken dezelfde `computeStatus`-uitvoer en schrijven instructionClass/prescriptionHint door. Geen tweede afleiding van tag elders voor brief/check-in.

### RedFlags null vs 0

- `cycleService.determineRecommendation`: `redFlags == null` → geen red-flag-only regels; niet als 0.  
- `dailyBriefService`: als redFlags niet berekenbaar → `redFlagsResult.count = null`, `flagsConfidence: 'LOW'`, reasons o.a. INSUFFICIENT_INPUT_FOR_REDFLAGS.  
- `debugHistoryService` en runner: redFlagsCount null vs 0 correct doorgegeven; scenarios 27, 31, 32 enz. gebruiken null waar geen voldoende input.

### needsCheckin

- Geen geldige check-in vandaag (alleen import of geen log met readiness) → `meta.needsCheckin: true`, tag MAINTAIN (geen RECOVER/REST op basis van vandaag), `flagsConfidence: 'LOW'` indien redFlags niet berekenbaar. Bewezen o.a. in scenarios 27, 31, 32.

---

## §7 Aanbevolen roadmap (2 sprints)

### Sprint 1 (P0) — DONE

**Tag:** `primeform-p0-hardened`

1. **AuthZ opschonen:** DELETE `/:id` altijd `targetUid = req.user.uid`; admin delete alleen via `DELETE /api/admin/users/:uid/activities/:id`.  
2. **Logging PII:** Redacting logger; geen token/email/payload in structured logs.  
3. **Nuclear Delete:** Confirm + audit log + cleanup root `daily_logs` where userId == uid.  
4. **Intake-mail idempotency:** `intakeMailSentAt`-gate; alleen mailen indien nog niet gezet; na verzenden veld zetten.

### Sprint 2 (P1)

5. **Admin users N+1:** GET /api/admin/users: batch of cache voor stats; of paginatie + lazy stats.  
6. **Strava index:** Documenteer of creëer Firestore-index voor `users` where `strava.athleteId` (voor webhook lookup).  
7. **Coach cross-team:** Expliciete check in coach-routes: teamId van `req.user` (of gekoppelde coach) === teamId van opgevraagde atleet; 403 bij mismatch.  
8. **REST vs RECOVER copy:** In frontend/brief-teksten expliciet onderscheid: REST = geen training; RECOVER = actief herstel (in lijn met instructionClass).  
9. **Delete-transactie (P2):** Optioneel: compensatie of idempotent retry voor Nuclear Delete; recovery-doc bijwerken.

---

*Audit gebaseerd op repo stand; bestandsnamen en functienamen zoals vermeld zijn geverifieerd in de codebase. UNPROVEN waar geen code of scenario-verwijzing is gegeven.*
