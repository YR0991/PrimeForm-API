# CEO-dashboard — KPI-definities

Per KPI: definitie, data source (Firestore/endpoints), target, wanneer “rood”.

---

## 1. Activation

**Definitie:** Aandeel gebruikers dat het profiel heeft voltooid (profileComplete) en/of onboarding heeft afgerond (onboardingComplete).

**Data source:** Firestore `users`: velden `profileComplete` (boolean), `onboardingComplete` (boolean). Berekening server-side in `server.js` via `isProfileComplete(mergedProfile)`. Lijst: GET `/api/admin/users` (geeft per user o.a. profileComplete).

**Target:** (Niet in code gedefinieerd; productiebeslissing.) Bijv. >80% van aangemaakte users heeft profileComplete === true binnen 7 dagen.

**Rood:** Onder target; of dalende trend week-op-week.

---

## 2. Compliance

**Definitie:** Mate waarin atleten dagelijks inchecken (HRV/RHR/readiness). Twee varianten in code: (a) rolling 7d: unieke dagen met ≥1 log in laatste 7 dagen (coachService.getRollingCompliance); (b) 28d-percentage: checkins28dPct (dailyBriefService.buildCompliance).

**Data source:** Firestore `users/{uid}/dailyLogs` (date, metrics). Coach: GET `/api/coach/squadron` → per atleet `complianceLast7`, `complianceDays`. Brief: GET `/api/daily-brief` → `compliance.checkins7dPct`, `compliance.checkins28dPct`. Admin: niet rechtstreeks; wel via getDashboardStats → history_logs indien deep dive.

**Target:** (Niet in code.) Bijv. 7d compliance ≥5/7 of checkins28dPct ≥70%.

**Rood:** complianceLast7 < 4 of checkins28dPct < 50%; of at-risk count stijgt.

---

## 3. Latency

**Definitie:** Responsetijd van kritieke API’s (dashboard, daily-brief) of tijd tot eerste check-in van de dag.

**Data source:** API: geen response-time logging in geauditeerde code. Eerste check-in: `users/{uid}/dailyLogs` met `timestamp` en `date`; verschil tussen start van dag (00:00 in timezone) en eerste log.timestamp per user/dag zou berekend kunnen worden — niet geïmplementeerd.

**Target:** (Niet in code.) Bijv. p95 GET /api/daily-brief < 2s; eerste check-in gemiddeld vóór 12:00.

**Rood:** p95 boven target; of geen metriek beschikbaar (blind spot).

---

## 4. Red-flag rate

**Definitie:** Aantal/frequentie van red flags (slaap <5.5u, RHR > baseline+5%, HRV < baseline−10%, met Luteal-correctie) per atleet per dag of per week.

**Data source:** Berekend in `cycleService.calculateRedFlags`; opgeslagen in save-checkin response en in dailyLog (redFlags niet als apart veld in subcollection in alle gevallen gecontroleerd). dailyRoutes slaat o.a. `redFlags: { count, reasons, details }` op. Aggregatie over users/dagen: niet als KPI-endpoint; zou uit `users/{uid}/dailyLogs` geaggregeerd moeten worden (redFlags.count of reasons).

**Target:** (Niet in code.) Bijv. gemiddeld <0.5 red flags per atleet per dag.

**Rood:** Stijging red-flag rate; of >2 red flags per atleet op >X% van de dagen.

---

## 5. Pilot → paid

**Definitie:** Conversie van pilot-/proefgebruikers naar betalende klanten.

**Data source:** Niet in code. Geen velden zoals `plan`, `subscription`, `pilot`, `paid` in Firestore of endpoints gevonden.

**Target:** Productiebeslissing.

**Rood:** N.v.t. zolang geen data source.

---

## 6. Coach-minuten/week

**Definitie:** Tijd die coaches besteden aan het platform per week (per coach of totaal).

**Data source:** Niet in code. Geen logging van coach-sessies, duur of acties.

**Target:** Productiebeslissing.

**Rood:** N.v.t. zolang geen data source.

---

## Overzicht data sources

| KPI | Bron (feitelijk) |
|-----|-------------------|
| Activation | users.profileComplete, users.onboardingComplete, GET /api/admin/users |
| Compliance | users/{uid}/dailyLogs, GET /api/coach/squadron, GET /api/daily-brief (compliance) |
| Latency | Geen; optioneel: dailyLogs.timestamp voor “tijd tot eerste check-in” |
| Red-flag rate | cycleService.calculateRedFlags; dailyLogs (redFlags) indien opgeslagen |
| Pilot→paid | — |
| Coach-minuten/week | — |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P1 | Geen targets in code of config. | KPIs niet operationeel. | Targets in config of apart KPI-doc. |
| P1 | Pilot→paid en coach-minuten ontbreken als data. | Geen conversie-/efficiency-sturing. | Product: velden of integratie definiëren. |
| P2 | Latency niet gelogd. | Geen SLA-monitoring. | Response-time logging of APM. |

## Blind Spots

- Of admin “system load” (totalUsers/systemCapacity) ergens als KPI wordt gebruikt: AdminPage toont alleen percentage; doelwaarde onbekend.
- Exacte veldnamen voor redFlags in dailyLogs (count vs reasons opgeslagen): niet in alle flows gecontroleerd.
