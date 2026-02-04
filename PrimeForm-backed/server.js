require('dotenv').config(); // 1. Eerst geheime sleutels laden

const express = require('express'); // 2. Frameworks inladen
const cors = require('cors');
const admin = require('firebase-admin');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const stravaService = require('./services/stravaService');

// SMTP transporter (placeholders – set SMTP_HOST, SMTP_USER, SMTP_PASS in env)
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || 'your-email@example.com',
    pass: process.env.SMTP_PASS || 'your-password'
  }
});

const ADMIN_EMAIL = 'yoramroemersma50@gmail.com';

function sendNewIntakeEmail(profile) {
  const name = profile.fullName || 'Onbekend';
  const email = profile.email || 'Onbekend';
  const goal = Array.isArray(profile.goals) && profile.goals.length > 0
    ? profile.goals.join(', ')
    : 'Geen doel opgegeven';
  const subject = `Nieuwe Intake: ${name}`;
  const text = `Nieuwe Intake: ${name} - ${email} - ${goal}`;

  mailTransporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@primeform.nl',
    to: ADMIN_EMAIL,
    subject,
    text
  }).then(() => {
    console.log('✅ Admin intake email sent to', ADMIN_EMAIL);
  }).catch((err) => {
    console.error('❌ Failed to send intake email:', err.message);
  });
}

const app = express(); // 3. NU pas bouwen we het 'huis' (de app)
const PORT = process.env.PORT || 3000;
let db = null; // Firestore; set in initFirebase()
let firebaseProjectId = null; // Uit serviceAccount bij succesvolle init; gebruikt in health

function getHealthPayload() {
  return {
    status: 'ok',
    firestore: db ? 'connected' : 'not_initialized',
    projectId: firebaseProjectId || process.env.FIREBASE_PROJECT_ID || 'unknown'
  };
}

// Eerste route: health check (boven alles, voor Render)
app.get('/api/health', (req, res) => res.json(getHealthPayload()));
app.get('/health', (req, res) => res.json(getHealthPayload()));
app.get('/healthz', (req, res) => res.json(getHealthPayload()));

// 4. Nu zetten we de deuren open en zorgen we dat hij JSON snapt
// CORS: lokaal + productie Vercel (met en zonder trailing slash)
const allowedOrigins = [
  'http://localhost:9000',
  'https://prime-form-frontend2701.vercel.app',
  'https://prime-form-frontend2701.vercel.app/'
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  })
);
app.use(express.json()); // BELANGRIJK: Zonder dit kan hij de data van je sliders niet lezen!

// --- Hieronder komen je routes (api/daily-advice etc.) ---

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Knowledge base: loaded at startup from knowledge/*.md
let knowledgeBaseContent = '';

/**
 * Load all .md files from knowledge/ into a single string.
 * Called at server startup. Files are read in fixed order: logic, science, lingo, guardrails, examples.
 */
function loadKnowledgeBase() {
  const knowledgeDir = path.join(__dirname, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) {
    console.warn('⚠️ knowledge/ directory not found; knowledge base will be empty.');
    return '';
  }

  const order = ['logic.md', 'science.md', 'lingo.md', 'guardrails.md', 'examples.md'];
  const parts = [];

  for (const name of order) {
    const filePath = path.join(knowledgeDir, name);
    if (fs.existsSync(filePath)) {
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        parts.push(`## ${name}\n${text}`);
      } catch (err) {
        console.warn(`⚠️ Could not read ${name}:`, err.message);
      }
    }
  }

  const combined = parts.join('\n\n');
  console.log('📚 Knowledge base loaded:', combined.length, 'characters from', parts.length, 'file(s)');
  return combined;
}

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
    cycleData && typeof cycleData.lastPeriod === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cycleData.lastPeriod);
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

// Profile endpoints
app.get('/api/profile', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }

    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }

    const userDocRef = db.collection('users').doc(String(userId));
    const snap = await userDocRef.get();

    if (!snap.exists) {
      console.log(`Profile loaded for userId ${userId}: (not found)`);
      return res.json({
        success: true,
        data: {
          userId,
          profile: null,
          profileComplete: false,
          strava: null
        }
      });
    }

    const data = snap.data() || {};
    console.log(`Profile loaded for userId ${userId}`);
    return res.json({
      success: true,
      data: {
        userId,
        profile: data.profile || null,
        profileComplete: data.profileComplete === true,
        strava: data.strava || null
      }
    });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT:', error);
    return res.status(500).json({ success: false, error: 'Failed to load profile', message: error.message });
  }
});

