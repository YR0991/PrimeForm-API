# 04 — Advies-algoritme

## Scope

- `PrimeForm-backed/services/cycleService.js` (calculateRedFlags, determineRecommendation)
- `PrimeForm-backed/services/dailyBriefService.js` (getDailyBrief: status, todayDirective, buildInternalCost)
- `PrimeForm-backed/routes/dailyRoutes.js` (save-checkin: recommendation, Lethargy/Elite/Sick overrides)
- Frontend: IndexPage (brief.status, todayDirective, signal)

---

## Wat de code doet

1. **Backend status/tag:** dailyBriefService: status.tag uit statusTag(acwr, isSick) (PUSH/MAINTAIN/RECOVER); status.signal uit signalFromTag (GREEN/ORANGE/RED). statusTag: isSick→RECOVER; acwr>1.5 of >1.3→RECOVER; 0.8–1.3→PUSH; anders MAINTAIN.
2. **Backend opdracht (todayDirective):** buildTodayDirective: doToday (array bullets), why (data-based), stopRule, detailsMarkdown (AI of template). Input: recovery, ACWR band, cycle, activity context, blindSpots. InternalCost (ELEVATED/NORMAL/LOW) uit recovery + ACWR + hard exposures.
3. **Save-checkin flow:** dailyRoutes: cycleService.calculateRedFlags (sleep, RHR, HRV, baselines, isLuteal); cycleService.determineRecommendation(readiness, redFlags, phaseName). Daarna overrides: Lethargy (Luteal, readiness 4–6, HRV >105% baseline) → MAINTAIN; Elite Rebound (Menstrual dag 1–3, readiness≥8, HRV≥98% baseline) → PUSH; isSick → RECOVER. Resultaat recommendation.status + cycleInfo opgeslagen in dailyLog.
4. **Frontend rol:** IndexPage toont brief.status (signal, tag), brief.todayDirective (doToday, stopRule, detailsMarkdown). Geen herberekening status in frontend; alleen weergave. Coach: directive uit ACWR (inferDirectiveFromAcwr) voor tabel; atleet-dashboard krijgt status/directive uit daily-brief API.

---

## Bewijs

**1) statusTag (brief)**
```javascript
// PrimeForm-backed/services/dailyBriefService.js
function statusTag(acwr, isSick) {
  if (isSick) return 'RECOVER';
  if (acwr == null || !Number.isFinite(acwr)) return 'MAINTAIN';
  const v = Number(acwr);
  if (v > 1.5) return 'RECOVER';
  if (v > 1.3) return 'RECOVER';
  if (v >= 0.8 && v <= 1.3) return 'PUSH';
  return 'MAINTAIN';
}
```

**2) Override Lethargy (dailyRoutes)**
```javascript
// PrimeForm-backed/routes/dailyRoutes.js (save-checkin)
if (isLutealPhase && numericFields.readiness >= 4 && numericFields.readiness <= 6) {
  const hrvPct = ...; // HRV vs baseline
  if (hrvPct > 105) {
    recommendation = { status: 'MAINTAIN', reasons: [..., 'Lethargy Override: ...'] };
  }
}
```

**3) Frontend gebruik**
```html
<!-- IndexPage.vue -->
<span class="tag-label mono">{{ brief?.status?.tag ?? 'MAINTAIN' }}</span>
<ul class="directive-list">
  <li v-for="(item, i) in (brief?.todayDirective?.doToday ?? ['Train volgens hoe je je voelt.']).slice(0, 3)">
```

---

## Data-contracten

| Veld | API/Bron | Frontend |
|------|----------|----------|
| status.signal, status.tag | GET /api/daily-brief | IndexPage (dot, tag) |
| todayDirective.doToday, stopRule, detailsMarkdown | idem | IndexPage (lijst, stopregel, dagrapport) |
| recommendation.status, cycleInfo | POST save-checkin → dailyLog | — |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P1 | isSick → RECOVER in brief; spec "RADICAL REST" niet in brief contract (comment in code). | Mogelijk verschil met product-eigenaar. | Besluit: RECOVER vs RADICAL REST en documenteer. |
| P2 | buildTodayDirective afhankelijk van stats (acwr, recovery); bij ontbrekende data vallen why/doToday terug op defaults. | Lege of generieke bullets. | Blind spots in brief tonen (al aanwezig) of fallback copy. |

---

## Blind Spots

- Exacte AI-prompt voor detailsMarkdown (als gebruikt) niet in dailyBriefService getraceerd; mogelijk in buildTodayDirective of downstream.
- Of save-checkin recommendation gelijk is aan wat daily-brief de volgende keer toont: brief leest vandaag-log + stats; status in brief kan opnieuw worden berekend i.p.v. opgeslagen status te tonen.
