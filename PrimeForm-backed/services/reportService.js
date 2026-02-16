/**
 * Weekly Report Generator v2.0 — aggregate user data + knowledge base, call OpenAI "Race Engineer".
 * Used by GET /api/admin/reports/weekly/:uid
 */

const fs = require('fs');
const path = require('path');
const { FieldValue } = require('@google-cloud/firestore');
const { calculateActivityLoad, calculatePrimeLoad, determineAthleteLevel, calculateACWR } = require('./calculationService');
const cycleService = require('./cycleService');
const { deriveStartDateTs, deriveDayKey } = require('../lib/activityKeys');

/**
 * Load PrimeForm Knowledge Base (logic, science, lingo) into one string.
 * @param {string} [knowledgeDir] - Path to knowledge folder (default: ../knowledge relative to this file)
 * @returns {string} Combined content or empty string if files missing
 */
function loadKnowledgeContext(knowledgeDir) {
  const dir = knowledgeDir || path.join(__dirname, '..', 'knowledge');
  const files = ['logic.md', 'science.md', 'lingo.md'];
  const parts = [];
  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        parts.push(`--- ${file} ---\n${content}`);
      }
    } catch {
      // Fallback: geen crash bij ontbrekend bestand
    }
  }
  return parts.length ? parts.join('\n\n') : '';
}

/**
 * Format user profile / intake to a readable athlete context string.
 * @param {object} profile - User profile or intake (goals, injuryHistory, trainingPreferences, etc.)
 * @returns {string}
 */
function formatAthleteContext(profile) {
  if (!profile || typeof profile !== 'object') return 'Geen intake of profiel beschikbaar.';
  const lines = [];
  if (profile.fullName) lines.push(`Naam: ${profile.fullName}`);
  if (profile.goals && (Array.isArray(profile.goals) ? profile.goals.length : profile.goals)) {
    lines.push(`Doelen: ${Array.isArray(profile.goals) ? profile.goals.join(', ') : String(profile.goals)}`);
  }
  if (profile.injuryHistory) lines.push(`Blessure-/klachtenhistorie: ${String(profile.injuryHistory)}`);
  if (profile.injuries) lines.push(`Blessures/klachten: ${String(profile.injuries)}`);
  if (profile.trainingPreferences) lines.push(`Trainingsvoorkeuren: ${String(profile.trainingPreferences)}`);
  if (profile.programmingType) lines.push(`Type programma: ${String(profile.programmingType)}`);
  if (profile.redFlags && Array.isArray(profile.redFlags) && profile.redFlags.length) {
    lines.push(`Red flags (intake): ${profile.redFlags.join(', ')}`);
  }
  if (profile.cycleData && typeof profile.cycleData === 'object') {
    const cd = profile.cycleData;
    if (cd.avgDuration) lines.push(`Gem. cyclusduur: ${cd.avgDuration} dagen`);
    if (cd.contraception) lines.push(`Anticonceptie: ${cd.contraception}`);
  }
  if (profile.successScenario) lines.push(`Successcenario (12 weken): ${String(profile.successScenario)}`);
  if (profile.painPoint) lines.push(`Pijnpunt: ${String(profile.painPoint)}`);
  return lines.length ? lines.join('\n') : 'Geen intake of profiel beschikbaar.';
}

/**
 * Get user profile (intake) from Firestore.
 * Read-time migration: if cycleData.lastPeriod exists and lastPeriodDate missing, write lastPeriodDate and remove lastPeriod once.
 */
async function getUserProfile(db, uid) {
  const userRef = db.collection('users').doc(String(uid));
  const snap = await userRef.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  let profile = data.profile || null;
  const cd = profile?.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : null;
  if (cd?.lastPeriod != null && cd.lastPeriodDate == null) {
    const legacy = typeof cd.lastPeriod === 'string' ? cd.lastPeriod : String(cd.lastPeriod);
    if (/^\d{4}-\d{2}-\d{2}$/.test(legacy)) {
      await userRef.update({
        'profile.cycleData.lastPeriodDate': legacy,
        'profile.cycleData.lastPeriod': FieldValue.delete()
      });
      profile = {
        ...profile,
        cycleData: { ...profile.cycleData, lastPeriodDate: legacy }
      };
      delete profile.cycleData.lastPeriod;
    }
  }
  return {
    profile,
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
      recommendation: d.recommendation ? d.recommendation.status : null,
      adviceContext: d.adviceContext ?? 'STANDARD'
    };
  });
}