// --- Strava disconnect (user clears connection from Settings) ---
app.put('/api/strava/disconnect', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, error: 'Missing userId' });
    const userRef = db.collection('users').doc(String(userId));
    await userRef.set(
      {
        strava: { connected: false },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return res.json({ success: true, data: { disconnected: true } });
  } catch (err) {
    console.error('Strava disconnect error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- Strava OAuth (Stap 1) ---
app.get('/auth/strava/connect', (req, res) => {
  try {
    const userId = (req.query.userId || '').toString().trim();
    if (!userId) {
      return res.status(400).send('Missing userId. Use /auth/strava/connect?userId=YOUR_USER_ID');
    }
    const url = stravaService.getAuthUrl(userId);
    res.redirect(302, url);
  } catch (err) {
    console.error('Strava connect error:', err);
    res.status(500).send(err.message || 'Strava config missing');
  }
});

app.get('/auth/strava/callback', async (req, res) => {
  const frontendUrl = (process.env.FRONTEND_APP_URL || 'http://localhost:9000').replace(/\/$/, '');
  const settingsPath = `${frontendUrl}/settings`;

  try {
    const { code, state: userId, error } = req.query;
    if (error === 'access_denied') {
      return res.redirect(`${settingsPath}?status=strava_denied`);
    }
    if (!code || !userId) {
      return res.redirect(`${settingsPath}?status=strava_error&message=missing_code_or_state`);
    }

    const tokens = await stravaService.exchangeToken(code);
    const athleteId = tokens.athlete?.id || null;

    if (!db) {
      return res.redirect(`${settingsPath}?status=strava_error&message=db_not_ready`);
    }

    const athlete = tokens.athlete || {};
    const athleteName = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || null;
    const userRef = db.collection('users').doc(String(userId));
    await userRef.set(
      {
        strava: {
          connected: true,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_at,
          athleteId: athleteId,
          athleteName: athleteName
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    console.log(`✅ Strava connected for user ${userId}, athleteId ${athleteId}`);
    res.redirect(302, `${settingsPath}?status=success`);
  } catch (err) {
    console.error('Strava callback error:', err);
    res.redirect(`${settingsPath}?status=strava_error&message=${encodeURIComponent(err.message || 'unknown')}`);
  }
});

// GET /api/strava/sync/:uid — fetch last 3 days from Strava, store in users/{uid}/activities
app.get('/api/strava/sync/:uid', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const uid = req.params.uid;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Missing uid' });
    }
    const result = await stravaService.getRecentActivities(uid, db, admin);
    return res.json({ success: true, data: { newCount: result.count } });
  } catch (err) {
    console.error('Strava sync error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/strava/activities/:uid — return stored activities (for dashboard & admin)
app.get('/api/strava/activities/:uid', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    const uid = req.params.uid;
    if (!uid) return res.status(400).json({ success: false, error: 'Missing uid' });
    const snap = await db.collection('users').doc(String(uid)).collection('activities').get();
    const activities = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, data: activities });
  } catch (err) {
    console.error('Strava activities list error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/profile', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }

    const { userId, profilePatch } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }
    if (!profilePatch || typeof profilePatch !== 'object') {
      return res.status(400).json({ success: false, error: 'Missing profilePatch' });
    }

    const userDocRef = db.collection('users').doc(String(userId));
    const existing = await userDocRef.get();
    const existingProfile = existing.exists ? (existing.data()?.profile || {}) : {};

    const mergedProfile = { ...existingProfile, ...profilePatch };
    if (existingProfile.cycleData || profilePatch.cycleData) {
      mergedProfile.cycleData = {
        ...(existingProfile.cycleData || {}),
        ...(profilePatch.cycleData || {})
      };
    }
    const profileComplete = isProfileComplete(mergedProfile);

    await userDocRef.set(
      {
        profile: mergedProfile,
        profileComplete,
        createdAt: existing.exists ? (existing.data()?.createdAt || new Date()) : new Date(),
        updatedAt: new Date()
      },
      { merge: true }
    );

    console.log(`Profile saved for userId ${userId} (profileComplete=${profileComplete})`);

    if (profileComplete && !(existing.exists && existing.data()?.profileComplete === true)) {
      sendNewIntakeEmail(mergedProfile);
    }

    return res.json({
      success: true,
      data: { userId, profile: mergedProfile, profileComplete }
    });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT:', error);
    return res.status(500).json({ success: false, error: 'Failed to save profile', message: error.message });
  }
});

// Initialize Firebase Admin
async function initFirebase() {
  console.log('🔥 Firebase wordt geïnitialiseerd...');
  console.log('Firebase Env Check:', process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'Exists' : 'Missing');

  if (admin.apps.length) {
    await Promise.all(admin.apps.map((app) => app.delete()));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      // Herstel de private key voor Render/Linux omgevingen
      if (typeof serviceAccount.private_key === 'string') {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
      firebaseProjectId = serviceAccount.project_id;
      console.log('Firebase succesvol verbonden. serviceAccount.project_id:', firebaseProjectId);
    } catch (error) {
      console.error('Firebase init error:', error.message);
      db = null;
    }
    return;
  }

  // Lokaal: fallback naar firebase-key.json
  try {
    const keyPath = path.join(__dirname, 'firebase-key.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    if (typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    firebaseProjectId = serviceAccount.project_id;
    console.log('Firebase succesvol verbonden (lokaal). serviceAccount.project_id:', firebaseProjectId);
  } catch (error) {
    console.error('Firebase init error (lokaal):', error.message);
    db = null;
  }
}

/**
 * Calculate if user is in Luteal phase based on last period date
 * 
 * The Luteal phase typically occurs in the second half of the menstrual cycle,
 * after ovulation (around day 14) and before menstruation.
 * It usually lasts 12-14 days, from approximately day 15 to day 28 of a 28-day cycle.
 * 
 * @param {string} lastPeriodDate - Date string in YYYY-MM-DD format
 * @param {number} cycleLength - Average cycle length in days (default: 28)
 * @returns {object} - Object containing phase information
 */
function calculateLutealPhase(lastPeriodDate, cycleLength = 28) {
  const lastPeriod = new Date(lastPeriodDate);
  const today = new Date();
  
  
  // Reset time to midnight for accurate day calculation
  lastPeriod.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  // Calculate days since last period
  const daysSinceLastPeriod = Math.floor((today - lastPeriod) / (1000 * 60 * 60 * 24));
  
  // Calculate current cycle day (1 = first day of period)
  const currentCycleDay = (daysSinceLastPeriod % cycleLength) + 1;
  
  // Ovulation typically occurs around day 14 (for a 28-day cycle)
  // Adjust for different cycle lengths
  const ovulationDay = Math.floor(cycleLength / 2);
  
  // Luteal phase typically starts after ovulation and lasts 12-14 days
  // It's approximately the second half of the cycle
  const lutealPhaseStart = ovulationDay + 1;
  const lutealPhaseEnd = cycleLength;
  
  const isInLutealPhase = currentCycleDay >= lutealPhaseStart && currentCycleDay <= lutealPhaseEnd;
  
  // Determine phase name
  let phaseName;
  if (currentCycleDay <= 5) {
    phaseName = 'Menstrual';
  } else if (currentCycleDay <= ovulationDay) {
    phaseName = 'Follicular';
  } else if (currentCycleDay <= lutealPhaseEnd) {
    phaseName = 'Luteal';
  } else {
    phaseName = 'Menstrual';
  }
  
  return {
    isInLutealPhase,
    currentCycleDay,
    daysSinceLastPeriod,
    phaseName,
    cycleLength,
    lutealPhaseRange: {
      start: lutealPhaseStart,
      end: lutealPhaseEnd
    }
  };
}

/**
 * Calculate Red Flags based on sleep, RHR, and HRV
 * @param {number} sleep - Sleep hours
 * @param {number} rhr - Current resting heart rate
 * @param {number} rhrBaseline - Baseline resting heart rate
 * @param {number} hrv - Current HRV
 * @param {number} hrvBaseline - Baseline HRV
 * @param {boolean} isLuteal - Whether user is in Luteal phase
 * @returns {object} - Red flags count and details
 */
function calculateRedFlags(sleep, rhr, rhrBaseline, hrv, hrvBaseline, isLuteal) {
  let redFlags = 0;
  const reasons = [];
  
  // Apply Luteal correction: increase RHR baseline by 3 if in Luteal phase
  const adjustedRhrBaseline = isLuteal ? rhrBaseline + 3 : rhrBaseline;
  // Apply Luteal HRV correction: increase HRV baseline by 12% if in Luteal phase
  const adjustedHrvBaseline = isLuteal ? hrvBaseline * 1.12 : hrvBaseline;
  
  // Red Flag 1: Sleep < 5.5 hours
  if (sleep < 5.5) {
    redFlags++;
    reasons.push(`Slaap < 5.5u (${sleep.toFixed(1)}u)`);
  }
  
  // Red Flag 2: RHR > baseline + 5%
  const rhrThreshold = adjustedRhrBaseline * 1.05;
  if (rhr > rhrThreshold) {
    redFlags++;
    const increase = ((rhr - adjustedRhrBaseline) / adjustedRhrBaseline * 100).toFixed(1);
    reasons.push(`RHR > baseline + 5% (${rhr} vs ${adjustedRhrBaseline.toFixed(1)}${isLuteal ? ' (Luteale correctie +3)' : ''}, +${increase}%)`);
  }
  
  // Red Flag 3: HRV < baseline - 10%
  const hrvThreshold = adjustedHrvBaseline * 0.9;
  if (hrv < hrvThreshold) {
    redFlags++;
    const refBaseline = adjustedHrvBaseline;
    const decrease = ((refBaseline - hrv) / refBaseline * 100).toFixed(1);
    reasons.push(
      `HRV < baseline - 10% (${hrv} vs ${refBaseline.toFixed(1)}${isLuteal ? ' (Luteal offset +12%)' : ''}, -${decrease}%)`
    );
  }
  
  return {
    count: redFlags,
    reasons,
    details: {
      sleep: { value: sleep, threshold: 5.5, flagged: sleep < 5.5 },
      rhr: { 
        value: rhr, 
        baseline: rhrBaseline, 
        adjustedBaseline: adjustedRhrBaseline,
        threshold: rhrThreshold, 
        flagged: rhr > rhrThreshold,
        lutealCorrection: isLuteal
      },
      hrv: { 
        value: hrv, 
        baseline: hrvBaseline, 
        adjustedBaseline: adjustedHrvBaseline,
        threshold: hrvThreshold, 
        flagged: hrv < hrvThreshold,
        lutealOffsetApplied: isLuteal
      }
    }
  };
}

/**
 * Load last workout (today or yesterday) from users/{uid}/activities for AI context.
 * @param {object} db - Firestore
 * @param {string} userId
 * @returns {Promise<string>} - [DETECTED WORKOUT]: ... or empty string
 */
async function getDetectedWorkoutForAI(db, userId) {
  if (!db || !userId) return '';
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const snap = await db.collection('users').doc(String(userId)).collection('activities').get();
    const activities = [];
    snap.docs.forEach((doc) => {
      const d = doc.data() || {};
      const dateLocal = (d.start_date_local || d.start_date || '').toString().slice(0, 10);
      if (dateLocal === today || dateLocal === yesterday) {
        activities.push({ ...d, id: doc.id });
      }
    });
    if (activities.length === 0) return '';
    activities.sort((a, b) => (b.start_date_local || b.start_date || '').localeCompare(a.start_date_local || a.start_date || ''));
    const a = activities[0];
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
    return `[DETECTED WORKOUT]: ${parts.join(', ')}.`;
  } catch (e) {
    console.error('getDetectedWorkoutForAI:', e);
    return '';
  }
}

/**
 * Generate AI coaching message using OpenAI
 * @param {string} status - Training status (REST/RECOVER/MAINTAIN/PUSH)
 * @param {string} phaseName - Menstrual cycle phase name
 * @param {object} metrics - Metrics object with sleep, rhr, hrv, etc.
 * @param {object} redFlags - Red flags object with count and reasons
 * @param {object} [profileContext] - Profile/intake data
 * @param {string} [detectedWorkout] - Optional [DETECTED WORKOUT] line from Strava
 * @returns {Promise<string>} - AI generated coaching message
 */
async function generateAICoachingMessage(status, phaseName, metrics, redFlags, profileContext = null, detectedWorkout = '') {
  try {
    const complianceInstruction = detectedWorkout
      ? '\n\nCOMPLIANCE CHECK: Check if the detected workout matches the advice given yesterday. If I advised Recover or Rest but the user did a High Load workout, mention it gently in your advice (e.g. "Ik zie dat je flink bent gegaan – volgende keer even afstemmen op het advies."). Do not be harsh.'
      : '';
    const systemPrompt = `Je bent PrimeForm, de elite biohacking coach. Gebruik ONDERSTAANDE kennisbasis strikt voor je advies. Wijk hier niet van af.

--- KNOWLEDGE BASE START ---
${knowledgeBaseContent}
--- KNOWLEDGE BASE END ---

INSTRUCTION FOR LANGUAGE GENERATION: 1. REASONING: First, think in English about the advice based on Logic v2.0. 2. TRANSLATION: When writing the final response in Dutch, imagine you are texting a smart friend. Use short sentences. Use 'spreektaal' (spoken language), not 'schrijftaal' (written language). 3. FILTER: Check against lingo.md restrictions. If it sounds like a translated document, REWRITE it to sound human.${complianceInstruction}

IntakeData (kan leeg zijn):
${profileContext ? JSON.stringify(profileContext).slice(0, 2500) : 'null'}`;
    
    // Calculate HRV change percentage for context
    const hrvRefBaseline = metrics.hrv.adjustedBaseline || metrics.hrv.baseline;
    const hrvChange = ((metrics.hrv.current - hrvRefBaseline) / hrvRefBaseline * 100).toFixed(1);
    const hrvTrend = metrics.hrv.current > hrvRefBaseline ? 'verhoogd' : metrics.hrv.current < hrvRefBaseline ? 'verlaagd' : 'stabiel';
    
    const workoutLine = detectedWorkout ? `\n${detectedWorkout}\n` : '';
    const userPrompt = `Status: ${status}
Cyclusfase: ${phaseName}
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
    console.error('Error generating AI message:', error);
    // Return a fallback message if AI fails
    return `### Status\n${status} (fase: ${phaseName}).\n\n### Tactisch Advies\n- Houd het plan aan, maar schaal op hersteldata.\n- Monitor HRV/RHR trend en respecteer red flags.\n\n### Fueling Tip\n- Ochtend: eiwit + hydratatie vroeg.\n- Avond: eiwit + koolhydraten richting slaap.`;
  }
}

/**
 * Determine training recommendation based on PrimeForm logic
 * @param {number} readiness - Readiness score
 * @param {number} redFlags - Number of red flags
 * @param {string} phaseName - Menstrual cycle phase name
 * @returns {object} - Recommendation with status and reasons
 */
function determineRecommendation(readiness, redFlags, phaseName) {
  const isLuteal = phaseName === 'Luteal';
  const isFollicular = phaseName === 'Follicular';
  const reasons = [];
  
  // Decision tree
  if (readiness <= 3 || redFlags >= 2) {
    reasons.push(readiness <= 3 ? `Readiness <= 3 (${readiness})` : `Red Flags >= 2 (${redFlags})`);
    return {
      status: 'REST',
      reasons
    };
  }
  
  if ((readiness >= 4 && readiness <= 6 && isLuteal) || redFlags === 1) {
    if (readiness >= 4 && readiness <= 6 && isLuteal) {
      reasons.push(`Readiness 4-6 (${readiness}) EN Luteale fase`);
    }
    if (redFlags === 1) {
      reasons.push(`Red Flags == 1 (${redFlags})`);
    }
    return {
      status: 'RECOVER',
      reasons
    };
  }
  
  if (readiness >= 8 && redFlags === 0 && isFollicular) {
    reasons.push(`Readiness >= 8 (${readiness}) EN 0 Red Flags EN Folliculaire fase`);
    return {
      status: 'PUSH',
      reasons
    };
  }
  
  // Default: MAINTAIN
  reasons.push(`Geen specifieke condities voor REST, RECOVER of PUSH`);
  return {
    status: 'MAINTAIN',
    reasons
  };
}

// Route to check Luteal phase
app.post('/api/check-luteal-phase', (req, res) => {
  try {
    const { lastPeriodDate, cycleLength } = req.body;
    
    // Validate input
    if (!lastPeriodDate) {
      return res.status(400).json({
        error: 'lastPeriodDate is required. Please provide a date in YYYY-MM-DD format.'
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(lastPeriodDate)) {
      return res.status(400).json({
        error: 'Invalid date format. Please use YYYY-MM-DD format.'
      });
    }
    
    // Validate date is valid
    const testDate = new Date(lastPeriodDate);
    if (isNaN(testDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid date. Please provide a valid date.'
      });
    }
    
    // Validate cycle length if provided
    const cycleLengthNum = cycleLength ? parseInt(cycleLength) : 28;
    if (cycleLength && (isNaN(cycleLengthNum) || cycleLengthNum < 21 || cycleLengthNum > 35)) {
      return res.status(400).json({
        error: 'Cycle length must be a number between 21 and 35 days.'
      });
    }
    
    // Calculate Luteal phase
    const result = calculateLutealPhase(lastPeriodDate, cycleLengthNum);
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error calculating Luteal phase:', error);
    res.status(500).json({
      error: 'An error occurred while calculating the Luteal phase.',
      message: error.message
    });
  }
});

// Route for daily advice with full PrimeForm logic
app.post('/api/daily-advice', async (req, res) => {
  console.log('🚀 BINNENKOMEND VERZOEK OP /api/daily-advice');
  console.log('📦 req.body:', req.body);
  try {
    const { 
      userId,
      lastPeriodDate, 
      cycleLength,
      sleep,
      rhr,
      rhrBaseline,
      hrv,
      hrvBaseline,
      readiness
    } = req.body;
    
    // Validate required fields
    const requiredFields = {
      userId,
      lastPeriodDate,
      sleep,
      rhr,
      rhrBaseline,
      hrv,
      hrvBaseline,
      readiness
    };
    
    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => value === undefined || value === null)
      .map(([key]) => key);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(lastPeriodDate)) {
      return res.status(400).json({
        error: 'Invalid date format. Please use YYYY-MM-DD format.'
      });
    }
    
    // Validate date is valid
    const testDate = new Date(lastPeriodDate);
    if (isNaN(testDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid date. Please provide a valid date.'
      });
    }
    
    // Validate numeric fields
    const numericFields = {
      sleep: parseFloat(sleep),
      rhr: parseFloat(rhr),
      rhrBaseline: parseFloat(rhrBaseline),
      hrv: parseFloat(hrv),
      hrvBaseline: parseFloat(hrvBaseline),
      readiness: parseInt(readiness)
    };
    
    for (const [key, value] of Object.entries(numericFields)) {
      if (isNaN(value) || value < 0) {
        return res.status(400).json({
          error: `Invalid value for ${key}. Must be a positive number.`
        });
      }
    }
    
    // Validate cycle length if provided
    const cycleLengthNum = cycleLength ? parseInt(cycleLength) : 28;
    if (cycleLength && (isNaN(cycleLengthNum) || cycleLengthNum < 21 || cycleLengthNum > 35)) {
      return res.status(400).json({
        error: 'Cycle length must be a number between 21 and 35 days.'
      });
    }
    
    // Validate readiness range (typically 1-10)
    if (numericFields.readiness < 1 || numericFields.readiness > 10) {
      return res.status(400).json({
        error: 'Readiness must be between 1 and 10.'
      });
    }
    
    // Calculate menstrual cycle phase
    const cycleInfo = calculateLutealPhase(lastPeriodDate, cycleLengthNum);

    // Fetch profile context (non-fatal if missing)
    let profileContext = null;
    try {
      if (db) {
        const userSnap = await db.collection('users').doc(String(userId)).get();
        if (userSnap.exists) {
          const userData = userSnap.data() || {};
          profileContext = userData.profile || null;
          console.log(`✅ Profile context loaded for userId: ${userId}`);
        } else {
          console.log(`ℹ️ No profile found for userId: ${userId}`);
        }
      }
    } catch (error) {
      console.error('❌ FIRESTORE FOUT:', error);
      profileContext = null;
    }

    // Detected workout (Strava) for today/yesterday — for AI context and compliance check
    let detectedWorkout = '';
    try {
      if (db) detectedWorkout = await getDetectedWorkoutForAI(db, userId);
      if (detectedWorkout) console.log('🏃 Detected workout for AI:', detectedWorkout);
    } catch (e) {
      console.error('Detected workout fetch failed:', e);
    }
    
    // Calculate Red Flags
    const redFlags = calculateRedFlags(
      numericFields.sleep,
      numericFields.rhr,
      numericFields.rhrBaseline,
      numericFields.hrv,
      numericFields.hrvBaseline,
      cycleInfo.isInLutealPhase
    );
    
    // Determine recommendation
    const recommendation = determineRecommendation(
      numericFields.readiness,
      redFlags.count,
      cycleInfo.phaseName
    );
    
    // Prepare metrics object for AI
    const metricsForAI = {
      readiness: numericFields.readiness,
      sleep: numericFields.sleep,
      rhr: {
        current: numericFields.rhr,
        baseline: numericFields.rhrBaseline,
        adjustedBaseline: redFlags.details.rhr.adjustedBaseline,
        lutealCorrection: redFlags.details.rhr.lutealCorrection
      },
      hrv: {
        current: numericFields.hrv,
        baseline: numericFields.hrvBaseline,
        adjustedBaseline: redFlags.details.hrv.adjustedBaseline,
        lutealOffsetApplied: redFlags.details.hrv.lutealOffsetApplied
      }
    };
    
    // Generate AI coaching message (with optional detected workout for compliance check)
    const aiMessage = await generateAICoachingMessage(
      recommendation.status,
      cycleInfo.phaseName,
      metricsForAI,
      { count: redFlags.count, reasons: redFlags.reasons },
      profileContext,
      detectedWorkout
    );

    // Build response payload
    const responsePayload = {
      success: true,
      data: {
        status: recommendation.status,
        reasons: recommendation.reasons,
        aiMessage: aiMessage,
        cycleInfo: {
          phase: cycleInfo.phaseName,
          isLuteal: cycleInfo.isInLutealPhase,
          currentCycleDay: cycleInfo.currentCycleDay
        },
        metrics: {
          readiness: numericFields.readiness,
          redFlags: redFlags.count,
          redFlagDetails: redFlags.reasons,
          sleep: numericFields.sleep,
          rhr: {
            current: numericFields.rhr,
            baseline: numericFields.rhrBaseline,
            adjustedBaseline: redFlags.details.rhr.adjustedBaseline,
            lutealCorrection: redFlags.details.rhr.lutealCorrection
          },
          hrv: {
            current: numericFields.hrv,
            baseline: numericFields.hrvBaseline
          }
        }
      }
    };

    // Auto-save to Firestore (non-fatal if it fails)
    try {
      if (!db) throw new Error('Firestore is not initialized (db is null)');
      console.log('📥 Poging tot opslaan in Firestore...');
      await db
        .collection('users')
        .doc(String(userId))
        .collection('dailyLogs')
        .add({
          timestamp: FieldValue.serverTimestamp(),
          date: new Date().toISOString().split('T')[0],
          userId: String(userId),
          metrics: responsePayload.data.metrics,
          cycleInfo: {
            ...responsePayload.data.cycleInfo,
            lastPeriodDate,
            cycleLength: cycleLengthNum
          },
          recommendation: {
            status: recommendation.status,
            reasons: recommendation.reasons
          },
          aiMessage: aiMessage,
          // Duplicate under a generic "advice" key for easier querying / display
          advice: aiMessage
        });
      console.log('✅ Data succesvol opgeslagen in Firestore!');
    } catch (error) {
      console.error('❌ FIRESTORE FOUT:', error);
      // Do not fail the endpoint if Firestore write fails
    }

    // Send response
    res.json(responsePayload);
    
  } catch (error) {
    console.error('Error calculating daily advice:', error);
    res.status(500).json({
      error: 'An error occurred while calculating daily advice.',
      message: error.message
    });
  }
});

