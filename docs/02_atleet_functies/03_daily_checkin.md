# 03 — Daily check-in

## Scope

- `PrimeForm-backed/routes/dailyRoutes.js` (POST /api/save-checkin)
- `PrimeForm-backed/services/cycleService.js`, dailyBriefService (getDailyLogForDate, getDailyLogsInRange)
- `PrimeForm/src/stores/dashboard.js` (save-checkin call)
- Firestore: users/{uid}/dailyLogs, root daily_logs

---

## Wat de code doet

1. **Opslag handmatige logs:** POST /api/save-checkin. Body: userId, date (YYYY-MM-DD), readiness (1–10, verplicht), hrv, rhr, sleep, isSick, rhrBaseline, hrvBaseline, … Validatie; red flags + recommendation (cycleService); Lethargy/Elite/Sick overrides. Dual write: (1) users/{uid}/dailyLogs.add(docData) met metrics (hrv, rhr, sleep, readiness), recommendation, aiMessage, cycleInfo, isSick, date, timestamp; (2) root daily_logs.add(rootLogData) met userId, date, timestamp, metrics, recommendation (legacy).
2. **Impact op readiness/advies:** Readiness wordt opgeslagen in dailyLog en gebruikt in getDailyBrief en volgende save-checkin (overrides, prime_load multiplier). reportService haalt logs uit users/{uid}/dailyLogs voor history_logs en baselines; dailyBriefService gebruikt logs voor compliance, ghost comparison, vandaag-log. Advies (status/tag) wordt in brief berekend uit acwr + isSick, niet uit opgeslagen recommendation; save-checkin slaat recommendation op voor historie en AI-context.
3. **Learning loop:** getYesterdayComplianceContext leest gisteren-log en gisteren-load; violation = advies was REST/RECOVER en load hoog; compliance = advies REST en load laag. Gebruikt in AI-prompt voor save-checkin.

---

## Bewijs

**1) Dual write**
```javascript
// PrimeForm-backed/routes/dailyRoutes.js
const userLogRef = await userDocRef.collection('dailyLogs').add(docData);
// ...
await db.collection('daily_logs').add(rootLogData);
```

**2) docData velden**
```javascript
// dailyRoutes: docData bevat date, timestamp, metrics: { hrv, rhr, sleep, readiness }, recommendation, aiMessage, cycleInfo, isSick
```

**3) reportService leest dailyLogs**
```javascript
// reportService: logs56 from users/{uid}/dailyLogs where date >= cutoff56
```

---

## Data-contracten

| Locatie | Geschreven | Velden (kern) |
|---------|------------|----------------|
| users/{uid}/dailyLogs | save-checkin | date, timestamp, metrics (hrv, rhr, sleep, readiness), recommendation, aiMessage, cycleInfo, isSick |
| daily_logs (root) | save-checkin | userId, date, timestamp, metrics, recommendation (legacy) |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P1 | Root daily_logs wordt bij Nuclear Delete niet per user gewist (alleen users/{uid}/dailyLogs). | Legacy data blijft staan. | Documenteer of delete by userId bij delete user. |
| P2 | Twee bronnen (subcollection + root); rapporten gebruiken subcollection. | Verwarring; root mogelijk ongebruikt. | Eén bron of migratie + deprecate root. |

---

## Blind Spots

- Of er een "edit check-in" flow is die bestaande dailyLog update: niet in deze scope.
- Exacte velden van rootLogData vs docData (alle verschillen): niet hier opgesomd.
