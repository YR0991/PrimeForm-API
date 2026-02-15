# Life simulation harness (Layer 2)

Deterministic scenarios with 56 days of `dailyLogs` + `activities` + `profile` and `today`. The runner derives the same inputs as the engine (baselines, ACWR, cycle phase, red flags), calls `computeStatus`, and asserts against expected values.

## Run

From `PrimeForm-backed`:

```bash
npm run sim:life
```

## Fixtures

- **Location:** `simulations/fixtures/life/*.json`
- Each fixture: `today` (YYYY-MM-DD), `profile` (with `cycleData`: `lastPeriodDate`, `contraceptionMode`, etc.), `dailyLogs` (56 entries: `date`, `hrv`, `rhr`, `sleepHours`, `readiness`, `isSick`), `activities` (array of `{ date, load }` or `prime_load`).

## Expected file format (v1.3)

**Location:** `simulations/expected/life/<name>.expected.json`

| Field | Required | Description |
|-------|----------|-------------|
| **tag** | Yes | Status tag: `PUSH` \| `MAINTAIN` \| `RECOVER` \| `REST` |
| **signal** | Yes | `GREEN` \| `ORANGE` \| `RED` |
| **phaseDayPresent** | No | If `true`/`false`, asserts that `phaseDay` is present or absent (cycle phase only for NATURAL). |
| **acwrBand** | No | ACWR band: `"<0.8"` \| `"0.8-1.3"` \| `"1.3-1.5"` \| `">1.5"` \| `"null"` |
| **cycleMode** | No | Engine mode: `NATURAL` \| `HBC_OTHER` \| `COPPER_IUD` \| `HBC_LNG_IUD` \| `UNKNOWN` |
| **cycleConfidence** | No | `HIGH` \| `LOW` (or `MED`). If **LOW**, runner also asserts `phaseDayPresent === false`. |
| **redFlagsMin** | No | Minimum number of red flags (e.g. `1` or `2`). |
| **reasonsContains** | No | Array of strings; each must appear in at least one reason (case-insensitive). |
| **instructionClass** | No | `NO_TRAINING` \| `ACTIVE_RECOVERY` \| `MAINTAIN` \| `HARD_PUSH` (REST→NO_TRAINING, RECOVER→ACTIVE_RECOVERY, etc.). |
| **prescriptionHint** | No | Optional hint (e.g. `PROGRESSIVE_STIMULUS` when progress-intent soft rule applies). |

- Only **tag** and **signal** are required. All other fields are optional; when present, the runner asserts the computed value matches.
- **reasonsContains:** When present, runner asserts `output.reasons` exists and each substring appears in the concatenated reasons (case-insensitive).
- **cycleConfidence LOW** implies cycle overrides (Lethargy, Elite) are gated off and `phaseDay` is not passed to the engine.
- **Option B** (no PUSH when ACWR null) is enforced in `statusEngine.computeStatus`; on FAIL the runner prints derived inputs: acwr, acwrBand, cycleMode, cycleConfidence, phaseDayPresent, redFlagsCount, readiness, isSick.

## Scenarios (summary)

- **01–10:** Core behavior (PUSH, RECOVER, MAINTAIN, REST, overrides, sick, red flags, missing data, fatigue).
- **11–13:** Route B gating proof — identical `dailyLogs` and `activities`; only `profile.cycleData.contraceptionMode` differs (NATURAL vs HBC_LNG_IUD vs COPPER_IUD). Expected: same tag (MAINTAIN); 11 `phaseDayPresent=true`, `cycleConfidence=HIGH`; 12 and 13 `phaseDayPresent=false`, `cycleConfidence=LOW`.
- **14** (`14_elite_would_trigger_but_gated_hbc`): Elite would normally trigger (menstrual day 1–2, readiness ≥8, HRV ≥98%, ACWR sweet) but **contraceptionMode=HBC_LNG_IUD** → confidence LOW; expected NOT PUSH (MAINTAIN), `phaseDayPresent=false`.
- **15** (`15_lethargy_would_trigger_but_gated_copper`): Lethargy would normally apply (luteal, readiness 4–6, HRV >105%, ACWR sweet) but **contraceptionMode=COPPER_IUD** → confidence LOW; baseline decision wins, cycle override does not change tag; `phaseDayPresent=false`.
- **16** (`16_progress_intent_soft_rule`): Sweet spot ACWR, redFlags 0, readiness ≥6, **goalIntent=PROGRESS** → tag unchanged (MAINTAIN), `prescriptionHint=PROGRESSIVE_STIMULUS`, reasons contain GOAL_PROGRESS. Profile may include `goalIntent` (or `intake.goalIntent`).
- **17** (`17_acwr_boundary_1_30`): ACWR **exactly 1.30** (inclusive upper bound for sweet spot). Base PUSH → stays PUSH; `acwrBand=0.8-1.3`.
- **18** (`18_acwr_boundary_1_50`): ACWR **exactly 1.50**. Code: `acwr > 1.5` → RECOVER (exclusive); `acwr > 1.3 && tag === PUSH` → RECOVER. So 1.50 does not trigger spike ceiling but does downgrade PUSH → RECOVER; `acwrBand=1.3-1.5`.
- **19** (`19_acwr_boundary_0_80`): ACWR **exactly 0.80** (inclusive lower bound for sweet spot). Base PUSH → stays PUSH; `acwrBand=0.8-1.3`.
- **20** (`20_redflags_1_recover`, `20_redflags_2_rest`): Two fixtures differing only in today’s HRV/RHR/sleep so redFlags count is 1 vs 2. 1 red flag → RECOVER; 2 red flags → REST.
- **21** (`21_missing_hrv_today`): Today’s `hrv` is null. Runner and redFlags logic do not crash; redFlags not computed (count 0); expected tag from base (readiness 7 Follicular = MAINTAIN).
- **22** (`22_missing_rhr_today`): Today’s `rhr` is null; same behavior as 21.
- **23** (`23_natural_missing_lastPeriodDate`): `contraceptionMode=NATURAL` but `lastPeriodDate` missing. Expected `cycleConfidence=MED`, `phaseDayPresent=false` (no Elite/Lethargy).
- **24** (`24_progress_intent_blocked_by_redflag`): goalIntent PROGRESS, ACWR sweet, readiness 7, but redFlags === 1. Expected no `prescriptionHint`, no GOAL_PROGRESS reason; tag RECOVER.

### ACWR boundary decisions (inclusive/exclusive)

| Boundary | Code rule | Interpretation | Scenario |
|----------|-----------|----------------|----------|
| **0.80** | `acwr < 0.8` → floor (no PUSH) | **Inclusive:** 0.80 is in sweet spot; PUSH allowed. | 19 |
| **1.30** | `acwr > 1.3 && tag === PUSH` → RECOVER; sweet spot `<= 1.3` | **Inclusive:** 1.30 is in sweet spot; PUSH allowed. | 17 |
| **1.50** | `acwr > 1.5` → RECOVER (spike) | **Exclusive:** 1.50 is not > 1.5; spike not triggered. PUSH still downgraded by `> 1.3` rule. | 18 |

## Regenerate fixtures

```bash
node simulations/scripts/generateLifeFixtures.js
```

This overwrites all `fixtures/life/*.json` and `expected/life/*.expected.json`.