// Route to save check-in data to Firestore
app.post('/api/save-checkin', async (req, res) => {
  try {
    const { 
      userId,
      lastPeriodDate, 
      cycleLength,
      sleep,
      rhr,
      rhrBaseline,
      hrv,
      hrvBaseline,
      readiness
    } = req.body;
    
    // Validate required fields
    const requiredFields = {
      userId,
      lastPeriodDate,
      sleep,
      rhr,
      rhrBaseline,
      hrv,
      hrvBaseline,
      readiness
    };
    
    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => value === undefined || value === null)
      .map(([key]) => key);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(lastPeriodDate)) {
      return res.status(400).json({
        error: 'Invalid date format. Please use YYYY-MM-DD format.'
      });
    }
    
    // Validate date is valid
    const testDate = new Date(lastPeriodDate);
    if (isNaN(testDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid date. Please provide a valid date.'
      });
    }
    
    // Validate numeric fields
    const numericFields = {
      sleep: parseFloat(sleep),
      rhr: parseFloat(rhr),
      rhrBaseline: parseFloat(rhrBaseline),
      hrv: parseFloat(hrv),
      hrvBaseline: parseFloat(hrvBaseline),
      readiness: parseInt(readiness)
    };
    
    for (const [key, value] of Object.entries(numericFields)) {
      if (isNaN(value) || value < 0) {
        return res.status(400).json({
          error: `Invalid value for ${key}. Must be a positive number.`
        });
      }
    }
    
    // Validate cycle length if provided
    const cycleLengthNum = cycleLength ? parseInt(cycleLength) : 28;
    if (cycleLength && (isNaN(cycleLengthNum) || cycleLengthNum < 21 || cycleLengthNum > 35)) {
      return res.status(400).json({
        error: 'Cycle length must be a number between 21 and 35 days.'
      });
    }
    
    // Validate readiness range (typically 1-10)
    if (numericFields.readiness < 1 || numericFields.readiness > 10) {
      return res.status(400).json({
        error: 'Readiness must be between 1 and 10.'
      });
    }
    
    // Calculate menstrual cycle phase
    const cycleInfo = calculateLutealPhase(lastPeriodDate, cycleLengthNum);
    
    // Calculate Red Flags
    const redFlags = calculateRedFlags(
      numericFields.sleep,
      numericFields.rhr,
      numericFields.rhrBaseline,
      numericFields.hrv,
      numericFields.hrvBaseline,
      cycleInfo.isInLutealPhase
    );
    
    // Determine recommendation
    const recommendation = determineRecommendation(
      numericFields.readiness,
      redFlags.count,
      cycleInfo.phaseName
    );
    
    // Prepare document data
    const checkinData = {
      userId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
      metrics: {
        sleep: numericFields.sleep,
        rhr: numericFields.rhr,
        rhrBaseline: numericFields.rhrBaseline,
        hrv: numericFields.hrv,
        hrvBaseline: numericFields.hrvBaseline,
        readiness: numericFields.readiness
      },
      cycleInfo: {
        lastPeriodDate,
        cycleLength: cycleLengthNum,
        phase: cycleInfo.phaseName,
        isLuteal: cycleInfo.isInLutealPhase,
        currentCycleDay: cycleInfo.currentCycleDay
      },
      redFlags: {
        count: redFlags.count,
        reasons: redFlags.reasons,
        details: redFlags.details
      },
      recommendation: {
        status: recommendation.status,
        reasons: recommendation.reasons
      }
    };
    
    // Save to Firestore collection 'daily_logs'
    let docRef;
    try {
      docRef = await db.collection('daily_logs').add(checkinData);
    } catch (firestoreError) {
      console.error('Firestore save failed (save-checkin):', firestoreError);
      // Return a non-fatal response: endpoint works, but indicates it wasn't stored
      return res.status(200).json({
        success: false,
        message: 'Check-in berekend, maar opslaan in Firestore is mislukt.',
        firestoreError: firestoreError.message,
        data: checkinData
      });
    }
    
    res.json({
      success: true,
      message: 'Check-in data saved successfully',
      data: {
        id: docRef.id,
        ...checkinData
      }
    });
    
  } catch (error) {
    console.error('Error saving check-in:', error);
    res.status(500).json({
      error: 'An error occurred while saving check-in data.',
      message: error.message
    });
  }
});

