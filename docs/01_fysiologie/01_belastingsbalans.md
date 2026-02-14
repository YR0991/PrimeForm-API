# 01 — Belastingsbalans (ACWR)

## Scope

- `PrimeForm-backed/services/calculationService.js` (calculateACWR, calculateActivityLoad, calculatePrimeLoad)
- `PrimeForm-backed/services/reportService.js` (getDashboardStats: acute/chronic, load_ratio)
- `PrimeForm-backed/services/dailyBriefService.js` (acwrBand, statusTag)
- `PrimeForm-backed/knowledge/logic.md` (ACWR interpretatie)
- Frontend: CoachDashboard, CoachDeepDive, ProfilePage (label "Belastingsbalans" / ACWR)

---

## Wat de code doet

1. **Acute load:** Som van prime_load van activiteiten in de laatste 7 dagen (reportService: activitiesLast7, sum7).
2. **Chronic load:** Som van prime_load laatste 28 dagen / 4 (= wekelijks gemiddelde, zelfde schaal als acute).
3. **ACWR:** `calculateACWR(acuteLoad7d, chronicLoad28d)` = acute / chronic; bij chronic <= 0 retourneert 0; afgerond op 2 decimalen. Formeel: chronic = "chronische load (gem. wekelijkse load over 28 dagen, typisch som/4)" — in reportService is chronic_load = sum28/4.
4. **Waar ACWR vs Belastingsbalans:** Backend levert altijd `acwr` (number). Frontend coach/admin: label "Belastingsbalans" (CoachDashboard, CoachDeepDive). ProfilePage: "ACWR > 1.3" in waarschuwing. AI prompts: expliciet "Belastingsbalans" gebruiken, nooit "ACWR" in output.
5. **Banden:** dailyBriefService acwrBand: <0.8 LOW, ≤1.3 SWEET, ≤1.5 OVERREACHING, >1.5 SPIKE. statusTag: isSick→RECOVER; acwr>1.5 of >1.3→RECOVER; 0.8–1.3→PUSH; anders MAINTAIN.

---

## Bewijs

**1) ACWR berekening**
```javascript
// PrimeForm-backed/services/calculationService.js
function calculateACWR(acuteLoad7d, chronicLoad28d) {
  const chronic = Number(chronicLoad28d);
  if (!Number.isFinite(chronic) || chronic <= 0) return 0;
  const acute = Number(acuteLoad7d);
  if (!Number.isFinite(acute)) return 0;
  return Math.round((acute / chronic) * 100) / 100;
}
```

**2) Acute/chronic in reportService**
```javascript
// PrimeForm-backed/services/reportService.js (getDashboardStats)
const sum7 = activitiesLast7.reduce((s, a) => s + a._primeLoad, 0);
const sum28 = activitiesLast28.reduce((s, a) => s + a._primeLoad, 0);
const acute_load = sum7;
const chronic_load = sum28 / 4;
const load_ratio = calculateACWR(acute_load, chronic_load);
```

**3) Frontend label**
```html
<!-- PrimeForm/src/pages/coach/CoachDashboard.vue -->
<div class="metric-label mono-text">Belastingsbalans</div>
```
Comment in template: "Belastingsbalans (was ACWR)".

---

## Data-contracten

| Veld | Bron | Consument |
|------|------|-----------|
| acwr | reportService.getDashboardStats (load_ratio) | dashboard API, dailyBrief, coachService, admin users |
| acute_load, chronic_load | idem | reportService return, AI prompt |
| ACWR (logic.md) | knowledge | AI / documentatie |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | chronic_load = sum28/4 (wekelijks gem.); acute = sum7 (7d totaal). Schaal: acute in "7d eenheid", chronic in "week eenheid" — ratio blijft interpretabel maar eenheid niet expliciet in code. | Geen bug; documentatie ontbreekt. | Comment of doc: acute = 7d total, chronic = 28d/4 = weekly avg. |
| P1 | ProfilePage toont "ACWR > 1.3" terwijl coach UI "Belastingsbalans" gebruikt. | Inconsistente terminologie. | Overal "Belastingsbalans" in UI of overal ACWR; één keuze. |

---

## Blind Spots

- Of acute_load ooit in "per week" wordt genormaliseerd elders: in getDashboardStats niet; acute = sum7, chronic = sum28/4.
