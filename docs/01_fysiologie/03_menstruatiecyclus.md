# 03 — Menstruatiecyclus

## Scope

- `PrimeForm-backed/services/cycleService.js` (calculateLutealPhase, getPhaseForDate, calculateRedFlags, determineRecommendation)
- `PrimeForm-backed/routes/dailyRoutes.js` (save-checkin: cycleInfo, overrides)
- `PrimeForm-backed/services/dailyBriefService.js`, reportService (getPhaseForDate per datum)
- knowledge/logic.md (fase-definities)

---

## Wat de code doet

1. **Phase prediction:** calculateLutealPhase(lastPeriodDate, cycleLength): daysSinceLastPeriod = vloer((today - lastPeriod)/dag); currentCycleDay = (daysSinceLastPeriod % cycleLength) + 1; ovulationDay = floor(cycleLength/2); lutealPhaseStart = ovulationDay + 1; isInLutealPhase = currentCycleDay >= lutealPhaseStart && currentCycleDay <= cycleLength. phaseName: dag 1–5 Menstrual, tot ovulationDay Follicular, daarna Luteal.
2. **getPhaseForDate(lastPeriodDate, cycleLength, targetDate):** Zelfde logica voor willekeurige datum; retourneert { phaseName, isInLutealPhase, currentCycleDay }. Gebruikt voor historische prime_load (fase op activiteitsdatum) en ghost comparison (cycleDay).
3. **Advies-beïnvloeding:** determineRecommendation(readiness, redFlags, phaseName): REST bij readiness≤3 of redFlags≥2; RECOVER bij (readiness 4–6 en Luteal) of redFlags===1; PUSH bij readiness≥8, 0 redFlags, Follicular; anders MAINTAIN. Red flags: cycleService.calculateRedFlags met Luteal-correctie (RHR baseline +3, HRV baseline ×1.12). Overrides (Lethargy, Elite Rebound, Sick) in dailyRoutes na determineRecommendation.
4. **Dagnummering:** currentCycleDay 1-based; modulo op daysSinceLastPeriod voor cycli overschrijdend.

---

## Bewijs

**1) Luteal en phaseName**
```javascript
// PrimeForm-backed/services/cycleService.js
const currentCycleDay = (daysSinceLastPeriod % cycleLength) + 1;
const ovulationDay = Math.floor(cycleLength / 2);
const lutealPhaseStart = ovulationDay + 1;
const isInLutealPhase = currentCycleDay >= lutealPhaseStart && currentCycleDay <= lutealPhaseEnd;
if (currentCycleDay <= 5) phaseName = 'Menstrual';
else if (currentCycleDay <= ovulationDay) phaseName = 'Follicular';
else if (currentCycleDay <= lutealPhaseEnd) phaseName = 'Luteal';
```

**2) Red flags Luteal offset**
```javascript
// cycleService.calculateRedFlags
const adjustedRhrBaseline = isLuteal ? rhrBaseline + 3 : rhrBaseline;
const adjustedHrvBaseline = isLuteal ? hrvBaseline * 1.12 : hrvBaseline;
```

**3) Recommendation**
```javascript
// cycleService.determineRecommendation
if (readiness <= 3 || redFlags >= 2) return { status: 'REST', reasons };
if ((readiness >= 4 && readiness <= 6 && isLuteal) || redFlags === 1) return { status: 'RECOVER', reasons };
if (readiness >= 8 && redFlags === 0 && isFollicular) return { status: 'PUSH', reasons };
return { status: 'MAINTAIN', reasons };
```

---

## Data-contracten

| Veld | Bron | Gebruik |
|------|------|---------|
| lastPeriodDate, cycleLength (avgDuration) | profile.cycleData | cycleService input |
| phaseName, currentCycleDay, isInLutealPhase | cycleService | recommendation, prime_load, brief, report |
| cycleInfo (in dailyLog) | save-checkin response | Opgeslagen in dailyLog; gebruikt voor vandaag-fase |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | Ovulatie vast op cycleLength/2 (bijv. dag 14 bij 28). Geen ovulatie-tracking. | Voorspelling is modelmatig. | Documenteer; evt. optionele ovulatie-datum later. |
| P1 | getPhaseForDate voor targetDate gebruikt modulo: ((days % cycleLength) + cycleLength) % cycleLength + 1. Negatieve days (toekomst) mogelijk bij fout in lastPeriod. | Edge case. | Validatie lastPeriod <= targetDate of documenteer. |

---

## Blind Spots

- Of cycleLength wijziging in profiel historische getPhaseForDate-uitkomsten beïnvloedt: ja, want geen opslag van fase per datum.
- logic.md exacte tekst over Luteal-definitie niet hier gekopieerd; verwezen.