// Admin route: Batch import historical data
app.post('/api/admin/import-history', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firestore is not initialized'
      });
    }

    // Admin check
    const adminEmail = (req.headers['x-admin-email'] || req.body.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Admin access required'
      });
    }

    const { userId, entries } = req.body;

    if (!userId || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId or entries array'
      });
    }

    // Import each entry
    const batch = db.batch();
    const userLogsRef = db.collection('users').doc(String(userId)).collection('dailyLogs');

    let imported = 0;
    for (const entry of entries) {
      const { date, hrv, rhr } = entry;
      
      if (!date || hrv === undefined || rhr === undefined) {
        continue; // Skip invalid entries
      }

      // Create timestamp from date string (YYYY-MM-DD)
      const entryDate = new Date(date + 'T00:00:00');
      const formattedDate = date;

      const docRef = userLogsRef.doc();
      batch.set(docRef, {
        timestamp: admin.firestore.Timestamp.fromDate(entryDate),
        date: formattedDate,
        userId: String(userId),
        metrics: {
          hrv: Number(hrv),
          rhr: { current: Number(rhr) },
          readiness: null,
          sleep: null
        },
        cycleInfo: null,
        recommendation: null,
        aiMessage: null,
        imported: true,
        importedAt: FieldValue.serverTimestamp()
      });

      imported++;
    }

    // Commit batch
    await batch.commit();

    console.log(`✅ Batch import: ${imported} entries for userId ${userId}`);

    res.json({
      success: true,
      data: {
        imported,
        total: entries.length
      }
    });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import history',
      message: error.message
    });
  }
});

