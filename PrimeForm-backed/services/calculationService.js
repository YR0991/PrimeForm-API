/**
 * PrimeForm Calculation Service — Single Source of Truth voor Load, Prime Load en fase-definities.
 * Gebruikt door reportService (weekrapport) en eventueel andere consumers.
 */

/** Fasen die als 'Luteaal' tellen voor Prime Load-correctie. Case-insensitive vergelijking via toLowerCase(). */
const LUTEAL_PHASE_NAMES = ['mid_luteal', 'late_luteal', 'luteal'];

/**
 * Berekent load voor één activiteit: Strava suffer_score, of TRIMP-fallback, of RPE-schatting.
 * TRIMP (Banister): hrReserve = (avgHr - restHr) / (maxHr - restHr); trimp = duration_min * hrReserve * 0.64 * exp(1.92 * hrReserve); load = trimp (raw TRIMP komt overeen met Garmin/Strava schaal).
 * Geen hartslag: RPE-schatting = (moving_time / 60) * 40.
 * @param {object} activity - { suffer_score, moving_time, average_heartrate }
 * @param {object} profile - user profile met max_heart_rate, resting_heart_rate (optioneel)
 * @returns {number}
 */
function calculateActivityLoad(activity, profile = {}) {
  const sufferScore = activity.suffer_score != null ? Number(activity.suffer_score) : null;
  if (Number.isFinite(sufferScore)) return sufferScore;

  const movingTimeSec = activity.moving_time != null ? Number(activity.moving_time) : 0;
  const durationMin = movingTimeSec / 60;
  const avgHr = activity.average_heartrate != null ? Number(activity.average_heartrate) : null;

  if (avgHr != null && Number.isFinite(avgHr)) {
    const maxHr = profile.max_heart_rate != null ? Number(profile.max_heart_rate) : 190;
    const restHr = profile.resting_heart_rate != null ? Number(profile.resting_heart_rate) : 60;
    const denominator = maxHr - restHr;
    if (denominator > 0) {
      let hrReserve = (avgHr - restHr) / denominator;
      hrReserve = Math.max(0, Math.min(1, hrReserve));
      const trimp = durationMin * hrReserve * 0.64 * Math.exp(1.92 * hrReserve);
      return Math.round(trimp * 10) / 10;
    }
  }

  return Math.round(durationMin * 40 * 10) / 10;
}

/**
 * PrimeForm v2.1: corrigeer ruwe load op basis van cyclusfase, intensiteit en symptomen.
 * Gebruikt LUTEAL_PHASE_NAMES als single source of truth voor wat als luteaal telt.
 * Bij null/undefined/empty cyclePhase wordt geen luteal tax toegepast (gating / telemetry-only).
 * @param {number} rawLoad - ruwe Strava/garmin load (of TRIMP/RPE)
 * @param {string|null} cyclePhase - cyclusfase voor deze dag ('luteal', 'mid_luteal', etc.) of null bij gating
 * @param {number} readinessScore - subjectieve readiness 1–10
 * @param {number} avgHr - gemiddelde hartslag van de activiteit
 * @param {number} maxHr - maximale hartslag (profiel)
 * @returns {number} primeLoad - fysiologisch gecorrigeerde load
 */
function calculatePrimeLoad(rawLoad, cyclePhase, readinessScore, avgHr, maxHr) {
  if (!Number.isFinite(rawLoad) || rawLoad <= 0) return 0;

  let multiplier = 1.0;

  const phase = (cyclePhase || '').toLowerCase();
  if (phase && LUTEAL_PHASE_NAMES.includes(phase)) {
    multiplier = 1.05; // +5% base tax

    if (maxHr && avgHr) {
      const intensity = avgHr / maxHr;
      if (intensity >= 0.85) {
        multiplier += 0.05; // +5% intensity tax
      }
    }
  }

  if (readinessScore != null && Number.isFinite(Number(readinessScore))) {
    const r = Number(readinessScore);
    const symptomSeverity = Math.max(0, Math.min(9, 10 - r)); // 0–9
    const symptomTax = Math.min(symptomSeverity * 0.01, 0.04); // max +4%
    multiplier += symptomTax;
  }

  const corrected = rawLoad * multiplier;
  return Math.round(corrected);
}

/**
 * Bepaal of de gegeven fase als luteaal telt voor Prime Load.
 * @param {string} cyclePhase - fase-naam (case-insensitive)
 * @returns {boolean}
 */
function isLutealPhaseForLoad(cyclePhase) {
  return LUTEAL_PHASE_NAMES.includes((cyclePhase || '').toLowerCase());
}

/**
 * Bepaal atleetniveau op basis van gemiddelde wekelijkse load en uren.
 * Level 3 (ELITE): Load > 600 OR Hours > 6.
 * Level 2 (ACTIVE): Load 300-600 OR Hours 3-6.
 * Level 1 (ROOKIE): Anders.
 * @param {number} avgWeeklyLoad - gemiddelde wekelijkse load
 * @param {number} avgWeeklyHours - gemiddelde wekelijkse uren training
 * @returns {number} 1 = Rookie, 2 = Active, 3 = Elite
 */
function determineAthleteLevel(avgWeeklyLoad, avgWeeklyHours) {
  const load = Number(avgWeeklyLoad);
  const hours = Number(avgWeeklyHours);
  if ((Number.isFinite(load) && load > 600) || (Number.isFinite(hours) && hours > 6)) return 3;
  if ((Number.isFinite(load) && load >= 300 && load <= 600) || (Number.isFinite(hours) && hours >= 3 && hours <= 6)) return 2;
  return 1;
}

/**
 * Acute:Chronic Workload Ratio (ACWR). Trend-indicator voor belasting.
 * @param {number} acuteLoad7d - som van load laatste 7 dagen
 * @param {number} chronicLoad28d - chronische load (gem. wekelijkse load over 28 dagen, typisch som/4)
 * @returns {number} ratio; 0 of 1 bij chronicLoad28d === 0 om divide-by-zero te voorkomen
 */
function calculateACWR(acuteLoad7d, chronicLoad28d) {
  const chronic = Number(chronicLoad28d);
  if (!Number.isFinite(chronic) || chronic <= 0) return 0;
  const acute = Number(acuteLoad7d);
  if (!Number.isFinite(acute)) return 0;
  return Math.round((acute / chronic) * 100) / 100;
}

module.exports = {
  LUTEAL_PHASE_NAMES,
  calculateActivityLoad,
  calculatePrimeLoad,
  isLutealPhaseForLoad,
  determineAthleteLevel,
  calculateACWR
};
