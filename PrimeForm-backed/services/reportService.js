/**
 * Weekly Report Generator — aggregate user data + knowledge base, call OpenAI "Race Engineer".
 * Used by GET /api/admin/reports/weekly/:uid
 */

/**
 * Get user profile (intake) from Firestore.
 */
async function getUserProfile(db, uid) {
  const snap = await db.collection('users').doc(String(uid)).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    profile: data.profile || null,
    profileComplete: data.profileComplete === true,
    strava: data.strava || null
  };
}

/**
 * Get daily logs for the last 7 days (HRV, RHR, cycle, subjective/readiness).
 */
async function getLast7DaysLogs(db, admin, uid) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const startTs = admin.firestore.Timestamp.fromDate(sevenDaysAgo);
  const endTs = admin.firestore.Timestamp.fromDate(now);

  const snap = await db
    .collection('users')
    .doc(String(uid))
    .collection('dailyLogs')
    .orderBy('timestamp', 'desc')
    .where('timestamp', '>=', startTs)
    .where('timestamp', '<=', endTs)
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data() || {};
    const ts = d.timestamp;
    const timestamp = ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : (d.date || null);
    const metrics = d.metrics || {};
    const hrv = typeof metrics.hrv === 'number' ? metrics.hrv : (metrics.hrv && metrics.hrv.current) ?? null;
    const rhr = metrics.rhr != null ? (typeof metrics.rhr === 'object' ? metrics.rhr.current : metrics.rhr) : null;
    const readiness = metrics.readiness ?? null;
    const cycleInfo = d.cycleInfo || {};
    return {
      id: doc.id,
      date: d.date,
      timestamp,
      hrv,
      rhr,
      readiness,
      sleep: metrics.sleep ?? null,
      phase: cycleInfo.phase,
      isLuteal: cycleInfo.isLuteal,
      recommendation: d.recommendation ? d.recommendation.status : null
    };
  });
}

/**
 * Get Strava activities for the last 7 days from Firestore (users/{uid}/activities).
 * Returns empty array if no activities or no Strava; no throw.
 */
async function getLast7DaysActivities(db, uid) {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const snap = await db
    .collection('users')
    .doc(String(uid))
    .collection('activities')
    .get();

  const activities = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((a) => {
      const dateStr = (a.start_date_local || a.start_date || '').toString().slice(0, 10);
      return dateStr >= cutoff;
    })
    .sort((a, b) => (b.start_date_local || b.start_date || '').localeCompare(a.start_date_local || a.start_date || ''));

  return activities;
}

/**
 * Build stats from logs and activities for the report.
 */
function buildStats(logs, activities) {
  const hrvValues = logs.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(Number(v)));
  const rhrValues = logs.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(Number(v)));
  const readinessValues = logs.map((l) => l.readiness).filter((v) => v != null && Number.isFinite(Number(v)));

  let load_total = 0;
  for (const a of activities) {
    const score = a.suffer_score != null ? Number(a.suffer_score) : null;
    if (Number.isFinite(score)) load_total += score;
    else if (a.moving_time && a.average_heartrate) load_total += (a.moving_time / 3600) * (a.average_heartrate || 0) * 0.01;
  }

  return {
    load_total: Math.round(load_total * 10) / 10,
    hrv_avg: hrvValues.length ? Math.round((hrvValues.reduce((s, v) => s + Number(v), 0) / hrvValues.length) * 10) / 10 : null,
    rhr_avg: rhrValues.length ? Math.round(rhrValues.reduce((s, v) => s + Number(v), 0) / rhrValues.length) : null,
    subjective_avg: readinessValues.length ? Math.round((readinessValues.reduce((s, v) => s + Number(v), 0) / readinessValues.length) * 10) / 10 : null,
    days_with_logs: logs.length,
    activities_count: activities.length
  };
}

/**
 * Generate weekly report: aggregate data + OpenAI Race Engineer.
 * @param {object} opts - { db, admin, openai, knowledgeBaseContent, uid }
 * @returns {Promise<{ stats, message }>}
 */
async function generateWeeklyReport(opts) {
  const { db, admin, openai, knowledgeBaseContent, uid } = opts;
  if (!db || !openai) throw new Error('db and openai required');

  const [profileData, logs, activities] = await Promise.all([
    getUserProfile(db, uid),
    getLast7DaysLogs(db, admin, uid),
    getLast7DaysActivities(db, uid)
  ]);

  const profile = profileData?.profile || {};
  const intakeText = JSON.stringify({
    fullName: profile.fullName,
    goals: profile.goals,
    programmingType: profile.programmingType,
    redFlags: profile.redFlags,
    cycleData: profile.cycleData
  }, null, 2);

  const stats = buildStats(logs, activities);
  const logsSummary = logs.length
    ? logs.map((l) => `- ${l.date || l.timestamp?.slice(0, 10)}: HRV=${l.hrv ?? '—'} RHR=${l.rhr ?? '—'} Readiness=${l.readiness ?? '—'} Fase=${l.phase ?? '—'}`).join('\n')
    : 'Geen logdata voor de afgelopen 7 dagen.';
  const activitiesSummary = activities.length
    ? activities.map((a) => {
        const dateStr = (a.start_date_local || a.start_date || '').toString().slice(0, 10);
        const dist = a.distance != null ? `${(a.distance / 1000).toFixed(1)} km` : '';
        const load = a.suffer_score != null ? `Load ${a.suffer_score}` : '';
        return `- ${dateStr} ${a.type || 'Workout'} ${dist} ${load}`.trim();
      }).join('\n')
    : 'Geen Strava-activiteiten in de afgelopen 7 dagen.';

  const systemPrompt = `Je bent de PrimeForm Race Engineer. Je baseert je advies strikt op de meegeleverde [KNOWLEDGE BASE]. Je houdt rekening met het [INTAKE PROFIEL] van de atleet. Analyseer de balans tussen belasting (Strava) en capaciteit (HRV/RHR/Cyclus). Schrijf een weekevaluatie + advies voor de volgende week. Antwoord uitsluitend met een geldig JSON-object met exact twee velden: "stats" (object met load_total, hrv_avg, rhr_avg, subjective_avg) en "message" (string: de concepttekst voor de atleet in het Nederlands, in 'jij'-vorm). Geen markdown, geen codeblokken.`;

  const userPrompt = `[KNOWLEDGE BASE]\n${knowledgeBaseContent || '(Geen knowledge base geladen.)'}\n\n[INTAKE PROFIEL]\n${intakeText}\n\n[LOGS LAATSTE 7 DAGEN]\n${logsSummary}\n\n[STRAVA ACTIVITEITEN LAATSTE 7 DAGEN]\n${activitiesSummary}\n\n[BEREKENDE STATS]\n${JSON.stringify(stats, null, 2)}\n\nGeef het gevraagde JSON-object met "stats" en "message".`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.6,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { stats, message: content || 'Geen tekst gegenereerd.' };
  }

  return {
    stats: parsed.stats || stats,
    message: typeof parsed.message === 'string' ? parsed.message : (parsed.message ? String(parsed.message) : 'Geen weekrapport gegenereerd.')
  };
}

module.exports = {
  generateWeeklyReport,
  getUserProfile,
  getLast7DaysLogs,
  getLast7DaysActivities,
  buildStats
};