// Admin route: Fetch all users
app.get('/api/admin/users', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firestore is not initialized'
      });
    }

    // Simple admin check (in production, use proper authentication)
    const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Admin access required'
      });
    }

    // Fetch all users from Firestore
    const usersSnapshot = await db.collection('users').get();
    
    const users = usersSnapshot.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        userId: doc.id,
        profile: data.profile || null,
        profileComplete: data.profileComplete || false,
        adminNotes: data.adminNotes ?? null,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
      };
    });

    console.log(`✅ Admin users query: ${users.length} users fetched`);

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
      message: error.message
    });
  }
});

// Admin route: Delete user (Auth + Firestore)
app.delete('/api/admin/users/:uid', async (req, res) => {
  try {
    const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Admin access required'
      });
    }

    const uid = req.params.uid;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Missing user id' });
    }

    if (admin.apps.length > 0) {
      try {
        await admin.auth().deleteUser(uid);
        console.log('✅ Auth user deleted:', uid);
      } catch (authErr) {
        if (authErr.code !== 'auth/user-not-found') {
          console.warn('Auth deleteUser failed (non-fatal):', authErr.message);
        }
      }
    }

    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firestore is not initialized'
      });
    }

    const userRef = db.collection('users').doc(String(uid));
    const dailyLogsRef = userRef.collection('dailyLogs');
    const snap = await dailyLogsRef.limit(500).get();

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    await userRef.delete();
    console.log('✅ Firestore user deleted:', uid);

    res.json({
      success: true,
      data: { deleted: uid }
    });
  } catch (error) {
    console.error('❌ Admin delete user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user',
      message: error.message
    });
  }
});

