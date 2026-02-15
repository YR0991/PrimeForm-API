# Engine Claims Matrix v1

Testable claims derived from **ENGINE_ANSWERS.md**, **statusEngine** `computeStatus` logic, and **life simulations** scenarios 01–15. Each claim is phrased as "Given X, engine must output Y" and backed by code and/or scenario evidence.

**Sources:** `PrimeForm-backed/services/statusEngine.js`, `PrimeForm-backed/services/cycleService.js`, `PrimeForm-backed/services/dailyBriefService.js`, `PrimeForm-backed/simulations/` (fixtures + expected).

---

| # | Claim | Evidence (scenario IDs) | Implementation reference | Notes / limitations |
|---|--------|--------------------------|----------------------------|----------------------|
| 1 | Given `isSick === true`, engine must output tag **RECOVER** regardless of readiness, ACWR, or cycle. | 06 | `statusEngine.js` — first branch in `computeStatus()` returns RECOVER with reason "Ziek/geblesseerd – Herstel voorop." | Override has highest priority. |
| 2 | Given readiness ≤ 3 or redFlags ≥ 2, engine must output tag **REST** (before ACWR clamp). | 07 | `cycleService.determineRecommendation()` → REST; `computeStatus()` uses this as base then applies ACWR clamp. | 07: sleep &lt;5.5, HRV low, RHR high → 3 red flags → REST. |
| 3 | Given redFlags === 1 (and no REST conditions), engine must output tag **RECOVER**. | 10 | `cycleService.determineRecommendation()`: redFlags === 1 → RECOVER. | 10: HRV depressed vs baseline → 1 red flag → RECOVER. |
| 4 | Given readiness 4–6 and cyclePhase **Luteal** (and no REST), base must be **RECOVER**; Lethargy override can then raise to MAINTAIN if HRV > 105% baseline. | 04 | `determineRecommendation()` Luteal 4–6 → RECOVER; `computeStatus()` Lethargy override (Luteal, 4–6, HRV > 105%) → MAINTAIN. | 04: Luteal, readiness 5, HRV 58 vs ~50 baseline → MAINTAIN. |
| 5 | Given readiness ≥ 8, redFlags === 0, and cyclePhase **Follicular**, base must be **PUSH** (unless ACWR clamp applies). | 01 | `determineRecommendation()`: readiness ≥ 8, redFlags 0, Follicular → PUSH. | 01: sweet ACWR, Follicular, readiness 8 → PUSH. |
| 6 | Given ACWR > 1.5, engine must output tag **RECOVER** (spike ceiling) regardless of base. | 02 | `statusEngine.js` `clampToAcwrBounds()`: acwr > 1.5 → RECOVER. | 02: ACWR ~1.6, high readiness → RECOVER. |
| 7 | Given ACWR > 1.3 and base PUSH, engine must output **RECOVER** (overreaching ceiling). | 02 | `clampToAcwrBounds()`: acwr > 1.3 && tag === PUSH → RECOVER. | Same as claim 6 for PUSH base. |
| 8 | Given ACWR < 0.8 and base PUSH, engine must output **MAINTAIN** (floor: no PUSH). | 03 | `clampToAcwrBounds()`: acwr < 0.8 && tag === PUSH → MAINTAIN. | 03: low load ACWR ~0.71, readiness 8, Follicular → MAINTAIN. |
| 9 | Given ACWR in [0.8, 1.3] (sweet spot), PUSH/MAINTAIN/RECOVER are allowed; no ACWR clamp applied for those tags. | 01, 04, 05 | `clampToAcwrBounds()` only constrains PUSH outside band. | Sweet spot does not force a specific tag; base and overrides decide. |
| 10 | Given cyclePhase **Menstrual**, phaseDay 1–3, readiness ≥ 8, and HRV ≥ 98% baseline (or null), engine may output **PUSH** (Elite override). | 05 | `computeStatus()`: Elite override sets tag = PUSH with reason "Elite Override: Menstruale fase dag 1–3…". | 05: menstrual day 1, readiness 8, HRV 50, sweet ACWR → PUSH. |
| 11 | Given **cycleConfidence LOW** (contraceptionMode ≠ NATURAL or no lastPeriodDate), phaseDay must not be passed to computeStatus; Lethargy and Elite overrides must not trigger. | 12, 13, 14, 15 | `dailyBriefService.js`: phase/phaseDay set only when `cycleConf !== 'LOW'`; runner asserts phaseDayPresent false when confidence LOW. | Route B gating: non-NATURAL modes get no cycle phase in engine. |
| 12 | Given **contraceptionMode NATURAL** and lastPeriodDate present, cycleConfidence must be **HIGH** and phaseDay may be present. | 11 | `dailyBriefService.js` `cycleConfidence()`: NATURAL + lastPeriodDate → HIGH. Expected: phaseDayPresent=true, cycleConfidence=HIGH. | 11: NATURAL, same logs/activities as 12/13 → HIGH, phaseDay present. |
| 13 | Given **contraceptionMode HBC_LNG_IUD** or **COPPER_IUD** (or other non-NATURAL), cycleConfidence must be **LOW**. | 12, 13, 14, 15 | `cycleConfidence()`: mode !== NATURAL → LOW. | 12, 13: expected cycleConfidence LOW. |
| 14 | Given identical dailyLogs and activities, only profile.cycleData.contraceptionMode differing (NATURAL vs HBC_LNG_IUD vs COPPER_IUD), tag must be **identical** when chosen to avoid accidental PUSH (e.g. MAINTAIN). | 11, 12, 13 | Runner: all three expect MAINTAIN; 11 has phaseDayPresent true, 12/13 false. | Proves cycle overrides do not change tag when gated; same baseline outcome. |
| 15 | Given inputs that would satisfy **Elite override** (menstrual day 1–2, readiness ≥ 8, HRV ≥ 98%, ACWR sweet) but **contraceptionMode = HBC_LNG_IUD**, engine must **not** output PUSH (must output e.g. MAINTAIN); phaseDay must be absent. | 14 | Confidence LOW → phase/phaseDay null → no Elite override; base "Geen specifieke condities" → MAINTAIN. | 14_elite_would_trigger_but_gated_hbc. |
| 16 | Given inputs that would satisfy **Lethargy override** (Luteal, readiness 4–6, HRV > 105%, ACWR sweet) but **contraceptionMode = COPPER_IUD**, cycle override must not apply; baseline decision wins (e.g. MAINTAIN when phase unknown). | 15 | Confidence LOW → phase null → no Lethargy; base with Unknown phase → MAINTAIN. | 15_lethargy_would_trigger_but_gated_copper. |
| 17 | Given **ACWR cannot be computed** (missing or invalid activity data) and base would be PUSH, engine must output **MAINTAIN** (Option B: no PUSH without ACWR) with reason NO_ACWR_NO_PUSH. | 08 | `statusEngine.js` — after ACWR clamp: if `acwr` is null/not finite and tag === PUSH → downgrade to MAINTAIN and add reason `NO_ACWR_NO_PUSH`. | 08: no activities, readiness 8 → MAINTAIN. Applies in daily brief and save-checkin automatically. |
| 18 | Given no specific REST/RECOVER/PUSH conditions (readiness mid, redFlags 0, phase not Follicular/Luteal for PUSH/RECOVER), base must be **MAINTAIN**. | 09, 14, 15 | `determineRecommendation()`: default "Geen specifieke condities" → MAINTAIN. | 09: readiness 5, sweet ACWR → MAINTAIN. |
| 19 | Signal must be **GREEN** iff tag === PUSH; **ORANGE** iff tag === MAINTAIN; **RED** for REST or RECOVER. | All | `statusEngine.js` `tagToSignal()`. | All scenarios assert tag + signal. |
| 20 | Given ACWR null, engine must not apply ACWR clamp; tag is determined only by base and overrides (Lethargy/Elite). | 08 | `clampToAcwrBounds(tag, null)` returns tag unchanged. | 08: no activities → acwr null → MAINTAIN from base/default. |
| 21 | cycleMode must be **NATURAL** only when contraceptionMode === 'NATURAL' (or legacy: contraception empty and lastPeriodDate set). | 11 | `dailyBriefService.js` `cycleMode()`: uses contraceptionMode when present. | 11: contraceptionMode NATURAL → cycleMode NATURAL. |
| 22 | cycleMode must be **HBC_LNG_IUD** or **COPPER_IUD** when profile.cycleData.contraceptionMode is set accordingly. | 12, 13, 14, 15 | `cycleMode()` returns contraceptionMode value when it is a known enum. | 12: HBC_LNG_IUD; 13, 15: COPPER_IUD; 14: HBC_LNG_IUD. |
| 23 | When cycleConfidence is LOW, phaseDayPresent must be **false** (phase/phaseDay not passed to computeStatus). | 12, 13, 14, 15 | Runner asserts: if expected.cycleConfidence === 'LOW' then result.phaseDayPresent must be false. | Enforced in runLifeSimulations.js. |
| 24 | Red flags count must be computed from sleep, RHR vs baseline, HRV vs baseline (with Luteal adjustment when phase is Luteal); same thresholds as cycleService.calculateRedFlags. | 07, 10 | `cycleService.calculateRedFlags()`: sleep &lt; 5.5, RHR > baseline+5%, HRV < baseline−10%; Luteal adjusts baselines. | 07: 3 red flags → REST; 10: 1 red flag → RECOVER. |
| 25 | Reasons array must include at least one string per applied rule (isSick, base, Lethargy override, Elite override, ACWR grens); Dutch wording as in code. | 01–15 | `computeStatus()` and `determineRecommendation()` push reasons; runner can assert `reasonsContains`. | Optional assertion via expected.reasonsContains in life sims. |
| 26 | **instructionClass** must map from tag: REST→NO_TRAINING, RECOVER→ACTIVE_RECOVERY, MAINTAIN→MAINTAIN, PUSH→HARD_PUSH. | 02, 06, 07 | `statusEngine.js` `TAG_TO_INSTRUCTION_CLASS`; return object includes `instructionClass`. | 02/06: RECOVER → ACTIVE_RECOVERY; 07: REST → NO_TRAINING. |
| 27 | **Progress intent soft rule:** Given acwr in [0.8, 1.3], redFlags === 0, readiness ≥ 6, and goalIntent === PROGRESS, engine must keep tag unchanged, set prescriptionHint = PROGRESSIVE_STIMULUS, and add reason GOAL_PROGRESS. | 16 | `computeStatus()` step 7: inSweetSpot && redFlagsCount === 0 && readinessOk && goalIntent === 'PROGRESS'. | 16: profile.goalIntent PROGRESS, sweet spot, readiness 6 → MAINTAIN, prescriptionHint PROGRESSIVE_STIMULUS. |
| 28 | **Fixed HIIT classes:** Given profile.intake.fixedClasses === true and tag REST or RECOVER, engine must set prescriptionHint = HIIT_MODULATE_RECOVERY and add reason FIXED_CLASS_MODULATION (tag unchanged). | 26 | `computeStatus()` step 8: fixedClasses && (tag REST or RECOVER) → prescriptionHint HIIT_MODULATE_RECOVERY. | 26: fixedClasses true, 1 red flag → RECOVER, prescriptionHint HIIT_MODULATE_RECOVERY. |
| 29 | **Fixed HIIT classes (MAINTAIN):** Given profile.intake.fixedClasses === true and tag MAINTAIN, engine must set prescriptionHint = HIIT_MODULATE_MAINTAIN and add reason FIXED_CLASS_MODULATION. | — | `computeStatus()` step 8: fixedClasses && tag MAINTAIN → prescriptionHint HIIT_MODULATE_MAINTAIN. | No scenario yet; logic in statusEngine. |

