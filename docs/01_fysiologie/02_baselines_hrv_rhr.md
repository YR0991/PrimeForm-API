# 02 — Baselines HRV / RHR

## Scope

- `PrimeForm-backed/services/reportService.js` (getDashboardStats: rhr_baseline_28d, hrv_baseline_28d)
- `PrimeForm-backed/routes/dailyRoutes.js` (save-checkin: rhrBaseline, hrvBaseline in request)
- Frontend: RHRTile, HRV-weergave (waar baseline wordt getoond)

---

## Wat de code doet

1. **28-dagen baseline (reportService):** history_logs = hrvHistory (laatste 45d logs, per dag hrv/rhr). last28 = hrvHistory gefilterd op date >= twentyEightDaysAgoStr. rhr_baseline_28d = gemiddelde van rhr over last28 (alle waarden waar rhr != null); afgerond geheel getal. hrv_baseline_28d = gemiddelde van hrv over last28; afgerond 1 decimaal.
2. **Geen aparte rolling average service:** Geen aparte module voor "rolling 7d" of "rolling 28d" met eigen window; alleen deze 28d-baseline in getDashboardStats.
3. **Fallback:** Als last28 leeg of geen geldige waarden: rhr_baseline_28d = null, hrv_baseline_28d = null. Geen fallback naar 14d of profielwaarde in geauditeerde code.
4. **Save-checkin:** dailyRoutes accepteert rhrBaseline, hrvBaseline in body; gebruikt voor red-flag en Luteal-correctie; wordt niet opgeslagen als "nieuwe baseline" in deze flow — baseline voor vergelijking komt uit request (frontend levert mee) of uit eerdere rapportage.

---

## Bewijs

**1) 28d baseline berekening**
```javascript
// PrimeForm-backed/services/reportService.js
const last28 = hrvHistory.filter((h) => h.date >= twentyEightDaysAgoStr);
const rhrValues = last28.map((h) => h.rhr).filter((v) => v != null && Number.isFinite(v));
const hrvValues = last28.map((h) => h.hrv).filter((v) => v != null && Number.isFinite(v));
const rhr_baseline_28d = rhrValues.length ? Math.round(rhrValues.reduce((s, v) => s + v, 0) / rhrValues.length) : null;
const hrv_baseline_28d = hrvValues.length ? Math.round((hrvValues.reduce((s, v) => s + v, 0) / hrvValues.length) * 10) / 10 : null;
```

**2) hrvHistory bron**
```javascript
// reportService: hrvHistory uit logs56 (dailyLogs), per dag hrv/rhr + cycleDay
for (const l of logs56) {
  const dateStr = ...;
  hrvHistory.push({ date: dateStr, hrv: l.hrv != null ? Number(l.hrv) : null, rhr: l.rhr != null ? Number(l.rhr) : null, cycleDay: ... });
}
```

**3) Return**
```javascript
return { ..., rhr_baseline_28d, hrv_baseline_28d };
```

---

## Data-contracten

| Veld | Geschreven door | Gelezen door |
|------|-----------------|---------------|
| rhr_baseline_28d, hrv_baseline_28d | reportService.getDashboardStats (berekend) | Dashboard API, daily brief, tiles |
| metrics.hrv, metrics.rhr | save-checkin, import | reportService (logs56 → hrvHistory) |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | Geen expliciete "rolling 7d" baseline; alleen 28d. | Andere windows (7d) niet geïmplementeerd. | Documenteer of voeg 7d toe indien gewenst. |
| P2 | Bij weinig dagen data vallen baselines weg (null). | Tiles/advies kunnen baseline missen. | Fallback (bijv. profiel of 14d) of duidelijke "niet beschikbaar" in UI. |

---

## Blind Spots

- Waar RHRTile / HRV-tile hun baseline waarde vandaan halen (dashboard.raw vs dailyBrief): niet per component geaudit.
- Of er een apart "baseline update" flow is (bijv. nachtelijke job): niet gevonden in scope.