// Admin route: Aggregated dashboard stats
// - newThisWeek: users created in the last 7 days
// - checkinsToday: all dailyLogs entries across users for "today"
app.get('/api/admin/stats', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firestore is not initialized'
      });
    }

    // Simple admin check (in production, use proper authentication)
    const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Admin access required'
      });
    }

    const now = new Date();

    // --- New members this week ---
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const usersWeekSnapshot = await db
      .collection('users')
      .where('createdAt', '>=', weekAgo)
      .get();

    const newThisWeek = usersWeekSnapshot.size;

    // --- Check-ins today (via collectionGroup on dailyLogs) ---
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(startOfDay.getDate() + 1);

    const startTs = admin.firestore.Timestamp.fromDate(startOfDay);
    const endTs = admin.firestore.Timestamp.fromDate(endOfDay);

    const logsSnapshot = await db
      .collectionGroup('dailyLogs')
      .where('timestamp', '>=', startTs)
      .where('timestamp', '<', endTs)
      .get();

    const checkinsToday = logsSnapshot.size;

    return res.json({
      success: true,
      data: {
        newThisWeek,
        checkinsToday
      }
    });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT (admin stats):', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin stats',
      message: error.message
    });
  }
});

// Admin route: Patch user profile (e.g. cycleData.cycleDay, currentPhase) — admin only
app.put('/api/admin/profile-patch', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const adminEmail = (req.headers['x-admin-email'] || req.body?.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Admin access required' });
    }
    const { userId, profilePatch } = req.body || {};
    if (!userId || !profilePatch || typeof profilePatch !== 'object') {
      return res.status(400).json({ success: false, error: 'Missing userId or profilePatch' });
    }
    const userRef = db.collection('users').doc(String(userId));
    const snap = await userRef.get();
    const existing = snap.exists ? snap.data() : {};
    const existingProfile = existing.profile || {};
    const mergedProfile = { ...existingProfile, ...profilePatch };
    if (existingProfile.cycleData || profilePatch.cycleData) {
      mergedProfile.cycleData = {
        ...(existingProfile.cycleData || {}),
        ...(profilePatch.cycleData || {})
      };
    }
    await userRef.set(
      {
        profile: mergedProfile,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    res.json({ success: true, data: { userId, profile: mergedProfile } });
  } catch (error) {
    console.error('❌ admin profile-patch:', error);
    res.status(500).json({ success: false, error: 'Failed to update profile', message: error.message });
  }
});