---

## Abbreviations

- **ACWR:** Acute:Chronic Workload Ratio (7d load / (28d load/4)).
- **Option B / product rule:** When ACWR cannot be computed, engine must not output PUSH (conservative MAINTAIN unless sick/redFlags force RECOVER/REST).
- **Route B:** contraceptionMode enum (NATURAL, HBC_OTHER, COPPER_IUD, HBC_LNG_IUD, UNKNOWN); only NATURAL + lastPeriodDate get HIGH confidence and cycle phase/overrides.

## Scenario quick reference

| ID | Scenario | Tag | Key assertion |
|----|----------|-----|----------------|
| 01 | stable_sweet_spot_push | PUSH | Sweet ACWR + Follicular + readiness 8 |
| 02 | spike_acwr_recover | RECOVER | ACWR > 1.5 ceiling |
| 03 | low_load_maintain | MAINTAIN | ACWR < 0.8 floor |
| 04 | luteal_lethargy_maintain | MAINTAIN | Lethargy override |
| 05 | elite_menstrual_push | PUSH | Elite override |
| 06 | sick_recover | RECOVER | isSick override |
| 07 | red_flags_rest | REST | redFlags ≥ 2 |
| 08 | missing_activity_no_push | MAINTAIN | ACWR null → no PUSH (Option B) |
| 09 | conflicting_low_readiness_no_push | MAINTAIN | Base MAINTAIN |
| 10 | long_term_fatigue_hrv_depressed | RECOVER | 1 red flag |
| 11 | route_b_natural | MAINTAIN | phaseDayPresent true, cycleConfidence HIGH |
| 12 | route_b_hbc_lng_iud | MAINTAIN | phaseDayPresent false, cycleConfidence LOW |
| 13 | route_b_copper_iud | MAINTAIN | phaseDayPresent false, cycleConfidence LOW |
| 14 | elite_would_trigger_but_gated_hbc | MAINTAIN | Elite gated by HBC_LNG_IUD |
| 15 | lethargy_would_trigger_but_gated_copper | MAINTAIN | Lethargy gated by COPPER_IUD |
| 16 | progress_intent_soft_rule | MAINTAIN | goalIntent PROGRESS + sweet spot → prescriptionHint PROGRESSIVE_STIMULUS, GOAL_PROGRESS |
| 26 | fixed_hiits_3x_week | RECOVER | intake.fixedClasses true + 1 red flag → prescriptionHint HIIT_MODULATE_RECOVERY, FIXED_CLASS_MODULATION |
