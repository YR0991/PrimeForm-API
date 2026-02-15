/**
 * PrimeForm cycle and recommendation logic.
 * Used by daily-advice, save-checkin, and check-luteal-phase.
 */

/**
 * Calculate if user is in Luteal phase based on last period date.
 * Luteal phase: second half of cycle, after ovulation (≈ day 14 in 28d), before menstruation.
 *
 * @param {string} lastPeriodDate - Date string in YYYY-MM-DD format
 * @param {number} cycleLength - Average cycle length in days (default: 28)
 * @returns {object} - { isInLutealPhase, currentCycleDay, daysSinceLastPeriod, phaseName, cycleLength, lutealPhaseRange }
 */
function calculateLutealPhase(lastPeriodDate, cycleLength = 28) {
  const lastPeriod = new Date(lastPeriodDate);
  const today = new Date();

  lastPeriod.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const daysSinceLastPeriod = Math.floor((today - lastPeriod) / (1000 * 60 * 60 * 24));
  const currentCycleDay = (daysSinceLastPeriod % cycleLength) + 1;
  const ovulationDay = Math.floor(cycleLength / 2);
  const lutealPhaseStart = ovulationDay + 1;
  const lutealPhaseEnd = cycleLength;
  const isInLutealPhase = currentCycleDay >= lutealPhaseStart && currentCycleDay <= lutealPhaseEnd;

  let phaseName;
  if (currentCycleDay <= 5) {
    phaseName = 'Menstrual';
  } else if (currentCycleDay <= ovulationDay) {
    phaseName = 'Follicular';
  } else if (currentCycleDay <= lutealPhaseEnd) {
    phaseName = 'Luteal';
  } else {
    phaseName = 'Menstrual';
  }

  return {
    isInLutealPhase,
    currentCycleDay,
    daysSinceLastPeriod,
    phaseName,
    cycleLength,
    lutealPhaseRange: { start: lutealPhaseStart, end: lutealPhaseEnd }
  };
}

/**
 * Bepaal cyclusfase voor een willekeurige datum (voor historische load-correctie).
 * @param {string} lastPeriodDate - Startdatum laatste menstruatie (YYYY-MM-DD)
 * @param {number} cycleLength - Gemiddelde cyclusduur in dagen (default 28)
 * @param {string|Date} targetDate - Datum waarvoor de fase berekend moet worden (YYYY-MM-DD of Date)
 * @returns {{ phaseName: string, isInLutealPhase: boolean }}
 */
function getPhaseForDate(lastPeriodDate, cycleLength = 28, targetDate) {
  const lastPeriod = new Date(lastPeriodDate);
  const target = typeof targetDate === 'string' ? new Date(targetDate) : new Date(targetDate);
  lastPeriod.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const daysSinceLastPeriod = Math.floor((target - lastPeriod) / (1000 * 60 * 60 * 24));
  const currentCycleDay = ((daysSinceLastPeriod % cycleLength) + cycleLength) % cycleLength + 1;
  const ovulationDay = Math.floor(cycleLength / 2);
  const lutealPhaseStart = ovulationDay + 1;
  const lutealPhaseEnd = cycleLength;
  const isInLutealPhase = currentCycleDay >= lutealPhaseStart && currentCycleDay <= lutealPhaseEnd;

  let phaseName;
  if (currentCycleDay <= 5) {
    phaseName = 'Menstrual';
  } else if (currentCycleDay <= ovulationDay) {
    phaseName = 'Follicular';
  } else if (currentCycleDay <= lutealPhaseEnd) {
    phaseName = 'Luteal';
  } else {
    phaseName = 'Menstrual';
  }

  return { phaseName, isInLutealPhase, currentCycleDay };
}

/**
 * Calculate Red Flags based on sleep, RHR, and HRV (with Luteal offset where applicable).
 *
 * @param {number} sleep - Sleep hours
 * @param {number} rhr - Current resting heart rate
 * @param {number} rhrBaseline - Baseline resting heart rate
 * @param {number} hrv - Current HRV
 * @param {number} hrvBaseline - Baseline HRV
 * @param {boolean} isLuteal - Whether user is in Luteal phase
 * @returns {object} - { count, reasons, details }
 */