// Admin route: Save internal notes (adminNotes on user doc) — never exposed to user app
app.put('/api/admin/user-notes', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const adminEmail = (req.headers['x-admin-email'] || req.body?.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Admin access required' });
    }
    const { userId, adminNotes } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }
    const userRef = db.collection('users').doc(String(userId));
    await userRef.set({ adminNotes: adminNotes ?? '' }, { merge: true });
    res.json({ success: true, data: { userId, adminNotes: adminNotes ?? '' } });
  } catch (error) {
    console.error('❌ admin user-notes:', error);
    res.status(500).json({ success: false, error: 'Failed to save notes', message: error.message });
  }
});

// Admin route: Update a single check-in (dailyLog) — hrv, rhr, sleep, redFlags
app.put('/api/admin/check-in', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const adminEmail = (req.headers['x-admin-email'] || req.body?.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Admin access required' });
    }
    const { userId, logId, patch } = req.body || {};
    if (!userId || !logId || !patch || typeof patch !== 'object') {
      return res.status(400).json({ success: false, error: 'Missing userId, logId, or patch' });
    }
    const logRef = db.collection('users').doc(String(userId)).collection('dailyLogs').doc(String(logId));
    const snap = await logRef.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Check-in not found' });
    }
    const data = snap.data() || {};
    const metrics = { ...(data.metrics || {}) };
    if (patch.hrv !== undefined) metrics.hrv = Number(patch.hrv);
    if (patch.rhr !== undefined) metrics.rhr = typeof patch.rhr === 'object' ? { ...metrics.rhr, current: Number(patch.rhr) } : { current: Number(patch.rhr) };
    if (patch.sleep !== undefined) metrics.sleep = Number(patch.sleep);
    const redFlags = patch.redFlags !== undefined ? patch.redFlags : data.redFlags;
    const update = { metrics, redFlags, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    await logRef.update(update);
    res.json({ success: true, data: { userId, logId } });
  } catch (error) {
    console.error('❌ admin check-in update:', error);
    res.status(500).json({ success: false, error: 'Failed to update check-in', message: error.message });
  }
});

