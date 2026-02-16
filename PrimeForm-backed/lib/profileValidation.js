/**
 * Profile completeness and cycleData normalization.
 * Canonical key: cycleData.lastPeriodDate (ISO YYYY-MM-DD).
 * Route B: cycleData.contraceptionMode enum (NATURAL | HBC_OTHER | COPPER_IUD | HBC_LNG_IUD | UNKNOWN).
 */

/** ContraceptionMode enum (canonical). */
const CONTRACEPTION_MODE = {
  NATURAL: 'NATURAL',
  HBC_OTHER: 'HBC_OTHER',
  COPPER_IUD: 'COPPER_IUD',
  HBC_LNG_IUD: 'HBC_LNG_IUD',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Map stored UI label (or legacy value) to contraceptionMode.
 * Legacy: Geen->NATURAL, Hormonaal->HBC_OTHER, Spiraal->UNKNOWN, Anders->UNKNOWN.
 * Route B: Geen->NATURAL; "Hormonaal (pil/...)"->HBC_OTHER; "Spiraal (koper)"->COPPER_IUD; "Spiraal (hormonaal)"->HBC_LNG_IUD; "Anders / Onbekend"->UNKNOWN.
 */
function uiLabelToContraceptionMode(label) {
  const s = (label || '').trim().toLowerCase();
  if (s === 'geen') return CONTRACEPTION_MODE.NATURAL;
  if (s.includes('spiraal') && s.includes('hormonaal')) return CONTRACEPTION_MODE.HBC_LNG_IUD;
  if (s.includes('spiraal') && s.includes('koper')) return CONTRACEPTION_MODE.COPPER_IUD;
  if (s.includes('hormonaal')) return CONTRACEPTION_MODE.HBC_OTHER;
  if (s === 'spiraal') return CONTRACEPTION_MODE.UNKNOWN;
  if (s === 'anders' || s.includes('anders') || s.includes('onbekend')) return CONTRACEPTION_MODE.UNKNOWN;
  return CONTRACEPTION_MODE.UNKNOWN;
}

/** Normalize cycleData: lastPeriod->lastPeriodDate; set contraceptionMode from contraception if missing (read-time migration). */
function normalizeCycleData(cycleData) {
  if (!cycleData || typeof cycleData !== 'object') return cycleData;
  const next = { ...cycleData };
  if (next.lastPeriod != null && next.lastPeriodDate == null) {
    next.lastPeriodDate = typeof next.lastPeriod === 'string' ? next.lastPeriod : String(next.lastPeriod);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'lastPeriod')) delete next.lastPeriod;
  if (next.contraceptionMode == null && (next.contraception != null || next.contraception === '')) {
    next.contraceptionMode = uiLabelToContraceptionMode(next.contraception);
  }
  return next;
}

/**
 * Canonical rule for onboarding/profile completeness. Single source of truth: used by GET /api/profile
 * (read-time migration + response) and PUT /api/profile. All required fields must be present and valid.
 * Uses cycleData.lastPeriodDate only (no legacy lastPeriod).
 */
function isProfileComplete(profile) {
  const { reasons } = getProfileCompleteReasons(profile);
  return reasons.length === 0;
}

/**
 * Return which requirements pass/fail for profile completeness (for admin/debug).
 * PII-free: only field names and pass/fail, no values.
 * @param {object} profile - User profile (may include root email merged)
 * @returns {{ complete: boolean, reasons: string[] }} reasons = list of missing/invalid checks (empty if complete)
 */
function getProfileCompleteReasons(profile) {
  const reasons = [];
  if (!profile || typeof profile !== 'object') {
    reasons.push('profile_missing_or_invalid');
    return { complete: false, reasons };
  }

  const fullNameOk = typeof profile.fullName === 'string' && profile.fullName.trim().length >= 2;
  if (!fullNameOk) reasons.push('fullName_invalid_or_too_short');

  const emailOk = typeof profile.email === 'string' && profile.email.includes('@');
  if (!emailOk) reasons.push('email_missing_or_invalid');

  const birthDateOk = typeof profile.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate);
  if (!birthDateOk) reasons.push('birthDate_missing_or_not_YYYYMMDD');

  const disclaimerOk = profile.disclaimerAccepted === true;
  if (!disclaimerOk) reasons.push('disclaimerAccepted_not_true');

  const redFlags = Array.isArray(profile.redFlags) ? profile.redFlags : [];
  const redFlagsOk = redFlags.length === 0;
  if (!redFlagsOk) reasons.push('redFlags_must_be_empty_array');

  const goalsOk = Array.isArray(profile.goals) && profile.goals.length > 0 && profile.goals.length <= 2;
  if (!goalsOk) reasons.push('goals_missing_or_invalid_count');

  const programmingTypeOk =
    typeof profile.programmingType === 'string' && profile.programmingType.trim().length > 0;
  if (!programmingTypeOk) reasons.push('programmingType_missing_or_empty');

  const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : null;
  const cycleLastPeriodOk =
    cycleData && typeof cycleData.lastPeriodDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cycleData.lastPeriodDate);
  if (!cycleLastPeriodOk) reasons.push('cycleData.lastPeriodDate_missing_or_invalid');

  const cycleAvgOk = cycleData && Number.isFinite(Number(cycleData.avgDuration)) && Number(cycleData.avgDuration) >= 21;
  if (!cycleAvgOk) reasons.push('cycleData.avgDuration_missing_or_invalid');

  const contraceptionOk =
    cycleData && typeof cycleData.contraception === 'string' && cycleData.contraception.trim().length > 0;
  if (!contraceptionOk) reasons.push('cycleData.contraception_missing_or_empty');

  return { complete: reasons.length === 0, reasons };
}

/** Once locked, onboarding is never downgraded: API always returns onboardingComplete true. */
function getEffectiveOnboardingComplete(computedComplete, hasOnboardingLockedAt) {
  return !!hasOnboardingLockedAt || computedComplete;
}

/** Number of required profile checks (for intake write assertion log). Same as checks in getProfileCompleteReasons. */
const REQUIRED_PROFILE_CHECK_COUNT = 10;

/**
 * Redacted presence count for profile after write (no PII). For server log/assertion.
 * @param {object} profile - Merged profile (e.g. after PUT /api/profile write)
 * @returns {{ present: number, total: number, missing: string[] }}
 */
function getRequiredProfileKeyPresence(profile) {
  const { reasons } = getProfileCompleteReasons(profile);
  const total = REQUIRED_PROFILE_CHECK_COUNT;
  const present = total - reasons.length;
  return { present, total, missing: reasons };
}

module.exports = { isProfileComplete, getProfileCompleteReasons, getEffectiveOnboardingComplete, getRequiredProfileKeyPresence, normalizeCycleData, uiLabelToContraceptionMode, CONTRACEPTION_MODE };
