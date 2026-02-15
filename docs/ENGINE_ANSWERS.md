# Engine baseline (v1.0)

**Non-negotiables**
- Single source of truth for status/tag: `computeStatus()` (used by daily brief and save-checkin).
- Canonical cycle key: `cycleData.lastPeriodDate` (legacy `lastPeriod` is migrated and must not reappear).
- **Onboarding/profile completeness:** Backend is the single source of truth. `lib/profileValidation.isProfileComplete(profile)` is the canonical rule. GET /api/profile computes it, persists `onboardingComplete`/`profileComplete` when missing or changed (read-time migration), and returns the boolean. Frontend only reads these flags; no field-derived completeness.
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

## 2. Modes (Route B) — contraceptionMode enum

Canonical veld: **profile.cycleData.contraceptionMode**. Enum: `NATURAL` | `HBC_OTHER` | `COPPER_IUD` | `HBC_LNG_IUD` | `UNKNOWN`.

Modi komen uit **cycleMode(profile)** in dailyBriefService.js: gebruikt **contraceptionMode** indien aanwezig; anders fallback op **contraception**-string (legacy).

**Route B UI-opties (intake)** → mapping:
| UI-label | contraceptionMode |
|----------|-------------------|
| Geen | NATURAL |
| Hormonaal (pil/pleister/ring/implantaat/injectie) | HBC_OTHER |
| Spiraal (koper) | COPPER_IUD |
| Spiraal (hormonaal) | HBC_LNG_IUD |
| Anders / Onbekend | UNKNOWN |

**Legacy mapping** (oude waarden zonder contraceptionMode): Geen→NATURAL, Hormonaal→HBC_OTHER, Spiraal→**UNKNOWN** (ambigue), Anders→UNKNOWN.

---

## 3. Confidence rules (v1) — phaseDay en cycle-overrides

**cycleConfidence(mode, profile):** Alleen **NATURAL + lastPeriodDate** → HIGH. Alle andere modi → LOW.

| Confidence | Regels |
|------------|--------|
| **HIGH** | mode === NATURAL én cycleData.lastPeriodDate aanwezig → phaseDay toegestaan; Lethargy/Elite-overrides kunnen toegepast worden. |
| **LOW** | mode !== NATURAL (HBC_OTHER, COPPER_IUD, HBC_LNG_IUD, UNKNOWN) → phaseDay **afwezig**; Lethargy/Elite-overrides **niet** toegepast. |
| **MED** | NATURAL maar geen lastPeriodDate |

**v1-regel:** Alleen bij HIGH confidence worden cyclePhase en phaseDay aan computeStatus doorgegeven; bij LOW/MED blijven ze null, dus geen Lethargy- of Elite-override. Gebruik: phase/phaseDay worden alleen getoond als cycleConf !== 'LOW' (getDailyBrief).

---

## 4. Drie uitgewerkte voorbeelden

**Voorbeeld 1 — NATURAL, lastPeriodDate aanwezig**  
profile.cycleData = { contraceptionMode: 'NATURAL', lastPeriodDate: '2025-01-15' } of { contraception: 'Geen', lastPeriodDate: '2025-01-15' }  
→ cycleMode = NATURAL, cycleConfidence = HIGH. phase/phaseDay in brief gebruikt; Lethargy/Elite-overrides kunnen.

**Voorbeeld 2 — HBC of spiraal (Route B)**  
profile.cycleData = { contraceptionMode: 'HBC_LNG_IUD' } of { contraception: 'Spiraal (hormonaal)' }  
→ cycleMode = HBC_LNG_IUD, cycleConfidence = LOW. phase/phaseDay in brief = null; geen Lethargy/Elite-override.

**Voorbeeld 3 — NATURAL, nog geen menstruatie ingevuld**  
profile.cycleData = { contraception: 'Geen' } (geen lastPeriodDate)  
→ cycleMode = UNKNOWN (geen lastPeriodDate), cycleConfidence = LOW.