// Admin route: Alerts — missed check-ins (>3 days inactive), critical status (today REST/RECOVER)
app.get('/api/admin/alerts', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || '').trim();
    if (adminEmail !== 'yoramroemersma50@gmail.com') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Admin access required' });
    }
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(startOfDay.getDate() + 1);
    const startTs = admin.firestore.Timestamp.fromDate(startOfDay);
    const endTs = admin.firestore.Timestamp.fromDate(endOfDay);

    const usersSnap = await db.collection('users').get();
    const missed = [];
    const critical = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data() || {};
      const profile = userData.profile || {};
      const fullName = profile.fullName || 'Geen naam';
      const userId = userDoc.id;

      const lastLogSnap = await db.collection('users').doc(userId).collection('dailyLogs').orderBy('timestamp', 'desc').limit(1).get();
      let lastCheckinAt = null;
      if (!lastLogSnap.empty) {
        const ts = lastLogSnap.docs[0].data().timestamp;
        if (ts && typeof ts.toDate === 'function') lastCheckinAt = ts.toDate().toISOString();
      }
      if (!lastCheckinAt || new Date(lastCheckinAt) < threeDaysAgo) {
        missed.push({ userId, fullName, lastCheckinAt });
      }

      const todayLogSnap = await db.collection('users').doc(userId).collection('dailyLogs').where('timestamp', '>=', startTs).where('timestamp', '<', endTs).limit(1).get();
      if (!todayLogSnap.empty) {
        const rec = todayLogSnap.docs[0].data().recommendation || {};
        const status = (rec.status || '').toUpperCase();
        if (status === 'REST' || status === 'RECOVER') {
          critical.push({ userId, fullName, status });
        }
      }
    }

    res.json({ success: true, data: { missed, critical } });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT (admin alerts):', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin alerts',
      message: error.message
    });
  }
});

// Route to fetch last 28 daily logs (most recent first)
app.get('/api/history', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firestore is not initialized'
      });
    }

    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId'
      });
    }

    const snapshot = await db
      .collection('users')
      .doc(String(userId))
      .collection('dailyLogs')
      .orderBy('timestamp', 'desc')
      .limit(28)
      .get();

    const docs = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const ts = data.timestamp;

      // Normalize timestamp for frontend safety
      let timestamp = ts;
      if (ts && typeof ts.toDate === 'function') {
        timestamp = ts.toDate().toISOString();
      } else if (ts instanceof Date) {
        timestamp = ts.toISOString();
      }

      return {
        id: doc.id,
        ...data,
        timestamp
      };
    });

    console.log('Aantal logs opgehaald uit database:', docs.length);
    console.log(`✅ History query succesvol voor userId: ${userId}`);

    res.json({
      success: true,
      data: docs
    });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history',
      message: error.message
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'PrimeForm Fitness App API',
    endpoints: {
      'POST /api/check-luteal-phase': 'Check if user is in Luteal phase',
      'POST /api/daily-advice': 'Get daily training recommendation with full PrimeForm logic',
      'POST /api/save-checkin': 'Save athlete check-in data to Firestore',
      'GET /api/health': 'Health check (Firebase status)'
    }
  });
});

// Start server (after Firebase init attempt)
(async () => {
  await initFirebase();
  knowledgeBaseContent = loadKnowledgeBase();
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
})();

module.exports = app;
