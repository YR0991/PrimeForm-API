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

/** Map athlete level 1/2/3 -> rookie/active/elite */
function levelToLabel(level) {
  if (level === 3) return 'elite';
  if (level === 2) return 'active';
  return 'rookie';
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

  const results = await Promise.all(
    usersSnap.docs.map(async (userDoc) => {
      const uid = userDoc.id;
      const userData = userDoc.data() || {};
      const profile = userData.profile || {};

      try {
        const [profileData, todayLogSnap, lastActivitySnap] = await Promise.all([
          Promise.resolve({
            displayName: profile.fullName || profile.displayName || 'Geen naam',
            photoURL: profile.photoURL || profile.avatarUrl || null,
            athlete_level: profile.athlete_level ?? null
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

        const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
        const lastPeriod = cycleData.lastPeriodDate || cycleData.lastPeriod || null;
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

        let athleteLevel = profileData.athlete_level ?? storedMetrics.level ?? storedMetrics.athlete_level;
        if (athleteLevel == null) {
          athleteLevel = 1;
        }
        const level = levelToLabel(athleteLevel);

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

        const acuteLoad =
          stats?.acute_load != null && Number.isFinite(stats.acute_load) ? stats.acute_load : null;
        const chronicLoad =
          stats?.chronic_load != null && Number.isFinite(stats.chronic_load) ? stats.chronic_load : null;
        const form =
          chronicLoad != null && acuteLoad != null ? Math.round((chronicLoad - acuteLoad) * 10) / 10 : null;

        const fullName = profileData.displayName || 'Geen naam';
        const profile = {
          fullName,
          firstName: fullName ? fullName.split(' ')[0] : null,
          lastName: fullName ? fullName.split(' ').slice(1).join(' ').trim() || null : null,
          avatar: profileData.photoURL || null,
        };
        const metrics = {
          acwr: Number.isFinite(acwr) ? acwr : null,
          acuteLoad,
          chronicLoad,
          form,
          cyclePhase: cyclePhase || null,
          cycleDay: cycleDay != null ? cycleDay : null,
          readiness,
        };

        return {
          id: uid,
          profile,
          metrics,
          email: userData.email || null,
          teamId: userData.teamId || null,
          level,
          acwrStatus,
          compliance,
          lastActivity,
        };
      } catch (err) {
        console.error(`coachService: error for user ${uid}:`, err.message);
        const cycleData = profile.cycleData || {};
        const lastPeriod = cycleData.lastPeriodDate || cycleData.lastPeriod;
        const cycleLength = Number(cycleData.avgDuration) || 28;
        const phaseInfo = lastPeriod
          ? cycleService.getPhaseForDate(lastPeriod, cycleLength, todayStr)
          : { phaseName: 'Unknown' };
        const fallbackName = profile.fullName || profile.displayName || 'Onbekend';
        return {
          id: uid,
          profile: {
            fullName: fallbackName,
            firstName: fallbackName ? fallbackName.split(' ')[0] : null,
            lastName: fallbackName ? fallbackName.split(' ').slice(1).join(' ').trim() || null : null,
            avatar: null,
          },
          metrics: {
            acwr: null,
            acuteLoad: null,
            chronicLoad: null,
            form: null,
            cyclePhase: phaseInfo.phaseName || null,
            cycleDay: null,
            readiness: null,
          },
          email: userData.email || null,
          teamId: userData.teamId || null,
          level: 'rookie',
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

  const acute = stats?.acute_load != null && Number.isFinite(stats.acute_load) ? stats.acute_load : null;
  const chronic = stats?.chronic_load != null && Number.isFinite(stats.chronic_load) ? stats.chronic_load : null;
  const form = chronic != null && acute != null ? Math.round((chronic - acute) * 10) / 10 : null;

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

  const activities = (stats?.recent_activities || []).map((a) => ({
    id: a.id || null,
    date: a._dateStr || activityDateStr(a),
    type: a.type || 'Workout',
    load: a._primeLoad != null && Number.isFinite(a._primeLoad) ? Math.round(a._primeLoad * 10) / 10 : null,
    source: a.source || 'strava',
  }));

  return {
    id: athleteId,
    profile: {
      firstName: profile.fullName ? profile.fullName.split(' ')[0] : null,
      lastName: profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') || null : null,
      fullName: profile.fullName || profile.displayName || null,
    },
    email: userData.email || null,
    metrics,
    readiness,
    activities,
  };
}

module.exports = { getSquadronData, getAthleteDetail };
