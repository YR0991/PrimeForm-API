# 02 — Atleet deep dive

## Scope

- `PrimeForm-backed/services/coachService.js` (getAthleteDetail)
- `PrimeForm-backed/services/reportService.js` (getDashboardStats)
- `PrimeForm-backed/routes/coachRoutes.js` (GET /api/coach/athletes/:id)
- `PrimeForm/src/components/CoachDeepDive.vue`, `src/stores/squadron.js` (fetchAtleetDeepDive)

---

## Wat de code doet

1. **Data source:** Deep dive = GET /api/coach/athletes/:id. Backend: coachService.getAthleteDetail(db, admin, athleteId). Leest user doc; haalt reportService.getDashboardStats({ db, admin, uid: athleteId }). Geen aparte Firestore-query voor activiteiten; alles uit getDashboardStats (recent_activities, history_logs, ghost_comparison, load_history).
2. **Query's:** Eén user doc; getDashboardStats doet intern: users/{uid}/activities (56d), users/{uid}/dailyLogs (56d), root activities (56d), profile.cycleData voor fase. Geen extra collectionGroup of aparte activiteiten-query voor deep dive.
3. **Data shaping:** metrics: acwr, acuteLoad (atl_daily of acute_load), chronicLoad (ctl_daily of chronic_load), form (tsb), cyclePhase, cycleDay, rhr (rhr_baseline_28d), readiness (user doc). activities: recent_activities gemapt naar { id, date, type, load (_primeLoad), source }. complianceLast7, complianceDays, currentStreak uit getRollingCompliance(stats.history_logs), getCurrentStreak(stats.history_logs). directive = acwrToDirective(acwr). Return: id, profile (firstName, lastName, fullName, goals, successScenario, injuryHistory, redFlags), adminNotes, email, metrics, readiness, activities, directive, complianceLast7, complianceDays, currentStreak, history_logs, ghost_comparison, load_history.
4. **Grafieken / cycle-to-cycle:** ghost_comparison en load_history komen rechtstreeks uit getDashboardStats. ghost_comparison = vorige cycluszelfde cycleDay (ghost) vs laatste 14d; load_history = laatste 14 dagen daily load. Geen aparte "cycle-to-cycle" query; vergelijking via cycleDay in reportService (ghostByCycleDay).

---

## Bewijs

**1) getAthleteDetail**
```javascript
// PrimeForm-backed/services/coachService.js
stats = await reportService.getDashboardStats({ db, admin, uid: athleteId });
const metrics = { acwr: stats?.acwr ?? null, acuteLoad: ..., chronicLoad: ..., form: stats?.tsb, cyclePhase: stats?.phase, ... };
const activities = (stats?.recent_activities || []).map((a) => ({ id: a.id, date: a._dateStr, type: a.type, load: a._primeLoad, source: a.source }));
const { count: complianceLast7, complianceDays } = getRollingCompliance(stats?.history_logs || []);
return { id, profile, metrics, activities, directive, complianceLast7, complianceDays, currentStreak, history_logs: stats?.history_logs, ghost_comparison: stats?.ghost_comparison, load_history: stats?.load_history };
```

**2) Route**
```javascript
// coachRoutes: GET /api/coach/athletes/:id → coachService.getAthleteDetail(db, admin, req.params.id)
```

**3) Frontend**
```javascript
// squadron.js: fetchAtleetDeepDive(id) → getAthleteDetail(id) → stores in athletesById[id] (overwrites list row with detail)
```

---

## Data-contracten

| Veld | Bron | Consument |
|------|------|-----------|
| metrics, activities, directive, complianceLast7, complianceDays, currentStreak, history_logs, ghost_comparison, load_history | getDashboardStats + coachService mapping | CoachDeepDive.vue (grafieken, tabel, consistentie) |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | Deep dive overschrijft squadron-list entry in store (zelfde id). | Na sluiten deep dive kan list nog steeds detail-data hebben. | Apart selectedAtleet object of list/detail splitsen. |
| P2 | getDashboardStats 56d; deep dive toont recent_activities (max 20). Geen "alle activiteiten" endpoint. | Voldoende voor overzicht; geen export. | Documenteer limiet. |

---

## Blind Spots

- Welke grafiek-library CoachDeepDive gebruikt (ApexCharts e.d.) en exacte binding: niet in dit bestand.
- Of ghost_comparison in UI als "vorige cyclus" wordt gelabeld: niet gecontroleerd.
