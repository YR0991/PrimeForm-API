# Engine baseline (v1.0)

**Non-negotiables**
- Single source of truth for status/tag: `computeStatus()` (used by daily brief and save-checkin).
- Canonical cycle key: `cycleData.lastPeriodDate` (legacy `lastPeriod` is migrated and must not reappear).
- All user-data endpoints require `Authorization: Bearer <Firebase ID token>`; user identity is only `req.user.uid`.
- All `/api/admin/*` routes require custom claim `admin: true` (break-glass must remain disabled in production).

---

# Engine Answers (CEO) — Weights, Modes, Confidence

Antwoorden op basis van **feitelijke code**; geen aannames. Verwijzingen: bestandspad + snippet.

---

## 1. Hard vs soft weights (cycle / intake / KB)

**Cyclus (Luteal tax):** Enige expliciete numerieke gewichten in de code. **Hard** (vast in code):

```javascript
// PrimeForm-backed/services/calculationService.js
multiplier = 1.05; // +5% base tax (Luteal)
if (intensity >= 0.85) multiplier += 0.05; // +5% intensity tax
const symptomTax = Math.min(symptomSeverity * 0.01, 0.04); // max +4%
const corrected = rawLoad * multiplier;
```

- Base Luteal: 1.05; intensity (≥85% HR): +0.05; readiness-symptoom: 0–4%. Geen config of env voor deze waarden.

**Intake:** Geen gewichten. Intake wordt alleen als **invoer** gebruikt (buildIntake: goal, eventDate, constraints, availabilityDaysPerWeek, sportFocus, oneLineNotes). Geen multiplier of weging op intake in adviesberekening.

```javascript
// PrimeForm-backed/services/dailyBriefService.js — buildIntake(profile)
return { goal, eventDate, constraints, availabilityDaysPerWeek, sportFocus, oneLineNotes };
```

**Knowledge base:** Geladen als **één string** (server.js: loadKnowledgeBase; aiService: loadKnowledgeBase). Geen gewichten; wordt in prompts geïnjecteerd. Geen “soft” vs “hard” onderscheid in code.

**Conclusie:** Alleen Luteal/readiness in calculationService zijn harde gewichten. Intake en KB hebben geen gewichten in de code.

---

## 2. Modes (NATURAL / COPPER / LNG-IUD / OTHER / UNKNOWN)

Modi komen uit **cycleMode(profile)** in dailyBriefService.js:

```javascript
// PrimeForm-backed/services/dailyBriefService.js
function cycleMode(profile) {
  const cd = profile?.cycleData || {};
  const contraception = (cd.contraception || '').toLowerCase();
  if (contraception.includes('lng') || contraception.includes('iud') || contraception.includes('spiraal')) return 'HBC_LNG_IUD';
  if (contraception.includes('pil') || contraception.includes('patch') || contraception.includes('ring') || contraception.length > 0) return 'HBC_OTHER';
  if (contraception === '' && cd.lastPeriodDate) return 'NATURAL';
  return 'UNKNOWN';
}
```

| Mode in code | Voorwaarde |
|--------------|------------|
| **HBC_LNG_IUD** | contraception bevat "lng", "iud" of "spiraal" |
| **HBC_OTHER** | bevat "pil", "patch", "ring" of contraception niet leeg |
| **NATURAL** | contraception leeg én lastPeriodDate aanwezig |
| **UNKNOWN** | Anders |

**COPPER:** Komt **niet** als aparte mode voor. Koper-IUD (zonder LNG) valt in code onder HBC_OTHER (contraception niet leeg) of, bij alleen "koper", mogelijk UNKNOWN als het niet "lng"/"iud"/"spiraal" matcht en geen andere trefwoorden.

---

## 3. Confidence rules

**cycleConfidence(mode, profile):**

```javascript
// PrimeForm-backed/services/dailyBriefService.js
function cycleConfidence(mode, profile) {
  if (mode.startsWith('HBC')) return 'LOW';
  if (mode === 'UNKNOWN') return 'LOW';
  const cd = profile?.cycleData || {};
  if (!cd.lastPeriodDate) return 'MED';
  return 'HIGH';
}
```

| Confidence | Regels |
|------------|--------|
| **LOW** | mode is HBC_* of UNKNOWN |
| **MED** | NATURAL maar geen lastPeriodDate |
| **HIGH** | NATURAL met lastPeriodDate |

