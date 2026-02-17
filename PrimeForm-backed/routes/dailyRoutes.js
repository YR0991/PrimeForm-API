/**
 * Daily advice and check-in routes.
 * - POST /api/daily-advice: full PrimeForm logic, overrides (Lethargy, Elite, Sick), Menstruatie Reset, Firestore dailyLogs.
 * - POST /api/save-checkin: validate + red flags + recommendation, save to daily_logs (root collection). Protected: uid from req.user.uid.
 * - POST /api/check-luteal-phase: cycle phase calculation only.
 */

const express = require('express');
const cycleService = require('../services/cycleService');
const { calculateActivityLoad, calculatePrimeLoad, calculateACWR } = require('../services/calculationService');
const reportService = require('../services/reportService');
const { computeStatus } = require('../services/statusEngine');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const { getActivityDay, relativeDayLabel, addDays } = require('../lib/activityDate');
const logger = require('../lib/logger');

/** Today as YYYY-MM-DD in Europe/Amsterdam (for brief day and check-in date). */
function todayAmsterdam() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' });
}

/**
 * @param {object} deps - { db, admin, openai, knowledgeBaseContent, FieldValue }
 * @returns {express.Router}
 */
function createDailyRouter(deps) {
  const { db, admin, openai, knowledgeBaseContent, FieldValue } = deps;
  const auth = [verifyIdToken(admin), requireUser()];

  /**
   * Most recent workout on briefDay or briefDay-1; label uses relativeDayLabel so AI never says "gisteren" when activity is same day as brief.
   * @param {string} userId
   * @param {string} briefDay - YYYY-MM-DD (e.g. today in Europe/Amsterdam)
   * @returns {Promise<string>} e.g. "[DETECTED WORKOUT (vandaag)]: Type: Run, ..." or ""
   */
  async function getDetectedWorkoutForAI(userId, briefDay) {
    if (!db || !userId) return '';
    const day = (briefDay || todayAmsterdam()).slice(0, 10);
    const yesterday = addDays(day, -1);
    try {
      const snap = await db.collection('users').doc(String(userId)).collection('activities').get();
      const activities = [];
      snap.docs.forEach((doc) => {
        const d = doc.data() || {};
        const activityDay = getActivityDay(d);
        if (activityDay === day || activityDay === yesterday) activities.push({ ...d, id: doc.id });
      });
      if (activities.length === 0) return '';
      activities.sort((a, b) => {
        const da = getActivityDay(a) || '';
        const db_ = getActivityDay(b) || '';
        if (da !== db_) return db_.localeCompare(da);
        return (b.start_date_local || b.start_date || '').toString().localeCompare((a.start_date_local || a.start_date || '').toString());
      });
      const a = activities[0];
      const activityDay = getActivityDay(a);
      const dayLabel = relativeDayLabel(activityDay, day);
      const typeMap = { Run: 'Hardlopen', Ride: 'Fietsen', VirtualRide: 'Virtueel fietsen', Swim: 'Zwemmen' };
      const typeLabel = typeMap[a.type] || a.type || 'Workout';
      const durationMin = a.moving_time ? Math.round(a.moving_time / 60) : null;
      const avgHr = a.average_heartrate != null ? a.average_heartrate : null;
      const ss = a.suffer_score != null ? Number(a.suffer_score) : null;
      let load = 'Unknown';
      if (ss != null) { if (ss <= 50) load = 'Low'; else if (ss <= 100) load = 'Medium'; else load = 'High'; }
      const parts = [`Type: ${typeLabel}`];
      if (durationMin) parts.push(`Duration: ${durationMin}min`);
      if (avgHr) parts.push(`Avg HR: ${avgHr}`);
      parts.push(`Load: ${load}`);
      return `[DETECTED WORKOUT (${dayLabel})]: ${parts.join(', ')}.`;
    } catch (e) {
      logger.error('getDetectedWorkoutForAI', e);
      return '';
    }
  }

  /**
   * Learning Loop: fetch yesterday's advice and actual load to determine compliance/violation.
   * @returns {{ violation: boolean, compliance: boolean, yesterdayAdvice: string, yesterdayLoad: number }}
   */
  async function getYesterdayComplianceContext(userId, yesterdayIso, profile, effectiveLastPeriodDate, cycleLengthNum) {
    const out = { violation: false, compliance: false, yesterdayAdvice: '', yesterdayLoad: 0 };
    if (!db || !userId || !yesterdayIso) return out;

    try {
      const userRef = db.collection('users').doc(String(userId));

      // a) Yesterday's dailyLog (advice/status + readiness for prime load)
      const yesterdayLogSnap = await userRef.collection('dailyLogs').where('date', '==', yesterdayIso).limit(1).get();
      let yesterdayStatus = null;
      let readinessYesterday = 10;
      if (!yesterdayLogSnap.empty) {
        const logData = yesterdayLogSnap.docs[0].data() || {};
        yesterdayStatus = logData.recommendation?.status || null;
        out.yesterdayAdvice = (logData.aiMessage || logData.advice || '').toString().slice(0, 500);
        const r = logData.metrics?.readiness;
        if (r != null && Number.isFinite(Number(r))) readinessYesterday = Number(r);
      }

      // b) Yesterday's activities: sum of prime_load
      const activitiesSnap = await userRef.collection('activities').get();
      const maxHr = profile?.max_heart_rate != null ? Number(profile.max_heart_rate) : null;
      const phaseInfo = effectiveLastPeriodDate && cycleLengthNum
        ? cycleService.getPhaseForDate(effectiveLastPeriodDate, cycleLengthNum, yesterdayIso)
        : { phaseName: null };
      const phaseName = phaseInfo.phaseName || null;

      let totalPrimeLoad = 0;
      activitiesSnap.docs.forEach((doc) => {
        const a = doc.data() || {};
        const dateStr = (a.start_date_local || a.start_date || '').toString().slice(0, 10);
        if (dateStr !== yesterdayIso) return;
        const rawLoad = calculateActivityLoad(a, profile || {});
        const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
        const primeLoad = calculatePrimeLoad(rawLoad, phaseName, readinessYesterday, avgHr, maxHr);
        totalPrimeLoad += primeLoad;
      });
      out.yesterdayLoad = Math.round(totalPrimeLoad * 10) / 10;

      // Determine violation / compliance
      if (yesterdayStatus == null) return out; // Unknown: no data
      const statusUpper = (yesterdayStatus || '').toUpperCase();
      if ((statusUpper === 'REST' || statusUpper === 'RECOVER') && totalPrimeLoad > 300) {
        out.violation = true;
      }
      if (statusUpper === 'REST' && totalPrimeLoad < 100) {
        out.compliance = true;
      }
      return out;
    } catch (e) {
      logger.error('getYesterdayComplianceContext', e);
      return out;
    }
  }

  async function generateAICoachingMessage(status, phaseName, metrics, redFlags, profileContext, detectedWorkout, flags, complianceContext) {
    try {
      const ctx = complianceContext || {};
      const hasViolation = ctx.violation === true;
      const hasCompliance = ctx.compliance === true;
      const yesterdayAdvice = (ctx.yesterdayAdvice || '').toString().slice(0, 400);
      const yesterdayLoad = ctx.yesterdayLoad != null ? Number(ctx.yesterdayLoad) : 0;

      let learningLoopInstruction = '';
      if (hasViolation) {
        learningLoopInstruction = '\n\nLEARNING LOOP — VIOLATION: Gisteren was het advies REST of RECOVER, maar de atleet heeft toch zwaar getraind (Prime Load > 300). Benoem dit expliciet als mogelijke oorzaak voor de huidige vermoeidheid of HRV-dip. Wees strenger en herhaal het belang van rust na rustadvies.';
      } else if (hasCompliance) {
        learningLoopInstruction = '\n\nLEARNING LOOP — COMPLIANCE: Gisteren was het advies REST en de atleet heeft het advies goed opgevolgd (weinig load). Geef een kort compliment over de discipline en doorzettingsvermogen.';
      } else if (yesterdayAdvice || Number.isFinite(yesterdayLoad)) {
        learningLoopInstruction = '\n\nLEARNING LOOP — Gisteren advies/load is beschikbaar; gebruik dit contextueel indien relevant (geen violation of compliance).';
      }

      const complianceInstruction = detectedWorkout
        ? '\n\nCOMPLIANCE CHECK: The detected workout includes a day label (vandaag/gisteren/op datum). Use that label in your wording — never say "gisteren" if the label says "vandaag". If the workout was on the day of yesterday\'s advice and I advised Recover or Rest but the user did a High Load workout, mention it gently (e.g. "Ik zie dat je flink bent gegaan – volgende keer even afstemmen op het advies."). Do not be harsh.'
        : '';
      const sicknessInstruction = flags.isSickOrInjured
        ? '\n\nACUTE HEALTH STATE: The user reported being sick or injured today. You MUST prescribe a Rust & Herstel / very light active recovery plan, regardless of how strong the biometrics look. Protect the athlete from overreaching.'
        : '';
      const systemPrompt = `Je bent PrimeForm, de elite biohacking coach. Gebruik ONDERSTAANDE kennisbasis strikt voor je advies. Wijk hier niet van af.

--- KNOWLEDGE BASE START ---
${knowledgeBaseContent}
--- KNOWLEDGE BASE END ---

INSTRUCTION FOR LANGUAGE GENERATION: 1. REASONING: First, think in English about the advice based on Logic v2.0. 2. TRANSLATION: When writing the final response in Dutch, imagine you are texting a smart friend. Use short sentences. Use 'spreektaal' (spoken language), not 'schrijftaal' (written language). 3. FILTER: Check against lingo.md restrictions. If it sounds like a translated document, REWRITE it to sound human.${learningLoopInstruction}${complianceInstruction}${sicknessInstruction}

YESTERDAY CONTEXT (for Learning Loop): Yesterday advice snippet: ${yesterdayAdvice || 'geen'}. Yesterday actual Prime Load: ${Number.isFinite(yesterdayLoad) ? yesterdayLoad : 'onbekend'}.

IntakeData (kan leeg zijn):
${profileContext ? JSON.stringify(profileContext).slice(0, 2500) : 'null'}`;

      const hrvRefBaseline = metrics.hrv.adjustedBaseline || metrics.hrv.baseline;
      const hrvChange = ((metrics.hrv.current - hrvRefBaseline) / hrvRefBaseline * 100).toFixed(1);
      const hrvTrend = metrics.hrv.current > hrvRefBaseline ? 'verhoogd' : metrics.hrv.current < hrvRefBaseline ? 'verlaagd' : 'stabiel';
      const workoutLine = detectedWorkout ? `\n${detectedWorkout}\n` : '';
      const userPrompt = `Status: ${status}
Cyclusfase: ${phaseName ?? 'onbekend'}
Readiness: ${metrics.readiness}/10
Slaap: ${metrics.sleep} uur
RHR: ${metrics.rhr.current} bpm (baseline: ${metrics.rhr.baseline} bpm${metrics.rhr.lutealCorrection ? ', Luteale correctie toegepast' : ''})
HRV: ${metrics.hrv.current} (baseline: ${metrics.hrv.baseline}${metrics.hrv.adjustedBaseline ? `, adjusted: ${Number(metrics.hrv.adjustedBaseline).toFixed(1)}${metrics.hrv.lutealOffsetApplied ? ' (Luteal offset +12%)' : ''}` : ''}, ${hrvTrend} met ${Math.abs(hrvChange)}%)
Red Flags: ${redFlags.count} (${redFlags.reasons.join(', ') || 'geen'})${workoutLine}

Schrijf een korte coach-notitie met de gevraagde H3-structuur.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 350,
        temperature: 0.7
      });
      return completion.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Error generating AI message', error);
      return `### Status\n${status} (fase: ${phaseName}).\n\n### Tactisch Advies\n- Houd het plan aan, maar schaal op hersteldata.\n- Monitor HRV/RHR trend en respecteer red flags.\n\n### Fueling Tip\n- Ochtend: eiwit + hydratatie vroeg.\n- Avond: eiwit + koolhydraten richting slaap.`;
    }
  }

  const router = express.Router();

  // POST /api/check-luteal-phase
  router.post('/check-luteal-phase', (req, res) => {
    try {
      const { lastPeriodDate, cycleLength } = req.body;
      if (!lastPeriodDate) {
        return res.status(400).json({ error: 'lastPeriodDate is required. Please provide a date in YYYY-MM-DD format.' });
      }
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(lastPeriodDate)) {
        return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD format.' });
      }
      const testDate = new Date(lastPeriodDate);
      if (isNaN(testDate.getTime())) {
        return res.status(400).json({ error: 'Invalid date. Please provide a valid date.' });
      }
      const cycleLengthNum = cycleLength ? parseInt(cycleLength) : 28;
      if (cycleLength && (isNaN(cycleLengthNum) || cycleLengthNum < 21 || cycleLengthNum > 35)) {
        return res.status(400).json({ error: 'Cycle length must be a number between 21 and 35 days.' });
      }
      const result = cycleService.calculateLutealPhase(lastPeriodDate, cycleLengthNum);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error calculating Luteal phase', error);
      res.status(500).json({ error: 'An error occurred while calculating the Luteal phase.', message: error.message });
    }
  });

  /**
   * @deprecated Use POST /api/save-checkin instead. This endpoint is kept for backward compatibility
   * but will return 410 Gone. Save-checkin now performs full advice logic, AI generation, and dual storage.
   */
  router.post('/daily-advice', async (req, res) => {
    return res.status(410).json({
      deprecated: true,
      message: 'Use POST /api/save-checkin instead. This endpoint has been deprecated.',
      alternative: 'POST /api/save-checkin'
    });
  });

  // POST /api/save-checkin — unified daily check-in: full advice logic, Handrem, Period reset, AI, dual storage. Protected: uid from token.
  router.post('/save-checkin', auth, async (req, res) => {
    try {
      const userId = req.user.uid;
      const {
        lastPeriodDate,
        cycleLength,
        sleep,
        rhr,
        rhrBaseline,
        hrv,
        hrvBaseline,
        readiness,
        menstruationStarted = false,
        isSick = false
      } = req.body;

      const requiredFields = { rhr, rhrBaseline, hrv, hrvBaseline, readiness };
      const missingFields = Object.entries(requiredFields)
        .filter(([key, value]) => value === undefined || value === null)
        .map(([key]) => key);
      if (missingFields.length > 0) {
        return res.status(400).json({ error: 'Missing required fields', missingFields });
      }

      const todayIso = todayAmsterdam();
      const periodStarted = Boolean(menstruationStarted);

      // Resolve effectiveLastPeriodDate: menstruationStarted => today; else body; else profile (do not require lastPeriodDate).
      let profileLastPeriodDate = null;
      try {
        if (db) {
          const userSnap = await db.collection('users').doc(String(userId)).get();
          if (userSnap.exists) {
            const data = userSnap.data() || {};
            const profile = data.profile || {};
            const raw =
              profile.cycleData?.lastPeriodDate ??
              data.cycleData?.lastPeriodDate ??
              profile.lastPeriodDate;
            if (raw != null) {
              if (typeof raw.toDate === 'function') profileLastPeriodDate = raw.toDate().toISOString().slice(0, 10);
              else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) profileLastPeriodDate = raw;
              else if (typeof raw === 'number') profileLastPeriodDate = new Date(raw).toISOString().slice(0, 10);
            }
          }
        }
      } catch (e) {
        logger.error('Profile fetch for lastPeriodDate failed', e);
      }
      const effectiveLastPeriodDate = periodStarted ? todayIso : (lastPeriodDate ?? profileLastPeriodDate ?? null);

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (effectiveLastPeriodDate != null) {
        if (!dateRegex.test(effectiveLastPeriodDate)) {
          return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD format.' });
        }
        const testDate = new Date(effectiveLastPeriodDate);
        if (isNaN(testDate.getTime())) {
          return res.status(400).json({ error: 'Invalid date. Please provide a valid date.' });
        }
      }

      const numericFields = {
        sleep: sleep != null && sleep !== '' ? parseFloat(sleep) : null,
        rhr: parseFloat(rhr),
        rhrBaseline: parseFloat(rhrBaseline),
        hrv: parseFloat(hrv),
        hrvBaseline: parseFloat(hrvBaseline),
        readiness: parseInt(readiness)
      };
      for (const [key, value] of Object.entries(numericFields)) {
        if (key === 'sleep' && value == null) continue;
        if (key === 'readiness') {
          if (isNaN(value) || value < 1 || value > 10) {
            return res.status(400).json({ error: 'Readiness must be between 1 and 10.' });
          }
          continue;
        }
        if (value == null || isNaN(value) || value < 0) {
          return res.status(400).json({ error: `Invalid value for ${key}. Must be a positive number.` });
        }
      }
      if (numericFields.sleep != null && (numericFields.sleep < 3 || numericFields.sleep > 12)) {
        return res.status(400).json({ error: 'Sleep must be between 3 and 12 hours.' });
      }

      const cycleLengthNum = cycleLength ? parseInt(cycleLength) : 28;
      if (cycleLength && (isNaN(cycleLengthNum) || cycleLengthNum < 21 || cycleLengthNum > 35)) {
        return res.status(400).json({ error: 'Cycle length must be a number between 21 and 35 days.' });
      }

      const isSickFlag = Boolean(isSick);
      const cycleInfo = effectiveLastPeriodDate != null
        ? cycleService.calculateLutealPhase(effectiveLastPeriodDate, cycleLengthNum)
        : { phaseName: null, isInLutealPhase: false, currentCycleDay: null, cycleLength: cycleLengthNum };

      let redFlags;
      const metricsForAI = {
        readiness: numericFields.readiness,
        sleep: numericFields.sleep,
        rhr: { current: numericFields.rhr, baseline: numericFields.rhrBaseline, adjustedBaseline: null, lutealCorrection: false },
        hrv: { current: numericFields.hrv, baseline: numericFields.hrvBaseline, adjustedBaseline: null, lutealOffsetApplied: false }
      };

      if (isSickFlag) {
        redFlags = { count: 0, reasons: [], details: { rhr: {}, hrv: {} } };
      } else if (numericFields.sleep == null || !Number.isFinite(numericFields.sleep)) {
        redFlags = { count: 0, reasons: ['INSUFFICIENT_INPUT_FOR_REDFLAGS'], details: { rhr: {}, hrv: {} } };
      } else {
        redFlags = cycleService.calculateRedFlags(
          numericFields.sleep,
          numericFields.rhr,
          numericFields.rhrBaseline,
          numericFields.hrv,
          numericFields.hrvBaseline,
          cycleInfo.isInLutealPhase
        );
        metricsForAI.rhr.adjustedBaseline = redFlags.details.rhr.adjustedBaseline;
        metricsForAI.rhr.lutealCorrection = redFlags.details.rhr.lutealCorrection;
        metricsForAI.hrv.adjustedBaseline = redFlags.details.hrv.adjustedBaseline;
        metricsForAI.hrv.lutealOffsetApplied = redFlags.details.hrv.lutealOffsetApplied;
      }

      // Single source of truth: statusEngine.computeStatus (aligns with daily-brief status.tag)
      let acwr = null;
      try {
        if (db && !isSickFlag) {
          const stats = await reportService.getDashboardStats({ db, admin, uid: userId });
          acwr = stats?.acwr != null && Number.isFinite(stats.acwr) ? stats.acwr : null;
        }
      } catch (e) {
        logger.error('getDashboardStats for save-checkin failed', e);
      }
      const hrvVsBaseline =
        numericFields.hrvBaseline != null && numericFields.hrvBaseline > 0 && numericFields.hrv != null
          ? Math.round((numericFields.hrv / numericFields.hrvBaseline) * 1000) / 10
          : null;
      let profileContext = null;
      try {
        if (db) {
          const userSnap = await db.collection('users').doc(String(userId)).get();
          if (userSnap.exists) profileContext = (userSnap.data() || {}).profile || null;
        }
      } catch (e) {
        logger.error('Profile fetch for check-in failed', e);
      }
      const goalIntent = profileContext?.goalIntent || profileContext?.intake?.goalIntent || null;
      const fixedClasses = profileContext?.intake?.fixedClasses === true;
      const fixedHiitPerWeek = profileContext?.intake?.fixedHiitPerWeek != null ? Number(profileContext.intake.fixedHiitPerWeek) : null;
      const recommendation = computeStatus({
        acwr,
        isSick: isSickFlag,
        readiness: numericFields.readiness,
        redFlags: redFlags.count,
        cyclePhase: cycleInfo.phaseName,
        hrvVsBaseline,
        phaseDay: cycleInfo.currentCycleDay != null ? cycleInfo.currentCycleDay : null,
        goalIntent,
        fixedClasses,
        fixedHiitPerWeek
      });
      const reasonText = (r) => (typeof r === 'object' && r != null && r.text != null ? r.text : String(r));
      const adviceContext = isSickFlag
        ? 'SICK_OVERRIDE'
        : recommendation.reasons.some((r) => reasonText(r).includes('Lethargy Override'))
          ? 'LETHARGY_OVERRIDE'
          : recommendation.reasons.some((r) => reasonText(r).includes('Elite Override'))
            ? 'ELITE_REBOUND'
            : 'STANDARD';

      let detectedWorkout = '';
      try {
        if (db) detectedWorkout = await getDetectedWorkoutForAI(userId, todayIso);
      } catch (e) {
        logger.error('Detected workout fetch failed', e);
      }

      // Learning Loop: yesterday's advice vs actual load for compliance/violation context
      const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let complianceContext = { violation: false, compliance: false, yesterdayAdvice: '', yesterdayLoad: 0 };
      try {
        if (db && !isSickFlag) {
          complianceContext = await getYesterdayComplianceContext(
            userId,
            yesterdayIso,
            profileContext || {},
            effectiveLastPeriodDate,
            cycleLengthNum
          );
        }
      } catch (e) {
        logger.error('getYesterdayComplianceContext failed', e);
      }

      let aiMessage;
      if (isSickFlag) {
        aiMessage = 'Systeem in herstelmodus. Geen training vandaag. Focus op slaap en hydratatie.';
      } else {
        aiMessage = await generateAICoachingMessage(
          recommendation.tag,
          cycleInfo.phaseName,
          metricsForAI,
          { count: redFlags.count, reasons: redFlags.reasons },
          profileContext,
          detectedWorkout,
          { isSickOrInjured: isSickFlag, periodStarted },
          complianceContext
        );
      }

      const payloadMetrics = {
        readiness: numericFields.readiness,
        redFlags: redFlags.count,
        redFlagDetails: redFlags.reasons,
        sleep: numericFields.sleep,
        rhr: { current: numericFields.rhr, baseline: numericFields.rhrBaseline, adjustedBaseline: metricsForAI.rhr.adjustedBaseline, lutealCorrection: metricsForAI.rhr.lutealCorrection },
        hrv: { current: numericFields.hrv, baseline: numericFields.hrvBaseline }
      };

      const cycleInfoPayload = {
        phase: effectiveLastPeriodDate != null ? cycleInfo.phaseName : null,
        isLuteal: effectiveLastPeriodDate != null ? cycleInfo.isInLutealPhase : false,
        currentCycleDay: effectiveLastPeriodDate != null ? cycleInfo.currentCycleDay : null,
        lastPeriodDate: effectiveLastPeriodDate,
        cycleLength: cycleLengthNum
      };

      const docData = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        date: todayIso,
        userId: String(userId),
        source: 'checkin',
        imported: false,
        metrics: payloadMetrics,
        cycleInfo: cycleInfoPayload,
        cyclePhase: periodStarted ? 'Menstrual' : cycleInfo.phaseName,
        periodStarted,
        isSickOrInjured: isSickFlag,
        recommendation: {
          status: recommendation.tag,
          reasons: recommendation.reasons,
          instructionClass: recommendation.instructionClass,
          prescriptionHint: recommendation.prescriptionHint ?? null
        },
        adviceContext,
        aiMessage,
        advice: aiMessage,
        redFlags: { count: redFlags.count, reasons: redFlags.reasons, details: redFlags.details }
      };

      if (!db) {
        return res.status(503).json({ error: 'Firestore not initialized' });
      }

      const userDocRef = db.collection('users').doc(String(userId));

      // 1) users/{uid}/dailyLogs (for weekly reports)
      const userLogRef = await userDocRef.collection('dailyLogs').add(docData);

      // 2) Root daily_logs (legacy)
      const rootLogData = {
        userId: docData.userId,
        timestamp: docData.timestamp,
        date: docData.date,
        metrics: {
          sleep: numericFields.sleep,
          rhr: numericFields.rhr,
          rhrBaseline: numericFields.rhrBaseline,
          hrv: numericFields.hrv,
          hrvBaseline: numericFields.hrvBaseline,
          readiness: numericFields.readiness
        },
        cycleInfo: { ...cycleInfoPayload },
        redFlags: docData.redFlags,
        recommendation: docData.recommendation,
        adviceContext: docData.adviceContext
      };
      await db.collection('daily_logs').add(rootLogData);

      // Period reset: update profile cycleData
      if (periodStarted && profileContext) {
        try {
          await userDocRef.set(
            {
              profile: {
                ...profileContext,
                cycleData: {
                  ...(profileContext.cycleData || {}),
                  lastPeriodDate: effectiveLastPeriodDate,
                  avgDuration: cycleLengthNum
                }
              }
            },
            { merge: true }
          );
        } catch (cycleErr) {
          logger.error('Period reset profile update failed', cycleErr);
        }
      }

      // Rolling averages: 7d & 28d HRV/RHR on user doc
      try {
        const userIdStr = String(userId);
        const logsSnap = await db
          .collection('daily_logs')
          .where('userId', '==', userIdStr)
          .orderBy('date', 'desc')
          .limit(60)
          .get();

        const toIso = (d) => d.toISOString().slice(0, 10);
        const cutoff7 = new Date();
        cutoff7.setDate(cutoff7.getDate() - 7);
        const cutoff28 = new Date();
        cutoff28.setDate(cutoff28.getDate() - 28);
        const cutoff7Str = toIso(cutoff7);
        const cutoff28Str = toIso(cutoff28);

        const logs = logsSnap.docs
          .map((d) => d.data() || {})
          .filter((d) => typeof d.date === 'string' && d.date.length >= 10);

        const inWindow = (days) => (log) => {
          const dateStr = log.date.slice(0, 10);
          return days === 7 ? dateStr >= cutoff7Str : dateStr >= cutoff28Str;
        };

        const avg = (arr) => {
          const nums = arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
          if (!nums.length) return null;
          return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10;
        };

        const metrics7 = logs.filter(inWindow(7)).map((l) => l.metrics || {});
        const metrics28 = logs.filter(inWindow(28)).map((l) => l.metrics || {});

        await userDocRef.set(
          {
            readiness: numericFields.readiness,
            metrics: {
              hrv7d: avg(metrics7.map((m) => m.hrv)),
              hrv28d: avg(metrics28.map((m) => m.hrv)),
              rhr7d: avg(metrics7.map((m) => m.rhr)),
              rhr28d: avg(metrics28.map((m) => m.rhr)),
              lastCheckin: {
                date: todayIso,
                readiness: numericFields.readiness,
                hrv: numericFields.hrv,
                rhr: numericFields.rhr
              }
            }
          },
          { merge: true }
        );
      } catch (metricsErr) {
        logger.error('Rolling averages update failed', metricsErr);
      }

      res.json({
        success: true,
        message: 'Check-in saved successfully',
        data: {
          id: userLogRef.id,
          status: recommendation.tag,
          aiMessage,
          cycleInfo: cycleInfoPayload,
          date: todayIso,
          recommendation: {
            status: recommendation.tag,
            reasons: recommendation.reasons,
            instructionClass: recommendation.instructionClass,
            prescriptionHint: recommendation.prescriptionHint ?? null
          },
          metrics: payloadMetrics
        }
      });
    } catch (error) {
      logger.error('Error saving check-in', error);
      res.status(500).json({ error: 'An error occurred while saving check-in data.', message: error.message });
    }
  });

  // POST /api/update-user-stats — aggregate latest check-in + 28d workouts, write user.stats for coach grid. Protected: uid from token.
  router.post('/update-user-stats', auth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ error: 'Firestore is not initialized' });
      }
      const uid = req.user.uid;
      const userRef = db.collection('users').doc(uid);

      // 1) Latest check-in: users/{uid}/dailyLogs orderBy timestamp desc limit 1
      const latestLogSnap = await userRef.collection('dailyLogs').orderBy('timestamp', 'desc').limit(1).get();
      let currentReadiness = null;
      let currentRHR = null;
      if (!latestLogSnap.empty) {
        const logData = latestLogSnap.docs[0].data() || {};
        const metrics = logData.metrics || {};
        currentReadiness = metrics.readiness != null ? Number(metrics.readiness) : null;
        currentRHR = metrics.rhr != null ? (typeof metrics.rhr === 'object' ? metrics.rhr.current : Number(metrics.rhr)) : null;
      }

      // 2) Profile + logs (for prime load) and activities
      const [profileData, logs56, subActivities] = await Promise.all([
        reportService.getUserProfile(db, uid),
        reportService.getLast56DaysLogs(db, admin, uid),
        reportService.getLast56DaysActivities(db, uid)
      ]);

      // Root activities (manual workouts): activities collection where userId == uid
      const rootSnap = await db.collection('activities').where('userId', '==', uid).get();
      const rootActivities = rootSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const profile = (profileData && profileData.profile) || {};
      const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : {};
      const lastPeriodDate = cycleData.lastPeriodDate || null;
      const cycleLength = Number(cycleData.avgDuration) || 28;
      const maxHr = profile.max_heart_rate != null ? Number(profile.max_heart_rate) : null;

      const logByDate = new Map();
      for (const l of logs56) {
        const key = (l.date || (l.timestamp ? String(l.timestamp).slice(0, 10) : '') || '').slice(0, 10);
        if (key) logByDate.set(key, l);
      }

      function activityDateStr(a) {
        if (a.date && typeof a.date === 'string') return a.date.slice(0, 10);
        const raw = a.start_date_local ?? a.start_date;
        if (raw == null) return '';
        if (typeof raw === 'string') return raw.slice(0, 10);
        if (typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
        if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
        return String(raw).slice(0, 10);
      }

      const twentyEightDaysAgo = new Date();
      twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoff28Str = twentyEightDaysAgo.toISOString().slice(0, 10);
      const cutoff7Str = sevenDaysAgo.toISOString().slice(0, 10);

      const allActivities = [];
      for (const a of subActivities) {
        const dateStr = activityDateStr(a);
        if (!dateStr || dateStr < cutoff28Str) continue;
        const rawLoad = calculateActivityLoad(a, profile);
        const phaseInfo = lastPeriodDate && dateStr ? cycleService.getPhaseForDate(lastPeriodDate, cycleLength, dateStr) : { phaseName: null };
        const readinessScore = logByDate.get(dateStr)?.readiness ?? 10;
        const avgHr = a.average_heartrate != null ? Number(a.average_heartrate) : null;
        const primeLoad = calculatePrimeLoad(rawLoad, phaseInfo.phaseName, readinessScore, avgHr, maxHr);
        allActivities.push({ _dateStr: dateStr, _primeLoad: primeLoad });
      }
      for (const a of rootActivities) {
        const dateStr = activityDateStr(a);
        if (!dateStr || dateStr < cutoff28Str) continue;
        const primeLoad = a.prime_load != null ? Number(a.prime_load) : 0;
        allActivities.push({ _dateStr: dateStr, _primeLoad: primeLoad });
      }

      const activitiesLast7 = allActivities.filter((a) => a._dateStr >= cutoff7Str);
      const activitiesLast28 = allActivities.filter((a) => a._dateStr >= cutoff28Str);
      const acuteLoad = Math.round(activitiesLast7.reduce((s, a) => s + a._primeLoad, 0) * 10) / 10;
      const chronicLoadRaw = activitiesLast28.reduce((s, a) => s + a._primeLoad, 0);
      const chronicLoad = chronicLoadRaw / 4;
      const acwr = calculateACWR(acuteLoad, chronicLoad);

      function directiveFromAcwr(v) {
        if (!Number.isFinite(v)) return 'MAINTAIN';
        if (v > 1.5) return 'REST';
        if (v >= 0.8 && v <= 1.3) return 'PUSH';
        return 'MAINTAIN';
      }

      // 3) BioClock (simple phase buckets) for coach grid
      let bioClock = null;
      const gender = (profile.gender || '').toString().toLowerCase();
      if (gender === 'female' && lastPeriodDate && Number.isFinite(cycleLength) && cycleLength > 0) {
        try {
          const last = new Date(lastPeriodDate);
          const today = new Date();
          const startLast = new Date(last.getFullYear(), last.getMonth(), last.getDate());
          const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const diffMs = startToday - startLast;
          const daysSinceLastPeriod = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
          const cycleDay = (daysSinceLastPeriod % cycleLength) + 1;

          let phaseLabel = 'Luteaal';
          let color = 'warning';
          if (cycleDay >= 1 && cycleDay <= 5) {
            phaseLabel = 'Menstruatie';
            color = 'negative';
          } else if (cycleDay >= 6 && cycleDay <= 12) {
            phaseLabel = 'Folliculair';
            color = 'positive';
          } else if (cycleDay >= 13 && cycleDay <= 15) {
            phaseLabel = 'Ovulatie';
            color = 'positive';
          }

          bioClock = {
            phase: phaseLabel,
            day: cycleDay,
            color,
          };
        } catch (e) {
          logger.error('BioClock calculation failed', e);
        }
      }

      const stats = {
        currentReadiness: currentReadiness,
        currentRHR: currentRHR,
        acuteLoad,
        chronicLoad: Math.round(chronicLoad * 10) / 10,
        acwr: Math.round(acwr * 100) / 100,
        directive: directiveFromAcwr(acwr),
        bioClock,
      };

      await userRef.set({ stats }, { merge: true });

      res.json({ success: true, data: { userId: uid, stats } });
    } catch (err) {
      logger.error('update-user-stats error', err);
      res.status(500).json({ error: 'Failed to update user stats', message: err.message });
    }
  });

  return router;
}

module.exports = { createDailyRouter };
