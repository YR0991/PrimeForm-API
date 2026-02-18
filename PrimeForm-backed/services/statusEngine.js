/**
 * Single source of truth for status (tag/signal) used by daily-brief and save-checkin.
 * Decision table: isSick → RECOVER; ACWR ceiling/floor; readiness/cycle modulate within bounds.
 *
 * ACWR thresholds (documented):
 * - acwr > 1.5 → ceiling: RECOVER (spike)
 * - acwr > 1.3 → ceiling: no PUSH (overreaching)
 * - 0.8 <= acwr <= 1.3 → sweet spot (PUSH/MAINTAIN/RECOVER allowed)
 * - acwr < 0.8 → floor: no PUSH (detraining; MAINTAIN/RECOVER/REST allowed)
 * - acwr null → no ACWR constraint; Option B: PUSH not allowed when acwr is null → downgrade to MAINTAIN (NO_ACWR_NO_PUSH).
 */

const cycleService = require('./cycleService');

/** Tag order for clamping: REST < RECOVER < MAINTAIN < PUSH */
const TAG_ORDER = { REST: 0, RECOVER: 1, MAINTAIN: 2, PUSH: 3 };

/** Tag → instruction class (REST/RECOVER/MAINTAIN/PUSH semantics for advice) */
const TAG_TO_INSTRUCTION_CLASS = {
  REST: 'NO_TRAINING',
  RECOVER: 'ACTIVE_RECOVERY',
  MAINTAIN: 'MAINTAIN',
  PUSH: 'HARD_PUSH'
};

/** Canonical goal intent enum for progress soft rule */
const GOAL_INTENT = ['PROGRESS', 'PERFORMANCE', 'HEALTH', 'FATLOSS', 'UNKNOWN'];

function tagToSignal(tag) {
  if (tag === 'PUSH') return 'GREEN';
  if (tag === 'MAINTAIN') return 'ORANGE';
  return 'RED'; // RECOVER | REST
}

/**
 * Clamp a candidate tag to ACWR hard bounds.
 * @param {string} tag - REST | RECOVER | MAINTAIN | PUSH
 * @param {number|null} acwr
 * @returns {string} clamped tag
 */
function clampToAcwrBounds(tag, acwr) {
  if (acwr == null || !Number.isFinite(acwr)) return tag;
  const v = Number(acwr);
  if (v > 1.5) return 'RECOVER';
  if (v > 1.3 && tag === 'PUSH') return 'RECOVER';
  if (v < 0.8 && tag === 'PUSH') return 'MAINTAIN';
  return tag;
}

/**
 * Base status from readiness, redFlags, cyclePhase (same logic as determineRecommendation).
 */
function baseFromReadinessCycle(readiness, redFlags, cyclePhase) {
  return cycleService.determineRecommendation(
    readiness ?? 5,
    redFlags,
    cyclePhase || 'Unknown'
  );
}

/**
 * Compute final status tag from all inputs. Single entry point for brief and save-checkin.
 * @param {object} opts
 * @param {number|null} opts.acwr
 * @param {boolean} opts.isSick
 * @param {number|null} opts.readiness - 1-10
 * @param {number|null} opts.redFlags
 * @param {string|null} opts.cyclePhase - Menstrual | Follicular | Luteal
 * @param {number|null} opts.hrvVsBaseline - HRV as % of baseline (e.g. 105 for 105%)
 * @param {number|null} opts.phaseDay - 1-based cycle day (for Elite: 1-3 = early menstrual)
 * @param {string|null} opts.goalIntent - PROGRESS | PERFORMANCE | HEALTH | FATLOSS | UNKNOWN (for soft rule)
 * @param {boolean} [opts.fixedClasses] - profile.intake.fixedClasses: fixed HIIT classes (advice modulates, never "skip training")
 * @param {number} [opts.fixedHiitPerWeek] - profile.intake.fixedHiitPerWeek (optional)
 * @returns {{ tag: string, signal: string, reasons: Array<{ code: string, text: string }>, instructionClass: string, prescriptionHint: string|null }}
 */
