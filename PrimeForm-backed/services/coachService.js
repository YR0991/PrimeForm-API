/**
 * Coach Service — Squadron View data aggregation.
 * Used by GET /api/coach/squadron.
 * ACWR en phase/day komen uit dezelfde berekening als het weekrapport (reportService.getDashboardStats).
 */

const cycleService = require('./cycleService');
const reportService = require('./reportService');

/** ACWR -> status_label for frontend */
function acwrToStatus(acwr) {
  if (acwr == null || !Number.isFinite(acwr)) return 'New';
  if (acwr > 1.5) return 'spike';
  if (acwr > 1.3) return 'overreaching';
  if (acwr < 0.8) return 'undertraining';
  return 'sweet';
}

/** ACWR -> Directive label for coach view (PUSH, MAINTAIN, RECOVER, REST). No data -> "Niet genoeg data". */
function acwrToDirective(acwr) {
  if (acwr == null || !Number.isFinite(acwr)) return 'Niet genoeg data';
  const v = Number(acwr);
  if (v > 1.5) return 'REST';
  if (v > 1.3) return 'RECOVER';
  if (v >= 0.8 && v <= 1.3) return 'PUSH';
  if (v < 0.8) return 'MAINTAIN';
  return 'MAINTAIN';
}

/** Extract date string from activity (start_date_local or start_date) */
function activityDateStr(a) {
  const raw = a.start_date_local ?? a.start_date;
  if (!raw) return '';
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

/** Extract time "HH:mm" from activity */
function activityTimeStr(a) {
  const raw = a.start_date_local ?? a.start_date;
  if (!raw) return '';
  let d;
  if (typeof raw === 'string') d = new Date(raw);
  else if (typeof raw.toDate === 'function') d = raw.toDate();
  else if (typeof raw === 'number') d = new Date(raw * 1000);
  else return '';
  if (isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, 5);
}

/**
 * Rolling 7-day compliance: unique days with at least one log in the last 7 days (today + 6 days back).
 * @param {Array<{ date?: string }>} logs - history_logs (each with .date YYYY-MM-DD)
 * @returns {{ count: number, complianceDays: boolean[] }} count (max 7), and 7 booleans [oldest..today]
 */
function getRollingCompliance(logs) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 6);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  const inWindow = (logs || []).filter((h) => {
    const d = (h.date || '').slice(0, 10);
    return d >= windowStartStr && d <= todayStr;
  });
  const uniqueDates = new Set(inWindow.map((h) => (h.date || '').slice(0, 10)));
  const count = Math.min(uniqueDates.size, 7);

  const complianceDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    complianceDays.push(uniqueDates.has(d.toISOString().slice(0, 10)));
  }
  return { count, complianceDays };
}

/**
 * Current streak: consecutive days with at least one log, counting backwards from today.
 * @param {Array<{ date?: string }>} logs - history_logs
 * @returns {number}
 */
