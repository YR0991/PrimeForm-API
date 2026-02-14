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
  if (contraception === '' && (cd.lastPeriodDate || cd.lastPeriod)) return 'NATURAL';
  return 'UNKNOWN';
}
```

| Mode in code | Voorwaarde |
|--------------|------------|
| **HBC_LNG_IUD** | contraception bevat "lng", "iud" of "spiraal" |
| **HBC_OTHER** | bevat "pil", "patch", "ring" of contraception niet leeg |
| **NATURAL** | contraception leeg én (lastPeriodDate of lastPeriod) aanwezig |
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
  if (!(cd.lastPeriodDate || cd.lastPeriod)) return 'MED';
  return 'HIGH';
}
```

| Confidence | Regels |
|------------|--------|
| **LOW** | mode is HBC_* of UNKNOWN |
| **MED** | NATURAL maar geen lastPeriodDate én geen lastPeriod |
| **HIGH** | NATURAL met lastPeriodDate of lastPeriod |

Gebruik: phase/phaseDay worden alleen getoond als cycleConf !== 'LOW' (getDailyBrief).

---

## 4. Drie uitgewerkte voorbeelden

**Voorbeeld 1 — NATURAL, lastPeriod aanwezig**  
profile.cycleData = { contraception: '', lastPeriod: '2025-01-15' }  
→ cycleMode = NATURAL, cycleConfidence = HIGH (lastPeriod aanwezig). phase/phaseDay uit reportService worden in brief gebruikt.

**Voorbeeld 2 — HBC LNG-spiraal**  
profile.cycleData = { contraception: 'LNG-spiraal' }  
→ cycleMode = HBC_LNG_IUD (contraception bevat "lng"), cycleConfidence = LOW. phase/phaseDay in brief = null (cycleConf !== 'LOW' check).

**Voorbeeld 3 — NATURAL, nog geen menstruatie ingevuld**  
profile.cycleData = { contraception: '' } (geen lastPeriod/lastPeriodDate)  
→ cycleMode = NATURAL (contraception leeg; lastPeriod ontbreekt → tweede if niet, derde if wel: return NATURAL? Nee: contraception === '' && (cd.lastPeriodDate || cd.lastPeriod) is false, dus komt bij de laatste return niet; na tweede regel: HBC_OTHER niet (length > 0 is false). Dus NATURAL alleen als lastPeriod of lastPeriodDate bestaat. Bij alleen contraception: '' → geen lastPeriod → condition "contraception === '' && ..." is false → return UNKNOWN.  
→ cycleMode = UNKNOWN, cycleConfidence = LOW.

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | COPPER/IUD-koper niet expliciet; valt onder HBC_OTHER of UNKNOWN. | Product/medische nuance onduidelijk. | Besluit: aparte mode "COPPER" of documenteer bewust onder OTHER. |
| P2 | Luteal-gewichten vast in code; niet configureerbaar. | Aanpassen vereist deploy. | Optioneel: env of config voor multiplier. |

## Blind Spots

- Of logic.md "IUD-Copper" / "IUD-Hormonal" ergens anders wordt vertaald naar modes: niet in geauditeerde code.
- Exacte volgorde van if-checks: bij "iud" + "koper" string geeft eerste if al HBC_LNG_IUD (vanwege "iud"); koper-IUD zonder LNG kan dus ten onrechte LNG-IUD worden.