**Voorbeeld 4 — Progress-intent soft rule (v1.3)**  
ACWR in sweet spot (0,8–1,3), redFlags 0, readiness ≥ 6, profile.intake.goalIntent (of profile.goalIntent) = PROGRESS  
→ tag ongewijzigd (bijv. MAINTAIN); instructionClass = MAINTAIN; prescriptionHint = PROGRESSIVE_STIMULUS; reasons bevatten GOAL_PROGRESS. UI toont badge "Progressieve prikkel" en guardrail.

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
- **instructionClass:** semantiek voor adviesinhoud (brief + save-checkin + UI copy): `NO_TRAINING` (REST), `ACTIVE_RECOVERY` (RECOVER), `MAINTAIN` (MAINTAIN), `HARD_PUSH` (PUSH). Afgeleid uit tag indien niet expliciet; gebruikt door frontend `getAdviceCopy()` voor Dagopdracht.
- **prescriptionHint:** optioneel; `PROGRESSIVE_STIMULUS` wanneer progress-intent soft rule van toepassing is (sweet spot ACWR, redFlags 0, readiness ≥ 6, goalIntent === PROGRESS); anders `null`. Geen tagwijziging; alleen hint voor UI (badge/guardrail copy).

---

## 5b. instructionClass en prescriptionHint (v1.3)

**instructionClass** — vaste mapping van tag naar adviesklasse:

| tag    | instructionClass  |
|--------|-------------------|
| REST   | NO_TRAINING       |
| RECOVER| ACTIVE_RECOVERY   |
| MAINTAIN | MAINTAIN        |
| PUSH   | HARD_PUSH         |

Bron: `statusEngine.computeStatus()`; daily brief en save-checkin leveren beide `instructionClass` in status/recommendation. Frontend valt terug op deze mapping als backend het veld niet zendt.

**prescriptionHint** — alleen wanneer progress-intent soft rule geldt:

- Condities: acwr in sweet spot (0,8–1,3), redFlags === 0, readiness ≥ 6, **goalIntent === PROGRESS**.
- Effect: tag blijft ongewijzigd; **prescriptionHint = `PROGRESSIVE_STIMULUS`**; reasons bevatten `GOAL_PROGRESS`.
- UI: frontend toont badge "Progressieve prikkel" en overrides voor summary/task/guardrail (adviceCopy.js).

**goalIntent — canoniek pad:** `profile.intake.goalIntent` (fallback: `profile.goalIntent`). Enum: `PROGRESS` | `PERFORMANCE` | `HEALTH` | `FATLOSS` | `UNKNOWN`. Gebruikt in dailyBriefService (buildInputs), statusEngine (soft rule), runLifeSimulations en save-checkin (profileContext).

---

## 5c. Decision table — uitgebreid (tag, instructionClass, prescriptionHint)

| Situatie           | tag     | instructionClass  | prescriptionHint        |
|--------------------|---------|-------------------|-------------------------|
| isSick             | RECOVER | ACTIVE_RECOVERY   | null                    |
| ACWR > 1.5         | RECOVER | ACTIVE_RECOVERY   | null                    |
| readiness ≤3 / redFlags ≥2 | REST | NO_TRAINING       | null                    |
| Sweet spot + PROGRESS intent (soft rule) | (ongewijzigd) | (idem) | PROGRESSIVE_STIMULUS |
| Basis PUSH (Folliculair, readiness 8+)   | PUSH    | HARD_PUSH         | null of PROGRESSIVE_STIMULUS |
| Basis MAINTAIN     | MAINTAIN| MAINTAIN          | null of PROGRESSIVE_STIMULUS |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | COPPER/IUD-koper niet expliciet; valt onder HBC_OTHER of UNKNOWN. | Product/medische nuance onduidelijk. | Besluit: aparte mode "COPPER" of documenteer bewust onder OTHER. |
| P2 | Luteal-gewichten vast in code; niet configureerbaar. | Aanpassen vereist deploy. | Optioneel: env of config voor multiplier. |

## Blind Spots

- Of logic.md "IUD-Copper" / "IUD-Hormonal" ergens anders wordt vertaald naar modes: niet in geauditeerde code.
- Exacte volgorde van if-checks: bij "iud" + "koper" string geeft eerste if al HBC_LNG_IUD (vanwege "iud"); koper-IUD zonder LNG kan dus ten onrechte LNG-IUD worden.
