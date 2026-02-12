/**
 * AI Service — Weekly Report generation via OpenAI.
 * Uses knowledge base (logic, science, lingo, guardrails, examples) and Firestore data.
 */

const fs = require('fs');
const path = require('path');
const reportService = require('./reportService');
const cycleService = require('./cycleService');
const { calculateActivityLoad, calculatePrimeLoad, calculateACWR } = require('./calculationService');

// In-memory cache for knowledge base (avoid reading files on every request)
let _cachedKnowledgeBase = null;

/**
 * Load logic.md, science.md, lingo.md, guardrails.md, examples.md from knowledge/
 * and combine into a single string wrapped in <knowledge_base> tags.
 * @returns {string} Combined content or empty string if files missing
 */
function loadKnowledgeBase() {
  if (_cachedKnowledgeBase !== null) return _cachedKnowledgeBase;

  const knowledgeDir = path.join(__dirname, '..', 'knowledge');
  const files = ['logic.md', 'science.md', 'lingo.md', 'guardrails.md', 'examples.md'];
  const parts = [];

  for (const file of files) {
    try {
      const filePath = path.join(knowledgeDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        parts.push(`--- ${file} ---\n${content}`);
      }
    } catch (err) {
      console.warn(`[aiService] Could not read ${file}:`, err.message);
    }
  }

  const combined = parts.join('\n\n');
  _cachedKnowledgeBase = `<knowledge_base>\n${combined}\n</knowledge_base>`;
  return _cachedKnowledgeBase;
}

/**
 * Determine athlete level from Chronic Training Load (CTL).
 * <400=Rookie, 400-700=Active, >700=Elite
 */
function getLevelFromCTL(ctl) {
  if (!Number.isFinite(ctl)) return 'Unknown';
  if (ctl < 400) return 'Rookie';
  if (ctl <= 700) return 'Active';
  return 'Elite';
}

/**
 * Generate a weekly report for an athlete using OpenAI.
 * Uses users/{athleteId}/dailyLogs and users/{athleteId}/activities (last 7 days).
 * @param {string} athleteId - Firestore user document ID
 * @param {object} deps - { db, admin, openai }
 * @param {object} [opts] - { coachNotes?, directive?, injuries? } for cockpit context
 * @returns {Promise<{ stats: string, message: string }>}
 */
