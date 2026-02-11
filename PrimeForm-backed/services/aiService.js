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
 * @returns {Promise<{ stats: string, message: string }>}
 */
async function generateWeekReport(athleteId, deps) {
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

  const athleteContext = `
Name: ${profile.fullName || 'Unknown'}
Sport: ${profile.sport || profile.goals?.[0] || 'General fitness'}
Level: ${level} (based on CTL: chronic_load=${chronicLoad.toFixed(0)}, <400=Rookie, 400-700=Active, >700=Elite)
Current Phase: ${phaseInfo.phaseName || 'Unknown'}
ACWR: ${Number.isFinite(acwr) ? acwr.toFixed(2) : 'N/A'}
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

  const systemPrompt = `ROLE: You are the PrimeForm Race Engineer, an elite performance coach for female athletes.

CONTEXT — PRIMEFORM KNOWLEDGE BASE (Strict rules; follow these exactly):
${knowledgeBase}

ATHLETE CONTEXT:
${athleteContext}

STRICT INSTRUCTIONS:
- Use the provided Knowledge Base rules for Luteal/Follicular logic, terminology (Lingo), and guardrails.
- Base your advice on ACWR, phase, and readiness. Never contradict the Knowledge Base.
- Write in natural, supportive tone. Use PrimeForm terminology.
- Output MUST be valid JSON with exactly two fields: "stats" (a brief summary string, e.g. "Acute: 45, Chronic: 42, ACWR: 1.07") and "message" (the full report text for the athlete).`;

  const userPrompt = `[CHECK-INS — LAST 7 DAYS]\n${logsSummary}\n\n[ACTIVITIES — LAST 7 DAYS]\n${activitiesSummary}\n\n[BEREKENDE STATS]\nAcute Load: ${acuteLoad.toFixed(1)}, Chronic Load: ${chronicLoad.toFixed(1)}, ACWR: ${acwr.toFixed(2)}, Level: ${level}, Phase: ${phaseInfo.phaseName}\n\nGenerate the JSON object with "stats" and "message".`;

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
