# 02 — Atleet-dashboard

## Scope

- `PrimeForm/src/pages/IndexPage.vue` (atleet-dashboard pagina)
- `PrimeForm/src/stores/dashboard.js` (fetchDashboard, fetchDailyBrief)
- `PrimeForm-backed/routes/dashboardRoutes.js` (GET /api/dashboard, GET /api/daily-brief)
- `PrimeForm-backed/services/reportService.js` (getDashboardStats), dailyBriefService (getDailyBrief)
- Theme: primeform-design.mdc, Elite Dark tokens

---

## Wat de code doet

1. **Data-bron:** IndexPage haalt data via dashboard store: fetchDashboard (GET /api/dashboard) en fetchDailyBrief (GET /api/daily-brief). Dashboard endpoint levert todayLog + stats (reportService.getDashboardStats: acwr, acute_load, chronic_load, phase, recent_activities, history_logs, ghost_comparison, load_history, rhr_baseline_28d, hrv_baseline_28d). Daily-brief levert status (signal, tag), todayDirective (doToday, stopRule, detailsMarkdown), compliance, confidence, blindSpots.
2. **Widgets/tegels:** Feitelijk in template: status (signal dot + tag), todayDirective (doToday-lijst, stopRule), compliance (checkins28dPct), recent content (brief/detailsMarkdown). Geen aparte "ACWR-tegel" of "Load-tegel" in geauditeerde IndexPage-snippet; coach grid heeft Belastingsbalans/Form/TSB.
3. **Theme tokens:** Design rules: bg #050505, surface rgba(255,255,255,0.03), borders rgba(255,255,255,0.08), accent #fbbf24 (gold), #ef4444 (red), #22c55e (green); Inter uppercase/tracking-wide; JetBrains Mono voor data. Quasar overrides: q-card background/border/shadow in design rule.
4. **Kleuren in code:** IndexPage gebruikt o.a. tag-label, signal-dot; CoachDashboard/CoachDeepDive gebruiken risk-count text-negative/text-positive, compliance-bar filled, Belastingsbalans mono-text. Exacte hex in styles niet in dit bestand geïnventariseerd; zie primeform-design.mdc.

---

## Bewijs

**1) Dashboard fetch**
```javascript
// PrimeForm/src/stores/dashboard.js
const res = await fetch(`${API_URL}/api/dashboard`, { ... });
// GET /api/dashboard → todayLog + stats
```

**2) Brief + compliance**
```javascript
// IndexPage.vue (concept)
const pct28 = b.compliance?.checkins28dPct
// dailyBriefService returns compliance: { checkins7dPct, checkins28dPct, ... }
```

**3) reportService return**
```javascript
// reportService.getDashboardStats return
return { acwr, acute_load, chronic_load, atl_daily, ctl_daily, tsb, phase, phaseDay, phaseLength, recent_activities, history_logs, ghost_comparison, load_history, rhr_baseline_28d, hrv_baseline_28d };
```

---

## Data-contracten

| Veld | API | Frontend |
|------|-----|----------|
| stats.acwr, phase, history_logs, load_history, rhr_baseline_28d, hrv_baseline_28d | GET /api/dashboard | dashboard.raw.stats, tiles |
| brief.status, brief.todayDirective, brief.compliance | GET /api/daily-brief | IndexPage (tag, doToday, stopRule, compliance %) |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | Atleet-dashboard toont geen expliciete ACWR/Belastingsbalans-tegel in geauditeerde scope. | Atleet ziet ratio niet direct. | Bewust ontwerp of toevoegen. |
| P2 | Theme tokens in design rule; component-level hex kunnen afwijken. | Inconsistentie. | Grep op hex in src voor afwijkingen. |

---

## Blind Spots

- Volledige lijst van alle tegels op IndexPage (elke sectie) niet hier opgesomd; alleen genoemde elementen.
- Of load_history / ATL in een chart wordt getoond: niet in dit bestand bevestigd.