async function generateWeekReport(athleteId, deps, opts = {}) {
  const { db, admin, openai } = deps;
  if (!db || !openai) throw new Error('db and openai required');

  const [profileData, logs7, activities7, logs56, activities56] = await Promise.all([
    reportService.getUserProfile(db, athleteId),
    reportService.getLast7DaysLogs(db, admin, athleteId),
    reportService.getLast7DaysActivities(db, athleteId),
    reportService.getLast56DaysLogs(db, admin, athleteId),
    reportService.getLast56DaysActivities(db, athleteId)
  ]);

  const userDoc = await db.collection('users').doc(String(athleteId)).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const profile = profileData?.profile || userData.profile || {};
  const stats = userData.stats || {};

  const knowledgeBase = loadKnowledgeBase();

  // Build log lookup per date (for Prime Load calculation)
  const logByDate = new Map();
  for (const l of logs56) {
    const key = (l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '').slice(0, 10);
    if (key) logByDate.set(key, l);
  }

  const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  const lastPeriodDate = cycleData.lastPeriodDate || cycleData.lastPeriod || null;
  const cycleLength = Number(cycleData.avgDuration) || 28;
  const todayStr = new Date().toISOString().slice(0, 10);
  const maxHr = profile.max_heart_rate != null ? Number(profile.max_heart_rate) : null;

  const phaseInfo = lastPeriodDate
    ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, todayStr)
    : { phaseName: 'Unknown', currentCycleDay: null };

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
  const twentyEightDaysAgo = new Date();
  twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
  const twentyEightDaysAgoStr = twentyEightDaysAgo.toISOString().slice(0, 10);

  function activityDateString(a) {
    const raw = a.start_date_local ?? a.start_date;
    if (raw == null) return '';
    if (typeof raw === 'string') return raw.slice(0, 10);
    if (typeof raw?.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
    if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
    return String(raw).slice(0, 10);
  }

  const activities56WithPrime = activities56.map((a) => {
    const dateStr = activityDateString(a);
    const rawLoad = calculateActivityLoad(a, profile);
    const phaseInfoForDate = lastPeriodDate && dateStr
      ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, dateStr)
      : { phaseName: null };
    const phase = phaseInfoForDate.phaseName;
    const readinessScore = logByDate.get(dateStr)?.readiness ?? 10;
    const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
    const primeLoad = calculatePrimeLoad(rawLoad, phase, readinessScore, avgHr, maxHr);
    const hours = (a.moving_time != null ? Number(a.moving_time) : 0) / 3600;
    return { ...a, _dateStr: dateStr, _primeLoad: primeLoad, _hours: hours };
  });

  const activitiesLast7 = activities56WithPrime.filter((a) => a._dateStr >= sevenDaysAgoStr);
  const activitiesLast28 = activities56WithPrime.filter((a) => a._dateStr >= twentyEightDaysAgoStr);

  const acuteLoad = activitiesLast7.reduce((s, a) => s + a._primeLoad, 0);
  const chronicLoadRaw = activitiesLast28.reduce((s, a) => s + a._primeLoad, 0);
  const chronicLoad = chronicLoadRaw / 4;
  const acwr = calculateACWR(acuteLoad, chronicLoad);

  const readinessValues = logs7.map((l) => l.readiness).filter((v) => v != null && Number.isFinite(Number(v)));
  const avgReadiness = readinessValues.length
    ? (readinessValues.reduce((s, v) => s + Number(v), 0) / readinessValues.length).toFixed(1)
    : null;

  const totalDurationSec = activitiesLast7.reduce((s, a) => s + (a.moving_time || 0), 0);
  const totalDurationHours = (totalDurationSec / 3600).toFixed(1);

  const level = getLevelFromCTL(chronicLoad);

  // Extra context uit profiel: doelen, valkuilen, blessures
  const goalsRaw = profile.goals != null ? profile.goals : userData.goals;
  const pitfallsRaw = profile.pitfalls != null ? profile.pitfalls : userData.pitfalls;
  const injuryRaw =
    profile.injuryHistory ??
    profile.injuries ??
    userData.injuryHistory ??
    userData.injuries;

  function toTextList(value) {
    if (!value) return 'n.v.t.';
    if (Array.isArray(value)) {
      return value.length ? value.join(', ') : 'n.v.t.';
    }
    return String(value);
  }

  const injuriesFromOpts = opts.injuries && opts.injuries.length ? opts.injuries.join(', ') : toTextList(injuryRaw);
  const contextProfileLine = `CONTEXT_PROFILE: { Doelen: ${toTextList(
    goalsRaw,
  )}, Valkuilen: ${toTextList(pitfallsRaw)}, Blessures: ${injuriesFromOpts} }`;

  const coachContext = [
    opts.directive ? `Huidige directief (coach cockpit): ${opts.directive}` : '',
    opts.coachNotes ? `Coach notities / Engineering Notes:\n${opts.coachNotes}` : ''
  ].filter(Boolean).join('\n');

  const directiveLabel = opts.directive || (Number.isFinite(acwr) ? (acwr > 1.5 ? 'REST' : acwr > 1.3 ? 'RECOVER' : acwr >= 0.8 && acwr <= 1.3 ? 'PUSH' : 'MAINTAIN') : 'N/A');
  const athleteContext = `
Name: ${profile.fullName || 'Unknown'}
Sport: ${profile.sport || profile.goals?.[0] || 'General fitness'}
Directive: ${directiveLabel}
Current Phase: ${phaseInfo.phaseName || 'Unknown'}
Belastingsbalans (ACWR): ${Number.isFinite(acwr) ? acwr.toFixed(2) : 'N/A'}
Average Readiness (7d): ${avgReadiness ?? 'N/A'}
Total Duration (7d): ${totalDurationHours}h
`.trim();

  const logsSummary = logs7.length
    ? logs7.map((l) => {
        const dateStr = l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '—';
        const rec = l.recommendation ?? '—';
        return `- ${dateStr}: ${rec} | HRV=${l.hrv ?? '—'} RHR=${l.rhr ?? '—'} Readiness=${l.readiness ?? '—'} Phase=${l.phase ?? '—'}`;
      }).join('\n')
    : 'No check-in data for the last 7 days.';

  const activitiesSummary = activitiesLast7.length
    ? activitiesLast7.map((a) => {
        const dateStr = a._dateStr || activityDateString(a);
        const dist = a.distance != null ? `${(a.distance / 1000).toFixed(1)} km` : '';
        const prime = a._primeLoad != null ? `PrimeLoad ${a._primeLoad}` : '';
        return `- ${dateStr} ${a.type || 'Workout'} ${dist} ${prime}`.trim();
      }).join('\n')
    : 'No activities in the last 7 days.';

  const systemPrompt = `### ROLE & CONTEXT
You are the **PrimeForm Performance Engineer**. You analyze CrossFit and Hybrid athletes using the rules defined in your Knowledge Base. You are a technical authority, but you speak the language of the athlete.

### KNOWLEDGE BASE PROTOCOL (STRICT)
- **LOGIC (\`logic.md\`):** Follow the hierarchy and overrides.
- **SCIENCE (\`science.md\`):** Use for "Internal Cost" vs "External Load" explanations.
- **LINGO (\`lingo.md\`):** Direct, Dutch, technical, "je/jouw".

### THE "NO JARGON" RULE
- **CRITICAL:** Gebruik NOOIT de termen "ACWR" of "Ratio" in de output.
- **Vertaling:** Gebruik termen als **"Belastingsbalans"**, **"Trainingsvolume"**, **"Opbouw"** of **"Trend"**.
  - *Slecht:* "Je ACWR is 1.4."
  - *Goed:* "Je trainingsvolume is deze week aanzienlijk gepiekt ten opzichte van je gemiddelde."

### ZERO-NEGATIVE LOGIC
- Bespreek nooit waarom een regel (zoals de Elite Override) *niet* van toepassing is.
- Noem de atleet nooit bij hun niveau-label (Rookie/Active). Focus op de fysiologie van hun "systeem".

### OUTPUT STRUCTURE (WHATSAPP READY)

**1. 🏎️ DE STATUS-CHECK**
- Icon (🟢/🟠/🔴) + Krachtige one-liner (max 20 woorden).
- Tag: **[PUSH]** / **[MAINTAIN]** / **[RECOVER]** / **[DELOAD]**.

**2. 📊 DATA DEEP-DIVE (DE WAAROM)**
- 4-5 bullets max.
- Verbind data met de fysiologie uit \`science.md\`.
- Maak het onderscheid tussen **External Load** (wat ze deden) en **Internal Cost** (de hormonale/fysiologische prijs).
- Benoem bij een Elite Rebound de fysiologische oorzaak (progesteron-drop), niet het label.

**3. 🛠️ HET DIRECTIEF (KOMENDE WEEK)**
- 4-6 concrete bullets (Belasting, Intensiteit, Voeding, Herstel).
- Gebruik termen uit \`lingo.md\` (bv. "Zone 1 Aerobic Flow").

**4. 📻 RACE ENGINEER QUOTE**
- Eén scherpe, technische uitsmijter (max 15 woorden).

---

KNOWLEDGE BASE CONTENT (actual content of the files — follow strictly):
${knowledgeBase}

---

ATHLETE CONTEXT (use for personalisation):
${athleteContext}

${contextProfileLine}
${coachContext ? `\n${coachContext}\n` : ''}

OUTPUT FORMAT: You MUST respond with valid JSON only. Two fields:
- "stats": a brief summary string (e.g. "Acute: 45, Chronic: 42, Belastingsbalans 1.07").
- "message": the full report in Markdown, using the 4 sections above (DE STATUS-CHECK, DATA DEEP-DIVE, HET DIRECTIEF, RACE ENGINEER QUOTE). No "ACWR" or "Ratio" in the message.`;

  const userPrompt = `[CHECK-INS — LAST 7 DAYS]\n${logsSummary}\n\n[ACTIVITIES — LAST 7 DAYS]\n${activitiesSummary}\n\n[BEREKENDE STATS]\nAcute Load: ${acuteLoad.toFixed(1)}, Chronic Load: ${chronicLoad.toFixed(1)}, Belastingsbalans: ${acwr.toFixed(2)}, Directief: ${directiveLabel}, Phase: ${phaseInfo.phaseName}\n\nGenerate the JSON object with "stats" and "message".`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {
      stats: `Acute: ${acuteLoad.toFixed(1)}, Chronic: ${chronicLoad.toFixed(1)}, ACWR: ${acwr.toFixed(2)}`,
      message: content || 'No report generated.'
    };
  }

  return {
    stats: typeof parsed.stats === 'string' ? parsed.stats : JSON.stringify(parsed.stats || {}),
    message: typeof parsed.message === 'string' ? parsed.message : String(parsed.message || 'No report generated.')
  };
}

module.exports = {
  loadKnowledgeBase,
  generateWeekReport
};
