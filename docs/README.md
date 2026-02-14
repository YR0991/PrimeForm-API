# PrimeForm — Forensic Documentation Audit

Documentatie gegenereerd in **AUDIT MODE**: beschrijft wat er feitelijk in de code staat. Geen aannames of gewenste architectuur. Ontbrekende of onduidelijke data is gemarkeerd als **Blind Spot** in de betreffende docs.

---

## Inhoudsopgave

### Categorie 1 — Fysiologie & Intelligentie
- [01 Belastingsbalans (ACWR)](01_fysiologie/01_belastingsbalans.md)
- [02 Baselines HRV/RHR](01_fysiologie/02_baselines_hrv_rhr.md)
- [03 Menstruatiecyclus](01_fysiologie/03_menstruatiecyclus.md)
- [04 Advies-algoritme](01_fysiologie/04_advies_algoritme.md)

### Categorie 2 — Atleetfuncties
- [01 Onboarding flow](02_atleet_functies/01_onboarding_flow.md)
- [02 Atleet-dashboard](02_atleet_functies/02_atleet_dashboard.md)
- [03 Daily check-in](02_atleet_functies/03_daily_checkin.md)
- [04 Atleet-profiel](02_atleet_functies/04_atleet_profiel.md)
- [05 Consistentie en streaks](02_atleet_functies/05_consistentie_en_streaks.md)

### Categorie 3 — Coach & Admin Beheer
- [01 Admin-dashboard](03_beheer/01_admin_dashboard.md)
- [02 Atleet deep dive](03_beheer/02_atleet_deep_dive.md)
- [03 Gebruikersbeheer](03_beheer/03_gebruikersbeheer.md)

### Categorie 4 — Techniek & Infrastructuur
- [00 Global search (termen)](04_techniek/00_global_search.md)
- [01 Architectuur overzicht](04_techniek/01_architectuur_overzicht.md)
- [02 Beveiliging & auth](04_techniek/02_beveiliging_auth.md)
- [03 E-mail service](04_techniek/03_email_service.md)
- [04 Strava-integratie](04_techniek/04_strava_integratie.md)

### CEO-artefacten
- [ENGINE_ANSWERS](ENGINE_ANSWERS.md) — Weights, modes, confidence, voorbeelden
- [CEO_DASHBOARD](CEO_DASHBOARD.md) — KPI-definities (activation, compliance, latency, etc.)
- [RISK_REGISTER](RISK_REGISTER.md) — Top 10 risico’s + severity + mitigatie
- [DAILY_BRIEF_SCHEMA](DAILY_BRIEF_SCHEMA.md) — PrimeFormDailyBrief payload inclusief meta

### Overige (bestaand)
- [BACKEND_FIRST_LEGACY_AUDIT](BACKEND_FIRST_LEGACY_AUDIT.md)
- [INTAKE_STEPPER_ANALYSIS](INTAKE_STEPPER_ANALYSIS.md)

---

## Audit-samenvatting

**Top-issues**
- Admin: uid uit `X-User-Uid` zonder token-verificatie; coach/admin gate via hardcoded `ADMIN_EMAIL` of `x-admin-email`.
- GET /api/admin/users: N+1 (per user getDashboardStats); bij veel users traag en kostbaar.
- Nuclear Delete wist geen root `daily_logs` op userId; legacy/PII kan blijven.
- Intake-mail: geen idempotency; dubbele save kan dubbele mail.
- ProfilePage toont "ACWR > 1.3" terwijl coach UI overal "Belastingsbalans" gebruikt — inconsistente terminologie.
- lastPeriod vs lastPeriodDate in profile/cycle: isProfileComplete checkt lastPeriod; cycleService gebruikt lastPeriodDate — key-mismatch risico.
- Strava: Firestore-index op `strava.athleteId` voor webhook lookup niet in code aangemaakt.

**Top-sterktes**
- ACWR/prime_load berekening centraal in calculationService en reportService; 7d/28d en Luteal tax eenduidig.
- Dual write save-checkin (users/{uid}/dailyLogs + root daily_logs) gedocumenteerd; rapporten gebruiken subcollection.
- Compliance/streak: duidelijke definitie (unieke dag, rolling 7, streak achterwaarts); coachService en dailyBriefService gespecificeerd.
- Cycle phase en overrides (Lethargy, Elite Rebound, Sick) in één flow (dailyRoutes) met cycleService.determineRecommendation.
- Strava webhook + sync-now + fallback job; prime_load wordt in report/brief berekend, niet in webhook opgeslagen — consistent.

---

## Terminologie-map

| Term in code / API | Term in UI / communicatie | Opmerking |
|--------------------|----------------------------|-----------|
| **acwr** | **Belastingsbalans** | Backend levert `acwr` (number); coach/admin UI toont label "Belastingsbalans". AI: gebruik "Belastingsbalans", nooit "ACWR" in output. |
| **Directive** | **Opdracht** | statusTag / acwrToDirective → PUSH, MAINTAIN, RECOVER, REST. todayDirective = doToday, stopRule, detailsMarkdown. |
| **Pilot** | — | Alleen in legacy audit-doc; niet in actieve code. |
| **dailyBrief** | Dagbrief / dagrapport | getDailyBrief levert status, todayDirective, compliance, confidence, blindSpots. |
| **readiness** | — | Subjectieve score 1–10; in dailyLogs; gebruikt voor overrides en prime_load. |
| **prime_load** | — | Berekend uit raw load + fase + readiness; niet opgeslagen in activity-doc bij Strava-ingestion. |
| **cycleService** | — | getPhaseForDate, calculateRedFlags, determineRecommendation; Luteal-correctie voor baselines. |
| **webhook** | — | POST /webhooks/strava; handleStravaWebhookEvent; 429 backoff. |
| **polling** | — | Geen hits in codebase; Strava = webhook + sync-now + fallback job (geen polling-loop). |

---

*Audit afgerond. Per document: scope, wat de code doet, bewijs (snippets), data-contracten, audit-bevindingen, blind spots.*
