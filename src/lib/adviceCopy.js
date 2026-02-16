/**
 * Deterministic UI copy for Dagopdracht from instructionClass + prescriptionHint.
 * Pure mapping; no AI. Fallback: derive instructionClass from tag if missing.
 * Athlete-facing copy: no "ACWR" or "Belastingsband"; use simple Dutch (trainbelasting).
 */

/** Reason code → athlete-facing Dutch text (coach/admin see technical .text from API). */
export const REASON_CODE_TO_ATHLETE_TEXT = {
  ACWR_SPIKE: 'Je belasting is plots sterk gestegen.',
  ACWR_HIGH: 'Je belasting is hoger dan je normale niveau.',
  ACWR_LOW: 'Je belasting is lager dan je normale niveau.',
  ACWR_BOUND: 'Je trainbelasting speelt mee in het advies.',
  NO_ACWR_NO_PUSH: 'Nog niet genoeg belastingsdata voor een vol advies.',
  MISSING_CHECKIN_INPUT: 'Geen check-in vandaag. Doe eerst je check-in voor een persoonlijk advies.',
  SICK_OVERRIDE: 'Ziek of geblesseerd — herstel voorop.',
  LETHARGY_OVERRIDE: 'Luteale fase en vermoeidheid — we houden het rustig.',
  ELITE_REBOUND: 'Goede conditie in vroege menstruatie — je mag pushen.',
  GOAL_PROGRESS: 'Je doel is progressie — vandaag mag je gecontroleerd een stap zetten.',
  FIXED_CLASS_MODULATION: 'Je hebt vaste lessen — we passen het advies daarop aan.',
  LEGACY: null
}

const TAG_TO_INSTRUCTION_CLASS = {
  REST: 'NO_TRAINING',
  RECOVER: 'ACTIVE_RECOVERY',
  MAINTAIN: 'MAINTAIN',
  PUSH: 'HARD_PUSH'
}

const INSTRUCTION_COPY = {
  NO_TRAINING: {
    title: 'Rust',
    summary: 'Je herstel-signalen zijn onvoldoende voor training.',
    task: 'Vandaag geen training. Alleen wandelen/mobiliteit als het goed voelt.'
  },
  ACTIVE_RECOVERY: {
    title: 'Herstel',
    summary: 'Trainen mag, maar alleen laag en gecontroleerd.',
    task: '20–45 min rustig (Z1/Z2) óf techniek/kracht licht (RPE ≤ 5).'
  },
  MAINTAIN: {
    title: 'Maintain',
    summary: 'Stabiele dag: behoud ritme, geen extra piek.',
    task: 'Plan zoals normaal, maar houd intensiteit/volume binnen je bandbreedte.'
  },
  HARD_PUSH: {
    title: 'Push',
    summary: 'Je signalen zijn groen en je belastbaarheid is goed.',
    task: 'Kies één intensieve prikkel (kwaliteit) en voer die strak uit.'
  }
}

const PROGRESSIVE_STIMULUS_OVERLAY = {
  badge: 'Progressieve prikkel',
  summary: 'Je signalen zijn groen en je belasting is stabiel; vandaag mag je gecontroleerd opschalen.',
  task: 'Voeg één progressiestap toe: volume +5–10% of 1 extra blok/rep; houd RPE ≤ 7.',
  guardrail: 'Stop als RPE doorschiet of herstel-alarmen toenemen.'
}

const HIIT_MODULATE_RECOVERY_OVERLAY = {
  badge: 'HIIT — aanpassen',
  task: 'Ga naar de les, maar beperk intensiteit (RPE ≤ 5): sla max-effort blokken over en neem extra rust.'
}

const HIIT_MODULATE_MAINTAIN_OVERLAY = {
  badge: 'HIIT — aanpassen',
  task: 'Ga naar de les en houd het rustig; kies maximaal één blok om te pushen.'
}

