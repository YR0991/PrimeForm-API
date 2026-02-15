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

## Regenerate fixtures

```bash
node simulations/scripts/generateLifeFixtures.js
```

This overwrites all `fixtures/life/*.json` and `expected/life/*.expected.json`.