/**
 * Get daily logs for the last 56 days (voor readiness per datum bij prime_load berekening).
 */
async function getLast56DaysLogs(db, admin, uid) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fiftySixDaysAgo = new Date(startOfToday);
  fiftySixDaysAgo.setDate(fiftySixDaysAgo.getDate() - 56);
  const startTs = admin.firestore.Timestamp.fromDate(fiftySixDaysAgo);
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
    const timestamp = ts && typeof ts.toDate === 'function' ? ts.toDate() : (d.date || null);
    const metrics = d.metrics || {};
    const hrv = typeof metrics.hrv === 'number' ? metrics.hrv : (metrics.hrv && metrics.hrv.current) ?? null;
    const rhr = metrics.rhr != null ? (typeof metrics.rhr === 'object' ? metrics.rhr.current : metrics.rhr) : null;
    const readiness = metrics.readiness ?? null;
    const cycleInfo = d.cycleInfo || {};
    return {
      id: doc.id,
      date: d.date,
      timestamp: timestamp && typeof timestamp.toISOString === 'function' ? timestamp.toISOString() : (d.date || null),
      hrv,
      rhr,
      readiness,
      sleep: metrics.sleep ?? null,
      phase: cycleInfo.phase,
      isLuteal: cycleInfo.isLuteal,
      recommendation: d.recommendation ? d.recommendation.status : null,
      adviceContext: d.adviceContext ?? 'STANDARD'
    };
  });
}

/**
 * Normalize activity date to YYYY-MM-DD for filtering (ISO string, timestamp, or Firestore Timestamp).
 */