function calculateRedFlags(sleep, rhr, rhrBaseline, hrv, hrvBaseline, isLuteal) {
  let redFlags = 0;
  const reasons = [];

  const adjustedRhrBaseline = isLuteal ? rhrBaseline + 3 : rhrBaseline;
  const adjustedHrvBaseline = isLuteal ? hrvBaseline * 1.12 : hrvBaseline;

  if (sleep < 5.5) {
    redFlags++;
    reasons.push(`Slaap < 5.5u (${sleep.toFixed(1)}u)`);
  }

  const rhrThreshold = adjustedRhrBaseline * 1.05;
  if (rhr > rhrThreshold) {
    redFlags++;
    const increase = ((rhr - adjustedRhrBaseline) / adjustedRhrBaseline * 100).toFixed(1);
    reasons.push(`RHR > baseline + 5% (${rhr} vs ${adjustedRhrBaseline.toFixed(1)}${isLuteal ? ' (Luteale correctie +3)' : ''}, +${increase}%)`);
  }

  const hrvThreshold = adjustedHrvBaseline * 0.9;
  if (hrv < hrvThreshold) {
    redFlags++;
    const refBaseline = adjustedHrvBaseline;
    const decrease = ((refBaseline - hrv) / refBaseline * 100).toFixed(1);
    reasons.push(
      `HRV < baseline - 10% (${hrv} vs ${refBaseline.toFixed(1)}${isLuteal ? ' (Luteal offset +12%)' : ''}, -${decrease}%)`
    );
  }

  return {
    count: redFlags,
    reasons,
    details: {
      sleep: { value: sleep, threshold: 5.5, flagged: sleep < 5.5 },
      rhr: {
        value: rhr,
        baseline: rhrBaseline,
        adjustedBaseline: adjustedRhrBaseline,
        threshold: rhrThreshold,
        flagged: rhr > rhrThreshold,
        lutealCorrection: isLuteal
      },
      hrv: {
        value: hrv,
        baseline: hrvBaseline,
        adjustedBaseline: adjustedHrvBaseline,
        threshold: hrvThreshold,
        flagged: hrv < hrvThreshold,
        lutealOffsetApplied: isLuteal
      }
    }
  };
}

/**
 * Determine training recommendation (REST/RECOVER/MAINTAIN/PUSH) from readiness, red flags, and phase.
 * Overrides (Lethargy, Elite, Sick) are applied in the route layer.
 *
 * @param {number} readiness - Readiness score 1–10
 * @param {number} redFlags - Number of red flags
 * @param {string} phaseName - Menstrual cycle phase name
 * @returns {object} - { status, reasons }
 */
function determineRecommendation(readiness, redFlags, phaseName) {
  const isLuteal = phaseName === 'Luteal';
  const isFollicular = phaseName === 'Follicular';
  const reasons = [];

  // redFlags null = insufficient input; do not apply red-flag-only rules; do not treat as 0 for soft rules
  if (readiness != null && readiness <= 3) {
    reasons.push(`Readiness <= 3 (${readiness})`);
    return { status: 'REST', reasons };
  }
  if (redFlags != null && redFlags >= 2) {
    reasons.push(`Red Flags >= 2 (${redFlags})`);
    return { status: 'REST', reasons };
  }

  // Luteal conservatism: readiness 4-5 + Luteal => RECOVER; readiness 6 + Luteal with redFlags 0 => MAINTAIN (not auto-RECOVER)
  if (redFlags != null && redFlags === 1) {
    reasons.push(`Red Flags == 1 (${redFlags})`);
    return { status: 'RECOVER', reasons };
  }
  if (readiness != null && readiness >= 4 && readiness <= 5 && isLuteal) {
    reasons.push(`Readiness 4-5 (${readiness}) EN Luteale fase`);
    return { status: 'RECOVER', reasons };
  }

  if (readiness != null && readiness >= 8 && redFlags === 0 && isFollicular) {
    reasons.push(`Readiness >= 8 (${readiness}) EN 0 Red Flags EN Folliculaire fase`);
    return { status: 'PUSH', reasons };
  }

  reasons.push('Geen specifieke condities voor REST, RECOVER of PUSH');
  return { status: 'MAINTAIN', reasons };
}

module.exports = {
  calculateLutealPhase,
  getPhaseForDate,
  calculateRedFlags,
  determineRecommendation
};