function getCurrentStreak(logs) {
  const datesSet = new Set(
    (logs || []).filter((h) => h.date).map((h) => String(h.date).slice(0, 10))
  );
  const today = new Date();
  let streak = 0;
  const d = new Date(today);
  while (true) {
    const dStr = d.toISOString().slice(0, 10);
    if (!datesSet.has(dStr)) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/**
 * Fetch squadron data for all users.
 * @param {FirebaseFirestore.Firestore} db
 * @param {FirebaseAdmin.firestore} admin - for Timestamp
 * @returns {Promise<Array>} Array of athlete rows for Squadron View
 */
async function getSquadronData(db, admin) {
  if (!db) throw new Error('Firestore db required');

  const usersSnap = await db.collection('users').get();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const startTs = admin.firestore.Timestamp.fromDate(startOfDay);
  const endTs = admin.firestore.Timestamp.fromDate(endOfDay);

  let logFirstAthlete = true;
  const results = await Promise.all(
    usersSnap.docs.map(async (userDoc) => {
      const uid = userDoc.id;
      const userData = userDoc.data() || {};
      const rawProfile = userData.profile || {};

      try {
        const displayNameFromProfile = rawProfile.fullName || rawProfile.displayName || null;
        const emailForUser = userData.email || userData.profile?.email || null;
        const displayNameFromEmail =
          emailForUser && typeof emailForUser === 'string' ? emailForUser.split('@')[0] : null;
        const resolvedDisplayName = displayNameFromProfile || displayNameFromEmail || 'Geen naam';

        const [profileData, todayLogSnap, lastActivitySnap] = await Promise.all([
          Promise.resolve({
            displayName: resolvedDisplayName,
            photoURL: rawProfile.photoURL || rawProfile.avatarUrl || rawProfile.avatar || null,
            athlete_level: rawProfile.athlete_level ?? null
          }),
          db
            .collection('users')
            .doc(uid)
            .collection('dailyLogs')
            .where('timestamp', '>=', startTs)
            .where('timestamp', '<', endTs)
            .limit(1)
            .get(),
          db.collection('users').doc(uid).collection('activities').get()
        ]);

        const cycleData = rawProfile.cycleData && typeof rawProfile.cycleData === 'object' ? rawProfile.cycleData : {};
        const lastPeriod = cycleData.lastPeriodDate || null;
        const cycleLength = Number(cycleData.avgDuration) || 28;
        const targetDate = todayStr;
        const phaseInfo = lastPeriod
          ? cycleService.getPhaseForDate(lastPeriod, cycleLength, targetDate)
          : { phaseName: 'Unknown', isInLutealPhase: false };
        let cyclePhase = phaseInfo.phaseName || 'Unknown';
        let cycleDay = lastPeriod
          ? (() => {
              const last = new Date(lastPeriod);
              const diff = Math.floor((today - last) / (1000 * 60 * 60 * 24));
              return (diff % cycleLength) + 1;
            })()
          : null;
        let acwr = 0;
        let stats = null;

        // Zelfde bron als weekrapport: berekende ACWR, phase en load uit reportService
        try {
          stats = await reportService.getDashboardStats({ db, admin, uid });
          if (stats && (stats.acwr != null || stats.phase != null || stats.phaseDay != null)) {
            if (stats.acwr != null && Number.isFinite(Number(stats.acwr))) {
              acwr = Number(stats.acwr);
            }
            if (stats.phase != null) cyclePhase = stats.phase;
            if (stats.phaseDay != null) cycleDay = stats.phaseDay;
          }
        } catch (statsErr) {
          console.warn(`coachService: getDashboardStats for ${uid} failed, using fallback`, statsErr.message);
        }
        const storedMetrics = userData.metrics || {};
        if (acwr === 0) {
          const acwrRaw = storedMetrics.acwr;
          if (acwrRaw != null && Number.isFinite(Number(acwrRaw))) acwr = Number(acwrRaw);
        }
        const acwrStatus = acwrToStatus(acwr);

        // Readiness for Squadron View: latest subjective readiness from user doc (set via daily check-in)
        const readiness =
          userData.readiness != null && Number.isFinite(Number(userData.readiness))
            ? Number(userData.readiness)
            : null;

        const directive = acwr != null && Number.isFinite(acwr) ? acwrToDirective(acwr) : 'Niet genoeg data';

        const compliance = !todayLogSnap.empty;

        let lastActivity = null;
        if (!lastActivitySnap.empty) {
          const acts = lastActivitySnap.docs
            .map((d) => d.data())
            .filter((a) => activityDateStr(a))
            .sort((a, b) => activityDateStr(b).localeCompare(activityDateStr(a)));
          if (acts.length > 0) {
            const act = acts[0];
            lastActivity = {
              time: activityTimeStr(act),
              type: act.type || 'Workout',
              date: activityDateStr(act)
            };
          }
        }

        // Metrics: ATL/CTL = 7d/28d daily averages; TSB (form) = CTL - ATL (same unit)
        const acuteLoad =
          stats?.atl_daily != null && Number.isFinite(stats.atl_daily)
            ? Math.round(Number(stats.atl_daily) * 10) / 10
            : (stats?.acute_load != null && Number.isFinite(stats.acute_load) ? Math.round(Number(stats.acute_load) * 10) / 10 : null);
        const chronicLoad =
          stats?.ctl_daily != null && Number.isFinite(stats.ctl_daily)
            ? Math.round(Number(stats.ctl_daily) * 10) / 10
            : (stats?.chronic_load != null && Number.isFinite(stats.chronic_load) ? Math.round(Number(stats.chronic_load) * 10) / 10 : null);
        const form =
          stats?.tsb != null && Number.isFinite(stats.tsb)
            ? Math.round(Number(stats.tsb) * 10) / 10
            : null;
        const acwrValue = Number.isFinite(acwr) ? Math.round(Number(acwr) * 100) / 100 : null;

        if (logFirstAthlete) {
          logFirstAthlete = false;
          console.log(`[Load] uid=${uid} ATL(daily)=${acuteLoad} CTL(daily)=${chronicLoad} TSB=${form} ACWR=${acwrValue}`);
        }

        const fullName = profileData.displayName || displayNameFromEmail || 'Geen naam';
        const profile = {
          fullName,
          firstName: fullName ? fullName.split(' ')[0] : null,
          lastName: fullName ? fullName.split(' ').slice(1).join(' ').trim() || null : null,
          avatar: profileData.photoURL || null,
        };
        const metrics = {
          acwr: acwrValue,
          loadBalance: storedMetrics.loadBalance || null,
          acuteLoad,
          chronicLoad,
          form,
          cyclePhase: cyclePhase || null,
          cycleDay: cycleDay != null ? cycleDay : null,
          readiness,
        };

        // Full AthleteDTO: name, profile, metrics, metricsMeta (load-metrics cache state for Belastingsbalans)
        return {
          id: uid,
          name: fullName,
          profile,
          metrics,
          metricsMeta: userData.metricsMeta ?? { loadMetricsStale: true },
          email: userData.email || userData.profile?.email || null,
          teamId: userData.teamId || null,
          directive,
          acwrStatus,
          compliance,
          lastActivity,
        };
      } catch (err) {
        console.error(`coachService: error for user ${uid}:`, err.message);
        const cycleData = rawProfile.cycleData || {};
        const lastPeriod = cycleData.lastPeriodDate || null;
        const cycleLength = Number(cycleData.avgDuration) || 28;
        const phaseInfo = lastPeriod
          ? cycleService.getPhaseForDate(lastPeriod, cycleLength, todayStr)
          : { phaseName: 'Unknown' };
        const emailForCatch = userData.email || userData.profile?.email || null;
        const emailPart =
          emailForCatch && typeof emailForCatch === 'string' ? emailForCatch.split('@')[0] : null;
        const fallbackName = rawProfile.fullName || rawProfile.displayName || emailPart || 'Geen naam';
        return {
          id: uid,
          name: fallbackName,
          profile: {
            fullName: fallbackName,
            firstName: fallbackName ? fallbackName.split(' ')[0] : null,
            lastName: fallbackName ? fallbackName.split(' ').slice(1).join(' ').trim() || null : null,
            avatar: null,
          },
          metrics: {
            acwr: null,
            loadBalance: null,
            acuteLoad: null,
            chronicLoad: null,
            form: null,
            cyclePhase: phaseInfo.phaseName || null,
            cycleDay: null,
            readiness: null,
          },
          metricsMeta: userData.metricsMeta ?? { loadMetricsStale: true },
          email: userData.email || userData.profile?.email || null,
          teamId: userData.teamId || null,
          directive: 'Niet genoeg data',
          acwrStatus: 'New',
          compliance: false,
          lastActivity: null,
        };
      }
    })
  );

  return results;
}

/**
 * Fetch one athlete's detail for Coach Deep Dive.
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} admin - Firebase admin (for Timestamp)
 * @param {string} athleteId - User document ID
 * @returns {Promise<object>} { id, profile?, metrics, readiness?, activities }
 */
async function getAthleteDetail(db, admin, athleteId) {
  if (!db || !athleteId) throw new Error('db and athleteId required');

  const userRef = db.collection('users').doc(athleteId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    const err = new Error('Athlete not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const userData = userSnap.data() || {};
  const profile = userData.profile || {};
  const readiness =
    userData.readiness != null && Number.isFinite(Number(userData.readiness))
      ? Number(userData.readiness)
      : null;

  let stats = null;
  try {
    stats = await reportService.getDashboardStats({ db, admin, uid: athleteId });
  } catch (err) {
    console.warn(`coachService: getAthleteDetail getDashboardStats for ${athleteId} failed:`, err.message);
  }

  const acute = stats?.atl_daily != null && Number.isFinite(stats.atl_daily) ? stats.atl_daily : (stats?.acute_load ?? null);
  const chronic = stats?.ctl_daily != null && Number.isFinite(stats.ctl_daily) ? stats.ctl_daily : (stats?.chronic_load ?? null);
  const form = stats?.tsb != null && Number.isFinite(stats.tsb) ? Math.round(stats.tsb * 10) / 10 : (chronic != null && acute != null ? Math.round((chronic - acute) * 10) / 10 : null);

  const metrics = {
    acwr: stats?.acwr ?? null,
    acuteLoad: acute,
    chronicLoad: chronic,
    form,
    cyclePhase: stats?.phase ?? null,
    cycleDay: stats?.phaseDay ?? null,
    rhr: stats?.rhr_baseline_28d ?? null,
    readiness,
  };

  const activities = (stats?.recent_activities || []).map((a) => {
    const loadUsed = a.loadUsed ?? a._primeLoad;
    return {
      id: a.id || null,
      date: a._dateStr || activityDateStr(a),
      type: a.type || 'Workout',
      load: loadUsed != null && Number.isFinite(loadUsed) ? Math.round(loadUsed * 10) / 10 : null,
      loadRaw: a.loadRaw != null && Number.isFinite(a.loadRaw) ? Math.round(a.loadRaw * 10) / 10 : null,
      source: a.source || 'strava'
    };
  });

  const acwr = stats?.acwr != null && Number.isFinite(stats.acwr) ? stats.acwr : null;
  const directive = acwr != null ? acwrToDirective(acwr) : 'Niet genoeg data';

  const { count: complianceLast7, complianceDays } = getRollingCompliance(stats?.history_logs || []);
  const currentStreak = getCurrentStreak(stats?.history_logs || []);

  const avatarUrl = profile.avatar || profile.photoURL || profile.avatarUrl || null;
  return {
    id: athleteId,
    profile: {
      firstName: profile.fullName ? profile.fullName.split(' ')[0] : null,
      lastName: profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') || null : null,
      fullName: profile.fullName || profile.displayName || null,
      avatar: avatarUrl,
      goals: profile.goals ?? null,
      successScenario: profile.successScenario ?? null,
      injuryHistory: profile.injuryHistory ?? profile.injuries ?? null,
      redFlags: profile.redFlags ?? null,
    },
    adminNotes: userData.adminNotes ?? null,
    email: userData.email || userData.profile?.email || null,
    metrics,
    readiness,
    activities,
    directive,
    complianceLast7,
    complianceDays,
    currentStreak,
    history_logs: stats?.history_logs ?? [],
    ghost_comparison: stats?.ghost_comparison ?? [],
    load_history: stats?.load_history ?? [],
  };
}

module.exports = { getSquadronData, getAthleteDetail };