function activityDateString(a) {
  const raw = a.start_date_local ?? a.start_date;
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

/** Normalize a date value (string, Firestore Timestamp, Date) to YYYY-MM-DD. Used for root/manual activities. */
function toIsoDateString(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (typeof val.toDate === 'function') return val.toDate().toISOString().slice(0, 10);
  if (typeof val === 'number') return new Date(val * 1000).toISOString().slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

/**
 * Get Strava activities for the last 7 days from Firestore (users/{uid}/activities).
 * Date filtering uses start_date_local or start_date (ISO string or timestamp).
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
      const dateStr = activityDateString(a);
      return dateStr.length >= 10 && dateStr >= cutoff;
    })
    .sort((a, b) => activityDateString(b).localeCompare(activityDateString(a)));

  return activities;
}

/**
 * Get activities for the last 56 days from users/{uid}/activities.
 * Uses range query on startDateTs when present; fallback to get()+filter for legacy docs without startDateTs.
 */
async function getLast56DaysActivities(db, uid) {
  const windowStartTs = Date.now() - 56 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(windowStartTs).toISOString().slice(0, 10);
  const collRef = db.collection('users').doc(String(uid)).collection('activities');

  let snap;
  try {
    snap = await collRef.where('startDateTs', '>=', windowStartTs).orderBy('startDateTs', 'desc').get();
  } catch (indexErr) {
    snap = await collRef.get();
  }

  let list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const hasStartDateTs = list.some((a) => a.startDateTs != null);
  if (!hasStartDateTs && list.length > 0) {
    list = list.filter((a) => {
      const dateStr = activityDateString(a);
      return dateStr.length >= 10 && dateStr >= cutoff;
    }).sort((a, b) => activityDateString(b).localeCompare(activityDateString(a)));
    return list;
  }

  if (!hasStartDateTs && list.length === 0) {
    const fallbackSnap = await collRef.get();
    list = fallbackSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((a) => {
        const dateStr = activityDateString(a);
        return dateStr.length >= 10 && dateStr >= cutoff;
      })
      .sort((a, b) => activityDateString(b).localeCompare(activityDateString(a)));
    return list;
  }

  list = list.filter((a) => a.startDateTs != null && a.startDateTs >= windowStartTs);
  list.sort((a, b) => (b.startDateTs || 0) - (a.startDateTs || 0));
  return list;
}

/**
 * Get manual activities (root collection) for the last 56 days.
 * Uses composite query (userId + startDateTs) when index exists; fallback to userId-only + filter.
 * Requires Firestore index: activities (userId ASC, startDateTs DESC).
 */
async function getRootActivities56(db, uid) {
  const windowStartTs = Date.now() - 56 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(windowStartTs).toISOString().slice(0, 10);
  const uidStr = String(uid);

  let snap;
  try {
    snap = await db
      .collection('activities')
      .where('userId', '==', uidStr)
      .where('startDateTs', '>=', windowStartTs)
      .orderBy('startDateTs', 'desc')
      .get();
  } catch (indexErr) {
    snap = await db.collection('activities').where('userId', '==', uidStr).get();
  }

  let list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const hasStartDateTs = list.some((a) => a.startDateTs != null);
  if (!hasStartDateTs) {
    list = list
      .map((a) => {
        const dateStr = toIsoDateString(a.date);
        return {
          ...a,
          date: dateStr,
          start_date_local: dateStr,
          start_date: dateStr,
          moving_time: (a.duration_minutes != null ? Number(a.duration_minutes) : 0) * 60,
          type: a.type || 'Manual Session',
          source: 'manual',
        };
      })
      .filter((a) => a.date.length >= 10 && a.date >= cutoff)
      .sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }

  list = list
    .filter((a) => a.startDateTs >= windowStartTs)
    .map((a) => {
      const dateStr = a.dayKey || toIsoDateString(a.date);
      return {
        ...a,
        date: dateStr,
        start_date_local: dateStr,
        start_date: dateStr,
        moving_time: (a.duration_minutes != null ? Number(a.duration_minutes) : 0) * 60,
        type: a.type || 'Manual Session',
        source: 'manual',
      };
    })
    .sort((a, b) => (b.startDateTs || 0) - (a.startDateTs || 0));
  return list;
}

/**
 * Build stats from logs and activities for the report.
 * load_total: som van Strava suffer_score (Relative Effort) per activiteit; ontbreekt die, dan TRIMP- of RPE-fallback.
 */
function buildStats(logs, activities, profile = {}) {
  const hrvValues = logs.map((l) => l.hrv).filter((v) => v != null && Number.isFinite(Number(v)));
  const rhrValues = logs.map((l) => l.rhr).filter((v) => v != null && Number.isFinite(Number(v)));
  const readinessValues = logs.map((l) => l.readiness).filter((v) => v != null && Number.isFinite(Number(v)));

  let load_total = 0;
  for (const a of activities) {
    load_total += calculateActivityLoad(a, profile);
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
 * Get dashboard stats only (ACWR, phase, recent activities). No OpenAI. Used by GET /api/dashboard.
 * @param {object} opts - { db, admin, uid }
 * @returns {Promise<{ acwr, phase, phaseDay, phaseLength, recent_activities }>}
 */
async function getDashboardStats(opts) {
  const { db, admin, uid } = opts;
  if (!db || !uid) return { acwr: null, phase: null, phaseDay: null, phaseLength: 28, recent_activities: [] };

  try {
    const [profileData, logs56, activities56Sub, rootActivities56] = await Promise.all([
      getUserProfile(db, uid),
      getLast56DaysLogs(db, admin, uid),
      getLast56DaysActivities(db, uid),
      getRootActivities56(db, uid)
    ]);
    const activities56 = [...(activities56Sub || []), ...(rootActivities56 || [])];
    const profile = profileData?.profile || {};
    const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
    const lastPeriodDate = cycleData.lastPeriodDate || null;
    const cycleLength = Number(cycleData.avgDuration) || 28;
    const todayStr = new Date().toISOString().slice(0, 10);
    const phaseInfo = lastPeriodDate
      ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, todayStr)
      : { phaseName: 'Unknown', currentCycleDay: null };

    const logByDate = new Map();
    for (const l of logs56) {
      const key = (l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '').slice(0, 10);
      if (key) logByDate.set(key, l);
    }
    const maxHr = profile.max_heart_rate != null ? Number(profile.max_heart_rate) : null;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStrIso = sevenDaysAgo.toISOString().slice(0, 10);
    const twentyEightDaysAgo = new Date();
    twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
    const twentyEightDaysAgoStr = twentyEightDaysAgo.toISOString().slice(0, 10);

    const activities56WithPrime = activities56.map((a) => {
      const dateStr = activityDateString(a);
      // Manual sessions (and any activity with stored prime_load, no Strava load): use stored value — same unit as Strava Prime Load.
      const storedPrime = a.prime_load != null && Number.isFinite(Number(a.prime_load)) ? Number(a.prime_load) : null;
      const useStored = storedPrime != null && (a.source === 'manual' || a.suffer_score == null);
      if (useStored) {
        return { ...a, _dateStr: dateStr, _primeLoad: Math.round(storedPrime * 10) / 10 };
      }
      const rawLoad = calculateActivityLoad(a, profile);
      const phaseInfoForDate = lastPeriodDate && dateStr
        ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, dateStr)
        : { phaseName: null };
      const phase = phaseInfoForDate.phaseName;
      const readinessScore = logByDate.get(dateStr)?.readiness ?? 10;
      const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
      const primeLoad = calculatePrimeLoad(rawLoad, phase, readinessScore, avgHr, maxHr);
      return { ...a, _dateStr: dateStr, _primeLoad: primeLoad };
    });

    const activitiesForAcwr = activities56WithPrime.filter((a) => a.includeInAcwr !== false);
    const activitiesLast7 = activitiesForAcwr.filter((a) => a._dateStr >= sevenDaysAgoStrIso);
    const activitiesLast28 = activitiesForAcwr.filter((a) => a._dateStr >= twentyEightDaysAgoStr);
    const sum7 = activitiesLast7.reduce((s, a) => s + a._primeLoad, 0);
    const sum28 = activitiesLast28.reduce((s, a) => s + a._primeLoad, 0);
    // ACWR: acute = 7-day total, chronic = weekly average (sum28/4); same scale (load per week)
    const acute_load = sum7;
    const chronic_load = sum28 / 4;
    const load_ratio = calculateACWR(acute_load, chronic_load);
    // ATL/CTL as rolling daily averages (same unit); TSB = CTL - ATL (form)
    const atl_daily = sum7 > 0 ? sum7 / 7 : 0;
    const ctl_daily = sum28 > 0 ? sum28 / 28 : 0;
    const tsb = ctl_daily - atl_daily;

    const recent_activities = activitiesLast7
      .map((a) => ({ id: a.id, ...a, start_date: a.start_date || a.start_date_local, type: a.type, moving_time: a.moving_time, distance: a.distance }))
      .slice(0, 20);

    // Last 45 days of logs -> hrvHistory with cycleDay. Baseline includes ALL qualified metrics (checkin + import + strava); merge by date.
    const fortyFiveDaysAgo = new Date();
    fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);
    const cutoff45Str = fortyFiveDaysAgo.toISOString().slice(0, 10);
    const byDate = new Map();
    for (const l of logs56) {
      const dateStr = (l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '').slice(0, 10);
      if (!dateStr || dateStr < cutoff45Str) continue;
      if (!byDate.has(dateStr)) byDate.set(dateStr, { date: dateStr, hrv: null, rhr: null });
      const row = byDate.get(dateStr);
      if (l.hrv != null && Number.isFinite(Number(l.hrv))) row.hrv = Number(l.hrv);
      if (l.rhr != null && Number.isFinite(Number(l.rhr))) row.rhr = Number(l.rhr);
    }
    const hrvHistory = [];
    for (const [dateStr, row] of byDate) {
      const phaseForDate = lastPeriodDate && dateStr
        ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, dateStr)
        : { currentCycleDay: null };
      hrvHistory.push({
        date: row.date,
        hrv: row.hrv,
        rhr: row.rhr,
        cycleDay: phaseForDate.currentCycleDay ?? null
      });
    }
    hrvHistory.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Previous cycle window: ~[today - cycleLength - 14, today - cycleLength + 7]
    const prevCycleStart = new Date();
    prevCycleStart.setDate(prevCycleStart.getDate() - cycleLength - 14);
    const prevCycleEnd = new Date();
    prevCycleEnd.setDate(prevCycleEnd.getDate() - cycleLength + 7);
    const prevCycleStartStr = prevCycleStart.toISOString().slice(0, 10);
    const prevCycleEndStr = prevCycleEnd.toISOString().slice(0, 10);
    const ghostByCycleDay = new Map();
    for (const l of logs56) {
      const dateStr = (l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '').slice(0, 10);
      if (!dateStr || dateStr < prevCycleStartStr || dateStr > prevCycleEndStr) continue;
      const phaseForDate = lastPeriodDate && dateStr
        ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, dateStr)
        : { currentCycleDay: null };
      const d = phaseForDate.currentCycleDay;
      if (d != null && !ghostByCycleDay.has(d)) {
        ghostByCycleDay.set(d, { hrv: l.hrv != null ? Number(l.hrv) : null, rhr: l.rhr != null ? Number(l.rhr) : null, date: dateStr });
      }
    }

    // For last 14 days, attach previousCycleHrv from ghost & build ghost_comparison
    const fourteenDaysAgoDate = new Date();
    fourteenDaysAgoDate.setDate(fourteenDaysAgoDate.getDate() - 14);
    const last14StartStr = fourteenDaysAgoDate.toISOString().slice(0, 10);
    const ghostComparison = [];

    for (const row of hrvHistory) {
      if (row.date < last14StartStr || row.cycleDay == null) continue;

      const ghost = ghostByCycleDay.get(row.cycleDay) || null;

      if (ghost && ghost.hrv != null) {
        row.previousCycleHrv = ghost.hrv;
      }

      ghostComparison.push({
        date: row.date,
        cycleDay: row.cycleDay,
        hrv: row.hrv != null ? Number(row.hrv) : null,
        rhr: row.rhr != null ? Number(row.rhr) : null,
        ghostDate: ghost && ghost.date ? ghost.date : null,
        ghostHrv: ghost && ghost.hrv != null ? Number(ghost.hrv) : null,
        ghostRhr: ghost && ghost.rhr != null ? Number(ghost.rhr) : null
      });
    }

    const history_logs = hrvHistory;
    const ghost_comparison = ghostComparison;

    // Last 14 days daily load for cockpit charts (ATL trend)
    const loadHistory = [];
    for (let d = 13; d >= 0; d--) {
      const dte = new Date();
      dte.setDate(dte.getDate() - d);
      const dateStr = dte.toISOString().slice(0, 10);
      const dayTotal = activities56WithPrime
        .filter((a) => a._dateStr === dateStr)
        .reduce((s, a) => s + a._primeLoad, 0);
      loadHistory.push({ date: dateStr, dailyLoad: Math.round(dayTotal * 10) / 10 });
    }

    // 28-day baselines for RHR/HRV tile comparison
    const last28 = hrvHistory.filter((h) => h.date >= twentyEightDaysAgoStr);
    const rhrValues = last28.map((h) => h.rhr).filter((v) => v != null && Number.isFinite(v));
    const hrvValues = last28.map((h) => h.hrv).filter((v) => v != null && Number.isFinite(v));
    const rhr_baseline_28d = rhrValues.length ? Math.round(rhrValues.reduce((s, v) => s + v, 0) / rhrValues.length) : null;
    const hrv_baseline_28d = hrvValues.length ? Math.round((hrvValues.reduce((s, v) => s + v, 0) / hrvValues.length) * 10) / 10 : null;

    return {
      acwr: Number.isFinite(load_ratio) ? Math.round(load_ratio * 100) / 100 : null,
      acute_load,
      chronic_load,
      atl_daily: Math.round(atl_daily * 10) / 10,
      ctl_daily: Math.round(ctl_daily * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      phase: phaseInfo.phaseName || null,
      phaseDay: phaseInfo.currentCycleDay ?? null,
      phaseLength: cycleLength,
      recent_activities,
      history_logs,
      ghost_comparison,
      load_history: loadHistory,
      rhr_baseline_28d,
      hrv_baseline_28d
    };
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return { acwr: null, acute_load: null, chronic_load: null, atl_daily: null, ctl_daily: null, tsb: null, phase: null, phaseDay: null, phaseLength: 28, recent_activities: [], history_logs: [], ghost_comparison: [], load_history: [], rhr_baseline_28d: null, hrv_baseline_28d: null };
  }
}

