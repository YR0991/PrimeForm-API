# Safety Guardrails & RED-S Watchdog

1. **RED-S Watchdog (Relative Energy Deficiency in Sport):**
   - **Trigger:** Use **daysSinceLastPeriod** (raw days since last menstruation, no modulo). If daysSinceLastPeriod > 35 AND no menstruation AND (optionally) no biphasic temperature/RHR shift occurred.
   - **Note:** Do NOT use the wrapped cycle day (currentCycleDay 1..cycleLength) for this trigger; it resets every cycle and cannot detect "no bleed for >35 days".
   - **Applied at:** Check-in (save-checkin) for **NATURAL only**; never for gated users (IUD / no-bleed / Telemetry-Only), to avoid false alarms.
   - **Action:** Flag "Possible anovulation / cycle disruption" (code POSSIBLE_ANOVULATION); warn user about potential "Anovulatory Cycle".
   - **Advice:** "Ik zie geen duidelijke eisprong of temperatuurstijging deze maand. Dit kan wijzen op een anovulatoire cyclus, vaak veroorzaakt door stress of een tekort aan brandstof (calorieën) t.o.v. je trainingsvolume. Focus op voeding."

2. **No Medical Diagnosis:**
   Never state "You have PCOS" or "You are pregnant". Always use suggestive language: "Dit patroon zien we soms bij..." and refer to a specialist.

3. **Fueling First:**
   If HRV is chronically low (>3 days) in Follicular phase: Do NOT suggest 'train harder'. Suggest 'eat more'. Under-fueling is the #1 cause of poor performance in women.