Gebruik: phase/phaseDay worden alleen getoond als cycleConf !== 'LOW' (getDailyBrief).

---

## 4. Drie uitgewerkte voorbeelden

**Voorbeeld 1 — NATURAL, lastPeriodDate aanwezig**  
profile.cycleData = { contraception: '', lastPeriodDate: '2025-01-15' }  
→ cycleMode = NATURAL, cycleConfidence = HIGH. phase/phaseDay uit reportService worden in brief gebruikt.

**Voorbeeld 2 — HBC LNG-spiraal**  
profile.cycleData = { contraception: 'LNG-spiraal' }  
→ cycleMode = HBC_LNG_IUD (contraception bevat "lng"), cycleConfidence = LOW. phase/phaseDay in brief = null (cycleConf !== 'LOW' check).

**Voorbeeld 3 — NATURAL, nog geen menstruatie ingevuld**  
profile.cycleData = { contraception: '' } (geen lastPeriodDate)  
→ contraception === '' maar cd.lastPeriodDate ontbreekt → cycleMode = UNKNOWN, cycleConfidence = LOW.

---

## 5. Status engine: decision table and tie-breakers

**Single source of truth:** `PrimeForm-backed/services/statusEngine.js` — `computeStatus({ acwr, isSick, readiness, redFlags, cyclePhase, hrvVsBaseline, phaseDay })`. Used by **daily-brief** (status.tag / status.signal) and **save-checkin** (recommendation.status / reasons). Eliminates drift between ACWR-only brief and readiness/cycle check-in.

### Decision order (priority)

1. **isSick** → **RECOVER** (hard override; no ACWR/readiness/cycle).
2. **ACWR hard bounds** (ceiling/floor) — see thresholds below.
3. **Base status** from readiness + redFlags + cyclePhase (same logic as `cycleService.determineRecommendation`).
4. **Lethargy override:** Luteal + readiness 4–6 + HRV > 105% baseline → **MAINTAIN**.
5. **Elite override:** Menstrual day 1–3 + readiness ≥ 8 + HRV ≥ 98% baseline → **PUSH**.
6. **Clamp** result of 3–5 to ACWR bounds.

### ACWR thresholds (documented in code)

| ACWR        | Effect |
|------------|--------|
| **> 1.5**  | Ceiling: tag = **RECOVER** (spike). |
| **> 1.3**  | Ceiling: no PUSH (overreaching); PUSH → RECOVER. |
| **0.8–1.3**| Sweet spot: PUSH / MAINTAIN / RECOVER allowed. |
| **< 0.8**  | Floor: no PUSH; PUSH → MAINTAIN. |
| **null**   | No ACWR constraint; status from readiness/cycle/overrides only. |

### Tie-breaker rules

- **ACWR ceiling overrides PUSH:** e.g. high readiness + Follicular would give PUSH, but ACWR > 1.3 → RECOVER.
- **ACWR floor overrides PUSH:** e.g. readiness/cycle would give PUSH, but ACWR < 0.8 → MAINTAIN.
- **isSick overrides everything:** no red-flag or ACWR logic when sick.
- **Overrides (Lethargy, Elite) apply before ACWR clamp:** so e.g. Elite Rebound can set PUSH, then ACWR clamp may downgrade to RECOVER/MAINTAIN.

### Output

- **tag:** `REST` | `RECOVER` | `MAINTAIN` | `PUSH`
- **signal:** `RED` (REST/RECOVER), `ORANGE` (MAINTAIN), `GREEN` (PUSH)
- **reasons:** array of Dutch strings (base reasons + override + ACWR grens when clamp applied).

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | COPPER/IUD-koper niet expliciet; valt onder HBC_OTHER of UNKNOWN. | Product/medische nuance onduidelijk. | Besluit: aparte mode "COPPER" of documenteer bewust onder OTHER. |
| P2 | Luteal-gewichten vast in code; niet configureerbaar. | Aanpassen vereist deploy. | Optioneel: env of config voor multiplier. |

## Blind Spots

- Of logic.md "IUD-Copper" / "IUD-Hormonal" ergens anders wordt vertaald naar modes: niet in geauditeerde code.
- Exacte volgorde van if-checks: bij "iud" + "koper" string geeft eerste if al HBC_LNG_IUD (vanwege "iud"); koper-IUD zonder LNG kan dus ten onrechte LNG-IUD worden.
