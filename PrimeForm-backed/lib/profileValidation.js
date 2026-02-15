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
  if (!profile || typeof profile !== 'object') return false;

  const fullNameOk = typeof profile.fullName === 'string' && profile.fullName.trim().length >= 2;
  const emailOk = typeof profile.email === 'string' && profile.email.includes('@');
  const birthDateOk = typeof profile.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate);
  const disclaimerOk = profile.disclaimerAccepted === true;

  const redFlags = Array.isArray(profile.redFlags) ? profile.redFlags : [];
  const redFlagsOk = redFlags.length === 0;

  const goalsOk = Array.isArray(profile.goals) && profile.goals.length > 0 && profile.goals.length <= 2;

  const programmingTypeOk =
    typeof profile.programmingType === 'string' && profile.programmingType.trim().length > 0;

  const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : null;
  const cycleLastPeriodOk =
    cycleData && typeof cycleData.lastPeriodDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cycleData.lastPeriodDate);
  const cycleAvgOk = cycleData && Number.isFinite(Number(cycleData.avgDuration)) && Number(cycleData.avgDuration) >= 21;
  const contraceptionOk =
    cycleData && typeof cycleData.contraception === 'string' && cycleData.contraception.trim().length > 0;

  return (
    fullNameOk &&
    emailOk &&
    birthDateOk &&
    disclaimerOk &&
    redFlagsOk &&
    goalsOk &&
    programmingTypeOk &&
    cycleLastPeriodOk &&
    cycleAvgOk &&
    contraceptionOk
  );
}

module.exports = { isProfileComplete, normalizeCycleData, uiLabelToContraceptionMode, CONTRACEPTION_MODE };