/**
 * Generate weekly report: aggregate data + OpenAI Race Engineer.
 * @param {object} opts - { db, admin, openai, knowledgeBaseContent, uid }
 * @returns {Promise<{ stats, message }>}
 */
async function generateWeeklyReport(opts) {
  const { db, admin, openai, knowledgeBaseContent, uid } = opts;
  if (!db || !openai) throw new Error('db and openai required');

  const [profileData, logs56, activities56] = await Promise.all([
    getUserProfile(db, uid),
    getLast56DaysLogs(db, admin, uid),
    getLast56DaysActivities(db, uid)
  ]);

  const profile = profileData?.profile || {};
  const knowledgeContext = (typeof knowledgeBaseContent === 'string' && knowledgeBaseContent.trim())
    ? knowledgeBaseContent.trim()
    : loadKnowledgeContext();
  const athleteContext = formatAthleteContext(profile);

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
  const twentyEightDaysAgo = new Date(now);
  twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
  const twentyEightDaysAgoStr = twentyEightDaysAgo.toISOString().slice(0, 10);

  // Log lookup per datum (readiness voor prime_load; 56 dagen)
  const logByDate = new Map();
  for (const l of logs56) {
    const key = (l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '').slice(0, 10);
    if (key) logByDate.set(key, l);
  }

  const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
  const lastPeriodDate = cycleData.lastPeriodDate || null;
  const cycleLength = Number(cycleData.avgDuration) || 28;
  const maxHr = profile.max_heart_rate != null ? Number(profile.max_heart_rate) : null;

  // PrimeForm regel: Acute/Chronic/Level ALTIJD op prime_load (fysiologisch gecorrigeerd).
  // Per activiteit: cyclusfase op die datum (cycleService), readiness uit log (default 10), dan prime_load.
  const activities56WithPrime = activities56.map((a) => {
    const dateStr = activityDateString(a);
    const rawLoad = calculateActivityLoad(a, profile);
    const phaseInfo = lastPeriodDate && dateStr
      ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, dateStr)
      : { phaseName: null };
    const phase = phaseInfo.phaseName;
    const readinessScore = logByDate.get(dateStr)?.readiness ?? 10;
    const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
    const primeLoad = calculatePrimeLoad(rawLoad, phase, readinessScore, avgHr, maxHr);
    const hours = (a.moving_time != null ? Number(a.moving_time) : 0) / 3600;
    return {
      ...a,
      _dateStr: dateStr,
      _rawLoad: rawLoad,
      _primeLoad: primeLoad,
      _hours: hours,
      _phase: phase
    };
  });

  const activitiesForAcwr = activities56WithPrime.filter((a) => a.includeInAcwr !== false);
  const activitiesLast7 = activitiesForAcwr.filter((a) => a._dateStr >= sevenDaysAgoStr);
  const activitiesLast28 = activitiesForAcwr.filter((a) => a._dateStr >= twentyEightDaysAgoStr);

  const acute_load = Math.round(activitiesLast7.reduce((s, a) => s + a._primeLoad, 0) * 10) / 10;
  const chronic_load_raw = activitiesLast28.reduce((s, a) => s + a._primeLoad, 0);
  const chronic_load = Math.round((chronic_load_raw / 4) * 10) / 10; // gem. wekelijkse prime load laatste 28d
  const load_ratio = calculateACWR(acute_load, chronic_load);

  const totalPrime56 = activities56WithPrime.reduce((s, a) => s + a._primeLoad, 0);
  const totalHours56 = activities56WithPrime.reduce((s, a) => s + a._hours, 0);
  const avgWeeklyLoad56 = totalPrime56 / 8;
  const avgWeeklyHours56 = totalHours56 / 8;
  const athlete_level = determineAthleteLevel(avgWeeklyLoad56, avgWeeklyHours56);

  // Report-week = laatste 7 dagen; zelfde prime_load als hierboven
  const activities = activitiesLast7;
  const enrichedActivities = activities.map((a) => ({
    ...a,
    raw_load: a._rawLoad,
    prime_load: a._primeLoad,
    _readiness: logByDate.get(a._dateStr)?.readiness ?? null
  }));
  const logs = logs56.filter((l) => {
    const key = (l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '').slice(0, 10);
    return key && key >= sevenDaysAgoStr;
  });

  const primeLoadTotal = enrichedActivities.reduce((sum, a) => sum + (a.prime_load || 0), 0);

  // Basisstats bouwen en daarna load_total vervangen door Prime Load som
  const statsBase = buildStats(logs, activities, profile);
  const stats = {
    ...statsBase,
    load_total: Math.round(primeLoadTotal * 10) / 10,
    acute_load,
    chronic_load,
    load_ratio,
    acwr: load_ratio,
    athlete_level
  };
  const loadContextStr = `Athlete Level: ${athlete_level} (1=Rookie, 2=Active, 3=Elite), Acute Load: ${acute_load}, Chronic Load: ${chronic_load}, ACWR: ${load_ratio}.`;
  const logsSummary = logs.length
    ? logs.map((l) => {
        const dateStr = l.date || (l.timestamp ? l.timestamp.slice(0, 10) : '') || '—';
        const rec = l.recommendation ?? '—';
        const ctx = l.adviceContext && l.adviceContext !== 'STANDARD' ? ` (Reason: ${l.adviceContext})` : '';
        return `- ${dateStr}: Status ${rec}${ctx} | HRV=${l.hrv ?? '—'} RHR=${l.rhr ?? '—'} Readiness=${l.readiness ?? '—'} Fase=${l.phase ?? '—'}`;
      }).join('\n')
    : 'Geen logdata voor de afgelopen 7 dagen.';
  const activitiesSummary = enrichedActivities.length
    ? enrichedActivities.map((a) => {
        const dateStr = a._dateStr || (a.start_date_local || a.start_date || '').toString().slice(0, 10);
        const dist = a.distance != null ? `${(a.distance / 1000).toFixed(1)} km` : '';
        const rawLoad = a.raw_load != null ? `RawLoad ${a.raw_load}` : '';
        const prime = a.prime_load != null ? `PrimeLoad ${a.prime_load}` : '';
        const phase = a._phase ? `Fase ${a._phase}` : '';
        return `- ${dateStr} ${a.type || 'Workout'} ${dist} ${rawLoad} ${prime} ${phase}`.trim();
      }).join('\n')
    : 'Geen Strava-activiteiten in de afgelopen 7 dagen.';

  const systemPrompt = `ROL: Je bent de PrimeForm Race Engineer, een elite performance coach voor vrouwen.

PRIMEFORM KNOWLEDGE BASE (Jouw absolute waarheid en regels):
${knowledgeContext || '(Geen knowledge base geladen – baseer je op algemene PrimeForm principes.)'}

ATLEET PROFIEL (Doelen en achtergrond):
${athleteContext}

INSTRUCTIE:
Analyseer de weekdata. Je advies MOET gekoppeld zijn aan de doelen van de atleet en getoetst worden aan de Knowledge Base.
Gebruik de PrimeForm terminologie.
Structuur je antwoord in 3 delen:
1. De Harde Data (Wat zien we? Gebruik de Load Analysis & Context hieronder.)
2. De Context (Cyclusfase, Herstel, en hoe dit relateert aan haar doelen.)
3. Het Plan (Concreet advies voor volgende week.)

Schrijf in het Nederlands, 'jij'-vorm, natuurlijke toon.

--- LOAD ANALYSIS & CONTEXT (Volg strikt) ---
REGEL: Beoordeel NOOIT een trainingsbelasting op een los getal. Normaliseer altijd tegen Athlete Level en Trend (ACWR).

INPUT: Athlete Level [1=Rookie, 2=Active, 3=Elite], Load Ratio (ACWR) = Acute / Chronic.

STAP A — Context:
- Level 3 (Elite): Load 300–400 = "LOW/RECOVERY"; >800 = "BUILD".
- Level 1 (Rookie): Load 300–400 = "HIGH/PEAK".

STAP B — Trend (ACWR):
- < 0.80: Deloading ("Gas teruggenomen", "Herstelweek").
- 0.80–1.10: Maintenance ("Stabiel", "Onderhoud").
- 1.10–1.30: Progressive ("Gezonde progressie", "Sterke bouw-week").
- 1.30–1.50: Overreaching ("Grens opzoeken", "Piekbelasting").
- > 1.50: Spike Risk ("Acute piek ⚠️", "Blessurerisico").

STAP C — Luteal check:
- Als status "Overreaching" (>1.3) EN fase "Luteal": WAARSCHUW ("Risicovolle combinatie").
- Als status "Deloading" (<0.8) EN fase "Luteal": VALIDEER ("Perfecte timing").

--- EINDE LOAD MODULE ---

Antwoord uitsluitend met een geldig JSON-object met exact twee velden: "stats" (object met load_total, hrv_avg, rhr_avg, subjective_avg, acute_load, chronic_load, load_ratio, athlete_level) en "message" (string: de concepttekst voor de atleet). Geen markdown, geen codeblokken.`;

  const userPrompt = `[LOGS LAATSTE 7 DAGEN]\n${logsSummary}\n\n[STRAVA ACTIVITEITEN LAATSTE 7 DAGEN]\n${activitiesSummary}\n\n[BEREKENDE STATS]\n${JSON.stringify(stats, null, 2)}\n\n[LOAD CONTEXT]\n${loadContextStr}\n\nGeef het gevraagde JSON-object met "stats" en "message".`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.8,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { stats, message: content || 'Geen tekst gegenereerd.' };
  }

  // Laatste 7 dagen, geformatteerd voor de frontend (raw load + Prime Load)
  const activities_list = enrichedActivities.map((a) => {
    const dateStr = a._dateStr || activityDateString(a);
    const distance = a.distance != null ? Number(a.distance) : null;
    const movingTime = a.moving_time != null ? Number(a.moving_time) : null;
    const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
    const load = a.raw_load != null ? a.raw_load : calculateActivityLoad(a, profile);
    return {
      date: dateStr,
      type: a.type || 'Workout',
      distance_km: distance != null ? Math.round((distance / 1000) * 100) / 100 : null,
      duration_min: movingTime != null ? Math.round(movingTime / 60) : null,
      avg_hr: avgHr != null ? avgHr : '-',
      load,
      prime_load: a.prime_load != null ? a.prime_load : calculatePrimeLoad(load, null, null, avgHr, profile.max_heart_rate)
    };
  });

  // Volledige 56-dagen lijst voor Admin-verificatie (zelfde velden)
  const history_activities = activities56WithPrime
    .map((a) => {
      const dateStr = a._dateStr || activityDateString(a);
      const distance = a.distance != null ? Number(a.distance) : null;
      const movingTime = a.moving_time != null ? Number(a.moving_time) : null;
      const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
      return {
        date: dateStr,
        type: a.type || 'Workout',
        distance_km: distance != null ? Math.round((distance / 1000) * 100) / 100 : null,
        duration_min: movingTime != null ? Math.round(movingTime / 60) : null,
        avg_hr: avgHr != null ? avgHr : '-',
        load: a._rawLoad != null ? a._rawLoad : calculateActivityLoad(a, profile),
        prime_load: a._primeLoad != null ? a._primeLoad : 0
      };
    })
    .sort((x, y) => (y.date || '').localeCompare(x.date || ''));

  return {
    stats: { ...(parsed.stats || {}), ...stats },
    message: typeof parsed.message === 'string' ? parsed.message : (parsed.message ? String(parsed.message) : 'Geen weekrapport gegenereerd.'),
    activities_list,
    history_activities
  };
}

module.exports = {
  generateWeeklyReport,
  getDashboardStats,
  getUserProfile,
  getLast7DaysLogs,
  getLast56DaysLogs,
  getLast7DaysActivities,
  getLast56DaysActivities,
  getRootActivities56,
  buildStats,
  loadKnowledgeContext,
  formatAthleteContext
};