function computeStatus(opts) {
  const {
    acwr = null,
    isSick = false,
    readiness = null,
    redFlags = null,
    cyclePhase = null,
    hrvVsBaseline = null,
    phaseDay = null,
    goalIntent = null,
    fixedClasses = false,
    fixedHiitPerWeek = null
  } = opts || {};

  const reasons = [];

  /** Normalize to { code, text } and ensure reasons array is [{ code, text }]. */
  const pushReason = (code, text) => reasons.push({ code, text });
  const normalizeReasons = (list) =>
    (list || []).map((r) => (typeof r === 'object' && r != null && 'code' in r && 'text' in r ? r : { code: 'LEGACY', text: typeof r === 'string' ? r : String(r) }));

  // 1) Override: isSick forces RECOVER
  if (isSick) {
    return {
      tag: 'RECOVER',
      signal: tagToSignal('RECOVER'),
      reasons: [{ code: 'SICK_OVERRIDE', text: 'Ziek/geblesseerd – Herstel voorop.' }],
      instructionClass: TAG_TO_INSTRUCTION_CLASS.RECOVER,
      prescriptionHint: null
    };
  }

  // 2) Base from readiness / redFlags / cycle (no ACWR yet); pass redFlags as-is (null = insufficient input)
  const base = baseFromReadinessCycle(readiness, redFlags, cyclePhase);
  let tag = base.status;
  reasons.push(...normalizeReasons(base.reasons));

  // 3) Lethargy override: Luteal + readiness 4-6 + HRV > 105% baseline → MAINTAIN
  const isLuteal = cyclePhase === 'Luteal';
  const readiness46 = readiness != null && readiness >= 4 && readiness <= 6;
  if (isLuteal && readiness46 && hrvVsBaseline != null && hrvVsBaseline > 105) {
    tag = 'MAINTAIN';
    pushReason('LETHARGY_OVERRIDE', 'Lethargy Override: Luteale fase, readiness 4–6, HRV > 105% baseline — MAINTAIN.');
  }

  // 4) Elite override: Menstrual day 1-3 + readiness >= 8 + HRV >= 98% → PUSH
  const isMenstrual = cyclePhase === 'Menstrual';
  const phaseDay1to3 = phaseDay != null && phaseDay >= 1 && phaseDay <= 3;
  const readinessHigh = readiness != null && readiness >= 8;
  const hrvOk = hrvVsBaseline == null || hrvVsBaseline >= 98;
  if (isMenstrual && phaseDay1to3 && readinessHigh && hrvOk) {
    tag = 'PUSH';
    pushReason('ELITE_REBOUND', 'Elite Override: Menstruale fase dag 1–3, readiness 8+, HRV ≥ 98% — PUSH.');
  }

  // 5) ACWR hard bounds (ceiling/floor)
  const beforeClamp = tag;
  tag = clampToAcwrBounds(tag, acwr);
  if (tag !== beforeClamp && acwr != null) {
    const v = Number(acwr);
    if (v > 1.5) pushReason('ACWR_SPIKE', `ACWR ${acwr} grens: ${tag}.`);
    else if (v > 1.3) pushReason('ACWR_HIGH', `ACWR ${acwr} grens: ${tag}.`);
    else if (v < 0.8) pushReason('ACWR_LOW', `ACWR ${acwr} grens: ${tag}.`);
    else pushReason('ACWR_BOUND', `ACWR ${acwr} grens: ${tag}.`);
  }

  // 6) Option B: no PUSH when ACWR is not computable
  const acwrNotComputable = acwr == null || !Number.isFinite(acwr);
  if (acwrNotComputable && tag === 'PUSH') {
    tag = 'MAINTAIN';
    pushReason('NO_ACWR_NO_PUSH', 'Geen belastingsdata — MAINTAIN.');
  }

  let prescriptionHint = null;
  // 7) Progress intent soft rule: sweet spot + no red flags (explicit 0, not null) + readiness >= 6 + goal PROGRESS → hint only (tag unchanged)
  const acwrNum = acwr != null && Number.isFinite(acwr) ? Number(acwr) : null;
  const inSweetSpot = acwrNum != null && acwrNum >= 0.8 && acwrNum <= 1.3;
  const redFlagsExplicitZero = redFlags != null && Number(redFlags) === 0;
  const readinessOk = readiness != null && Number(readiness) >= 6;
  if (inSweetSpot && redFlagsExplicitZero && readinessOk && goalIntent === 'PROGRESS') {
    prescriptionHint = 'PROGRESSIVE_STIMULUS';
    pushReason('GOAL_PROGRESS', 'Doel: progressie — stimulus hint.');
  }

  // 8) Fixed HIIT classes: do not change tag; add modulation hint so advice never assumes "skip training"
  if (fixedClasses === true) {
    if (tag === 'REST' || tag === 'RECOVER') {
      prescriptionHint = 'HIIT_MODULATE_RECOVERY';
      pushReason('FIXED_CLASS_MODULATION', 'Vaste HIIT: modulatie recovery.');
    } else if (tag === 'MAINTAIN') {
      prescriptionHint = 'HIIT_MODULATE_MAINTAIN';
      pushReason('FIXED_CLASS_MODULATION', 'Vaste HIIT: modulatie maintain.');
    }
  }

  const instructionClass = TAG_TO_INSTRUCTION_CLASS[tag] || 'MAINTAIN';

  return {
    tag,
    signal: tagToSignal(tag),
    reasons: normalizeReasons(reasons),
    instructionClass,
    prescriptionHint
  };
}

/**
 * RED-S / anovulation guardrail: only for NATURAL (not gated). Uses daysSinceLastPeriod (no modulo).
 * When daysSinceLastPeriod > 35 (and optionally no biphasic shift detected) => possible anovulation flag.
 * Gated users (IUD/no-bleed) must not get this flag.
 * @param {{ daysSinceLastPeriod: number|null, cycleGated: boolean }} opts
 * @returns {Array<{ code: string, text: string }>}
 */
function getGuardrailWarnings(opts) {
  const { daysSinceLastPeriod = null, cycleGated = true } = opts || {};
  if (cycleGated || daysSinceLastPeriod == null || !Number.isFinite(Number(daysSinceLastPeriod))) return [];
  const days = Number(daysSinceLastPeriod);
  if (days <= 35) return [];
  return [
    { code: 'POSSIBLE_ANOVULATION', text: 'Possible anovulation / cycle disruption: >35 days since last period. Consider stress, fueling, or specialist.' }
  ];
}

module.exports = { computeStatus, clampToAcwrBounds, tagToSignal, TAG_ORDER, TAG_TO_INSTRUCTION_CLASS, GOAL_INTENT, getGuardrailWarnings };