/**
 * @param {object} opts
 * @param {string} [opts.tag] - REST | RECOVER | MAINTAIN | PUSH
 * @param {string} [opts.instructionClass] - NO_TRAINING | ACTIVE_RECOVERY | MAINTAIN | HARD_PUSH
 * @param {string|null} [opts.prescriptionHint] - e.g. "PROGRESSIVE_STIMULUS"
 * @param {number|null} [opts.readiness] - 1-10
 * @param {number|null} [opts.redFlagsCount] - count of red flags
 * @param {string|null} [opts.acwrBand] - e.g. "SWEET", "0.8-1.3"
 * @param {{ code: string, text: string }[]} [opts.reasons] - backend reasonCodes; athlete sees mapped text
 * @returns {{ title: string, summary: string, task: string, badge?: string|null, guardrail?: string|null, whyBullets: string[] }}
 */
function acwrBandToAthleteLabel(band) {
  if (!band) return null
  const b = String(band).toUpperCase()
  if (b === 'SPIKE' || b === '>1.5') return 'Trainbelasting is momenteel hoog. Herstel heeft prioriteit.'
  if (b === 'OVERREACHING' || b === '1.3-1.5') return 'Trainbelasting is verhoogd. We houden het rustig.'
  if (b === 'SWEET' || b === '0.8-1.3') return 'Trainbelasting binnen bereik.'
  if (b === 'LOW' || b === '<0.8') return 'Trainbelasting is laag. Behoud ritme.'
  return 'Trainbelasting: binnen bereik.'
}

export function getAdviceCopy(opts = {}) {
  const tag = opts.tag ?? 'MAINTAIN'
  const instructionClass = opts.instructionClass ?? TAG_TO_INSTRUCTION_CLASS[tag] ?? 'MAINTAIN'
  const prescriptionHint = opts.prescriptionHint ?? null
  const readiness = opts.readiness != null && Number.isFinite(Number(opts.readiness)) ? Number(opts.readiness) : null
  const redFlagsCount = opts.redFlagsCount != null && Number.isFinite(Number(opts.redFlagsCount)) ? Number(opts.redFlagsCount) : null
  const acwrBand = opts.acwrBand != null && String(opts.acwrBand).trim() !== '' ? String(opts.acwrBand) : null
  const reasons = Array.isArray(opts.reasons) ? opts.reasons : []

  const base = INSTRUCTION_COPY[instructionClass] ?? INSTRUCTION_COPY.MAINTAIN
  let title = base.title
  let summary = base.summary
  let task = base.task
  let badge = null
  let guardrail = null

  if (prescriptionHint === 'PROGRESSIVE_STIMULUS') {
    badge = PROGRESSIVE_STIMULUS_OVERLAY.badge
    summary = PROGRESSIVE_STIMULUS_OVERLAY.summary
    task = PROGRESSIVE_STIMULUS_OVERLAY.task
    guardrail = PROGRESSIVE_STIMULUS_OVERLAY.guardrail
  }
  if (prescriptionHint === 'HIIT_MODULATE_RECOVERY') {
    badge = HIIT_MODULATE_RECOVERY_OVERLAY.badge
    task = HIIT_MODULATE_RECOVERY_OVERLAY.task
  }
  if (prescriptionHint === 'HIIT_MODULATE_MAINTAIN') {
    badge = HIIT_MODULATE_MAINTAIN_OVERLAY.badge
    task = HIIT_MODULATE_MAINTAIN_OVERLAY.task
  }

  const whyBullets = []
  if (readiness != null) whyBullets.push(`Readiness: ${readiness}/10`)
  if (redFlagsCount != null) whyBullets.push(`Herstel-alarmen: ${redFlagsCount}`)
  const loadLabel = acwrBandToAthleteLabel(acwrBand)
  if (loadLabel) whyBullets.push(loadLabel)
  for (const r of reasons) {
    const code = r && typeof r.code === 'string' ? r.code : (typeof r === 'string' ? r : null)
    const athleteText = code ? REASON_CODE_TO_ATHLETE_TEXT[code] : null
    if (athleteText) whyBullets.push(athleteText)
  }
  const why = whyBullets.slice(0, 5)

  return { title, summary, task, badge, guardrail, whyBullets: why }
}
