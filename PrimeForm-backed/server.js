require('dotenv').config(); // 1. Eerst geheime sleutels laden

const express = require('express'); // 2. Frameworks inladen
const cors = require('cors');
const admin = require('firebase-admin');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const stravaService = require('./services/stravaService');
const reportService = require('./services/reportService');
const { createAdminRouter } = require('./routes/adminRoutes');
const { createCoachRouter } = require('./routes/coachRoutes');
const { createAiRouter } = require('./routes/aiRoutes');
const { createStravaRoutes } = require('./routes/stravaRoutes');
const { createDailyRouter } = require('./routes/dailyRoutes');
const { createDashboardRouter } = require('./routes/dashboardRoutes');
const { createActivityRouter } = require('./routes/activityRoutes');
const { createStravaWebhookRouter } = require('./routes/stravaWebhookRoutes');
const { runStravaFallbackSync, SIX_HOURS_MS } = require('./services/stravaFallbackJob');
const { verifyIdToken, requireUser } = require('./middleware/auth');
const logger = require('./lib/logger');

// SMTP transporter — Nodemailer. Required env: SMTP_HOST, SMTP_PORT (optional, default 587),
// SMTP_USER, SMTP_PASS. Optional: SMTP_SECURE ('true' for TLS), SMTP_FROM (defaults to SMTP_USER).
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

// Log SMTP config status at startup (no secrets). Use for debugging missing env on Render.
if (process.env.NODE_ENV !== 'test') {
  const smtpStatus = {
    SMTP_HOST: process.env.SMTP_HOST ? 'set' : 'missing',
    SMTP_USER: process.env.SMTP_USER ? 'set' : 'missing',
    SMTP_PASS: process.env.SMTP_PASS ? 'set' : 'missing',
    SMTP_FROM: process.env.SMTP_FROM ? 'set' : 'missing (optional)'
  };
  console.log('SMTP env check:', smtpStatus);
}

function sendNewIntakeEmail(profile, userDocRef, FieldValue) {
  const toAddress = ADMIN_EMAIL;
  const name = profile.fullName || 'Onbekend';
  const email = profile.email || 'Onbekend';
  const goal = Array.isArray(profile.goals) && profile.goals.length > 0
    ? profile.goals.join(', ')
    : 'Geen doel opgegeven';
  const subject = `Nieuwe Intake: ${name}`;
  const text = `Nieuwe Intake: ${name} - ${email} - ${goal}`;

  mailTransporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@primeform.nl',
    to: toAddress,
    subject,
    text
  }).then(async () => {
    logger.info('Admin intake email sent');
    if (userDocRef && FieldValue) {
      await userDocRef.set({ intakeMailSentAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }).catch((err) => {
    logger.error('Intake email failed', err);
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

// 4. CORS: frontend origins (localhost, Vercel, primeform.nl/com); credentials voor cookies/auth
const allowedOrigins = [
  'http://localhost:9000',
  'https://prime-form-frontend2701.vercel.app',
  'https://app.primeform.nl',
  'https://www.primeform.nl',
  'https://app.primeform.com',
  'https://www.primeform.com'
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

app.use('/api/admin', (req, res, next) => {
  logger.info('Admin request', { path: req.path, method: req.method });
  next();
});
app.use(express.json()); // BELANGRIJK: Zonder dit kan hij de data van je sliders niet lezen!

// --- Hieronder komen je routes (api/daily-advice etc.) ---

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Knowledge base: loaded at startup from knowledge/*.md
let knowledgeBaseContent = '';
/** SHA256 hash of KB content (stable ordering) — reproducible kbVersion for daily-brief meta */
let kbVersion = process.env.PRIMEFORM_KB_VERSION || '1.0';

/**
 * Load all .md files from knowledge/ into a single string and compute reproducible kbVersion (SHA256).
 * Called at server startup. Files are read in fixed order: logic, science, lingo, guardrails, examples.
 * @returns {{ content: string, kbVersion: string }}
 */
function loadKnowledgeBase() {
  const knowledgeDir = path.join(__dirname, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) {
    console.warn('⚠️ knowledge/ directory not found; knowledge base will be empty.');
    return { content: '', kbVersion: process.env.PRIMEFORM_KB_VERSION || '1.0' };
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
  const hash = crypto.createHash('sha256').update(combined, 'utf8').digest('hex');
  console.log('📚 Knowledge base loaded:', combined.length, 'characters from', parts.length, 'file(s); kbVersion=', hash);
  return { content: combined, kbVersion: hash };
}

const { isProfileComplete, getProfileCompleteReasons, getEffectiveOnboardingComplete, getRequiredProfileKeyPresence, normalizeCycleData, uiLabelToContraceptionMode } = require('./lib/profileValidation');

/**
 * Read-time migration: if profile.cycleData has lastPeriod but not lastPeriodDate, write lastPeriodDate and remove lastPeriod once.
 * @param {FirebaseFirestore.DocumentReference} userDocRef
 * @param {object} data - Full user doc data (will be mutated with normalized profile for response).
 * @param {object} [FieldValue] - Firestore FieldValue for delete().
 * @returns {Promise<boolean>} true if migration was performed
 */
async function ensureCycleDataCanonical(userDocRef, data, FieldValue) {
  const profile = data?.profile;
  const cd = profile?.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : null;
  if (!cd || cd.lastPeriodDate != null) return false;
  const legacy = cd.lastPeriod;
  if (legacy == null || typeof legacy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(legacy)) return false;
  const updates = {
    'profile.cycleData.lastPeriodDate': legacy,
    'profile.cycleData.lastPeriod': FieldValue.delete()
  };
  await userDocRef.update(updates);
  if (data.profile?.cycleData) {
    data.profile.cycleData = { ...data.profile.cycleData, lastPeriodDate: legacy };
    delete data.profile.cycleData.lastPeriod;
  }
  return true;
}

/**
 * Read-time migration: if profile.cycleData has contraception but not contraceptionMode (in stored doc), derive and persist.
 * @param {FirebaseFirestore.DocumentReference} userDocRef
 * @param {object} data - Full user doc data (will get contraceptionMode set).
 * @param {object} rawData - Raw document data (to check stored state before normalize).
 * @returns {Promise<boolean>} true if migration was performed
 */
async function ensureContraceptionMode(userDocRef, data, rawData) {
  const storedCd = rawData?.profile?.cycleData;
  if (!storedCd || typeof storedCd !== 'object') return false;
  if (storedCd.contraceptionMode != null) return false;
  const mode = uiLabelToContraceptionMode(storedCd.contraception);
  await userDocRef.update({ 'profile.cycleData.contraceptionMode': mode });
  if (data.profile?.cycleData) data.profile.cycleData.contraceptionMode = mode;
  return true;
}

/** Allowed Strava keys in GET /api/profile response (no accessToken/refreshToken). Sync metadata from stravaSync merged in. */
const STRAVA_PROFILE_KEYS = ['connected', 'athleteId', 'athleteName', 'expiresAt', 'connectedAt', 'scope'];
const STRAVA_SYNC_KEYS = ['lastSuccessAt', 'lastAttemptAt', 'lastError', 'newestStoredActivityDate', 'fetched', 'inserted', 'skipped'];

function toIsoOrNull(v) {
  if (v == null) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) return v.slice(0, 19);
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString();
  if (Number.isFinite(Number(v))) return new Date(Number(v)).toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

function sanitizeStravaForProfile(strava, stravaSync) {
  if (!strava || typeof strava !== 'object') return null;
  const out = {};
  for (const key of STRAVA_PROFILE_KEYS) {
    if (!(key in strava)) continue;
    const val = strava[key];
    if (key === 'connectedAt' || key === 'expiresAt') out[key] = toIsoOrNull(val) ?? val;
    else out[key] = val;
  }
  if (stravaSync && typeof stravaSync === 'object') {
    for (const key of STRAVA_SYNC_KEYS) {
      if (!(key in stravaSync)) continue;
      const val = stravaSync[key];
      if (key === 'lastSuccessAt' || key === 'lastAttemptAt') out[key] = toIsoOrNull(val) ?? val;
      else out[key] = val;
    }
  }
  return Object.keys(out).length ? out : (strava.connected === true ? { connected: true } : null);
}

// Profile endpoints — full user document. Auth: token required; uid from req.user.uid (query.userId ignored).
const userAuth = [verifyIdToken(admin), requireUser()];

// GET /api/whoami — debugging: uid, email, claims (requires valid token)
app.get('/api/whoami', userAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      uid: req.user.uid,
      email: req.user.email || null,
      claims: req.user.claims || {}
    }
  });
});

app.get('/api/profile', userAuth, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const userId = req.user.uid;

    const userDocRef = db.collection('users').doc(String(userId));
    const snap = await userDocRef.get();

    if (!snap.exists) {
      logger.info('Profile loaded (not found)', { uidHash: userId ? crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8) : null });
      return res.json({
        success: true,
        data: {
          userId,
          profile: null,
          profileComplete: false,
          role: null,
          teamId: null,
          onboardingComplete: false,
          onboardingLockedAt: null,
          strava: null,
          email: null
        }
      });
    }

    let data = snap.data() || {};
    const email = data.email || (data.profile && data.profile.email) || null;

    // Resolve coach assignment: if no role/teamId but email matches a team's coachEmail, persist and return
    if ((!data.role || !data.teamId) && email && typeof email === 'string') {
      const raw = email.trim().toLowerCase();
      const teamsSnap = await db.collection('teams').where('coachEmail', '==', raw).limit(1).get();
      if (!teamsSnap.empty) {
        const teamDoc = teamsSnap.docs[0];
        const teamId = teamDoc.id;
        const patch = { role: 'coach', teamId, onboardingComplete: true };
        await userDocRef.set(patch, { merge: true });
        data = { ...data, ...patch };
      }
    }

    const migrated = await ensureCycleDataCanonical(userDocRef, data, FieldValue);
    if (migrated) logger.info('Profile cycleData migrated to lastPeriodDate');
    const migratedMode = await ensureContraceptionMode(userDocRef, data, data);
    if (migratedMode) logger.info('Profile cycleData.contraceptionMode set');
    if (data.profile?.cycleData) data.profile.cycleData = normalizeCycleData(data.profile.cycleData);

    // Legacy auto-lock: users with Strava/loads/legacy onboardingComplete but no onboardingLockedAt get locked on first GET so they never hit /intake again.
    const hasLock = !!data.onboardingLockedAt;
    const legacySignal =
      data?.strava?.connected === true ||
      !!data.lastStravaSyncedAt ||
      !!data.metricsMeta?.loadMetricsComputedAt ||
      data.onboardingComplete === true;
    if (!hasLock && legacySignal) {
      await userDocRef.update({ onboardingLockedAt: FieldValue.serverTimestamp() });
      data.onboardingLockedAt = new Date();
      const uidHash = userId ? crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8) : null;
      logger.info('ONBOARDING_AUTO_LOCK', { uidHash, reason: 'legacySignal' });
    }

    // Single source of truth: canonical completeness. Merge root email into profile for check (legacy users may have email only at root).
    const profileMerged = { ...(data.profile || {}), email: (data.profile && data.profile.email) || data.email || email || null };
    const { complete, reasons: completeReasons } = getProfileCompleteReasons(profileMerged);
    const isOnboardingLocked = data.onboardingLockedAt != null;
    // Never downgrade: once onboardingLockedAt is set, onboardingComplete is always true. profileComplete stays computed for engine/quality.
    const onboardingComplete = getEffectiveOnboardingComplete(complete, isOnboardingLocked);
    const profileComplete = complete;

    const hasStored = data.onboardingComplete !== undefined || data.profileComplete !== undefined;
    const storedOnboardingOk = data.onboardingComplete === onboardingComplete;
    const storedProfileOk = data.profileComplete === profileComplete;
    if (!hasStored || !storedOnboardingOk || !storedProfileOk) {
      // Migration: may set profileComplete from computed; must not flip onboardingComplete to false once locked.
      await userDocRef.set({ onboardingComplete, profileComplete }, { merge: true });
      logger.info('Profile completeness migration applied', {
        uidHash: userId ? crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8) : null,
        profileComplete,
        onboardingComplete,
        hadStored: hasStored,
        storedOnboardingOk,
        storedProfileOk
      });
    }

    const isAdmin = req.user && req.user.claims && req.user.claims.admin === true;
    const debugProfile = typeof req.query.debug === 'string' && req.query.debug.toLowerCase() === 'profile';

    // Retroactive Strava avatar backfill: sync if connected, avatar missing, and (never synced or >24h ago)
    if (stravaService && data.strava?.connected === true && !(data.profile?.avatar || data.profile?.avatarUrl)) {
      const syncedAt = data.stravaProfileSyncedAt;
      let shouldSync = true;
      if (syncedAt != null) {
        const ms = typeof syncedAt.toMillis === 'function' ? syncedAt.toMillis() : (Number(syncedAt) || 0);
        if (Number.isFinite(ms) && Date.now() - ms < 24 * 60 * 60 * 1000) shouldSync = false;
      }
      if (shouldSync) {
        stravaService.syncStravaAthleteProfile(userId, db, admin)
          .catch((e) => logger.warn('Profile avatar sync failed', { message: e.message }));
      }
    }

    logger.info('Profile loaded', {
      uidHash: userId ? crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8) : null,
      profileComplete,
      onboardingComplete,
      onboardingLocked: isOnboardingLocked,
      migrationApplied: !hasStored || !storedOnboardingOk || !storedProfileOk
    });

    const toIsoTimestamp = (v) => {
      if (v == null) return null;
      if (typeof v.toDate === 'function') return v.toDate().toISOString();
      if (typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString();
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'string') return v;
      return null;
    };

    const responseData = {
      userId,
      profile: data.profile || null,
      profileComplete,
      role: data.role || null,
      teamId: data.teamId || null,
      onboardingComplete,
      onboardingLockedAt: toIsoTimestamp(data.onboardingLockedAt),
      strava: sanitizeStravaForProfile(data.strava, data.stravaSync),
      email: data.email || email || null
    };
    // profileCompleteReasons only when ?debug=profile or admin claim; PII-free reason codes only (from getProfileCompleteReasons).
    if (isAdmin || debugProfile) {
      responseData.profileCompleteReasons = completeReasons.length ? completeReasons : ['complete'];
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    logger.error('Profile load failed', error);
    return res.status(500).json({ success: false, error: 'Failed to load profile', message: error.message });
  }
});

// PUT /api/profile — Intake submit flow: Frontend (IntakeStepper saveProfile) -> POST body.profilePatch -> merge into users/{uid}.profile -> Firestore set(..., { merge: true }). All required intake fields live under users/{uid}.profile only.
app.put('/api/profile', userAuth, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const userId = req.user.uid;
    const { profilePatch, role, teamId, onboardingComplete: bodyOnboardingComplete, strava } = req.body || {};

    const userDocRef = db.collection('users').doc(String(userId));
    const existing = await userDocRef.get();
    const existingData = existing.exists ? existing.data() : {};

    let mergedProfile = existingData.profile || {};
    if (profilePatch && typeof profilePatch === 'object') {
      const { onboardingCompleted, onboardingComplete, ...profileOnly } = profilePatch;
      mergedProfile = { ...mergedProfile, ...profileOnly };
      if (mergedProfile.cycleData || profileOnly.cycleData) {
        mergedProfile.cycleData = normalizeCycleData({
          ...(mergedProfile.cycleData || {}),
          ...(profileOnly.cycleData || {})
        });
      }
    }

    const profileComplete = isProfileComplete(mergedProfile);
    const forceOnboardingComplete =
      (profilePatch && (profilePatch.onboardingCompleted === true || profilePatch.onboardingComplete === true)) ||
      bodyOnboardingComplete === true;
    const isLocked = existingData.onboardingLockedAt != null;
    // Never downgrade: if onboarding is locked, always keep onboardingComplete true (ignore body false).
    const setOnboardingTrue = (profileComplete || forceOnboardingComplete || isLocked);
    const setOnboardingLockedAt = setOnboardingTrue && !isLocked; // set timestamp when completing for the first time

    // All intake/profile fields go into users/{uid}.profile (nested), not root. Root only: profile, profileComplete, onboardingComplete, onboardingLockedAt, email, role, teamId, strava, timestamps.
    const rootUpdates = {
      profile: mergedProfile,
      profileComplete,
      ...(setOnboardingTrue ? { onboardingComplete: true } : {}),
      ...(setOnboardingLockedAt ? { onboardingLockedAt: FieldValue.serverTimestamp() } : {}),
      createdAt: existing.exists ? (existingData.createdAt || new Date()) : new Date(),
      updatedAt: new Date()
    };
    if (typeof mergedProfile.email === 'string' && mergedProfile.email.trim().length > 0) {
      rootUpdates.email = mergedProfile.email.trim();
    }
    if (role !== undefined) rootUpdates.role = role;
    if (teamId !== undefined) rootUpdates.teamId = teamId;
    if (bodyOnboardingComplete === false && !isLocked) rootUpdates.onboardingComplete = false;
    if (strava !== undefined) rootUpdates.strava = strava;

    const emailForCoach = rootUpdates.email || mergedProfile.email || existingData.email;
    if ((rootUpdates.role === undefined || rootUpdates.teamId === undefined) && emailForCoach && typeof emailForCoach === 'string') {
      const teamsSnap = await db.collection('teams').where('coachEmail', '==', emailForCoach.trim().toLowerCase()).limit(1).get();
      if (!teamsSnap.empty) {
        rootUpdates.role = rootUpdates.role ?? 'coach';
        rootUpdates.teamId = rootUpdates.teamId ?? teamsSnap.docs[0].id;
        if (!existingData.onboardingComplete) rootUpdates.onboardingComplete = true;
      }
    }

    await userDocRef.set(rootUpdates, { merge: true });

    const keyPresence = getRequiredProfileKeyPresence(mergedProfile);
    logger.info('Profile saved', {
      profileComplete,
      intakeRequiredKeysPresent: keyPresence.present,
      intakeRequiredKeysTotal: keyPresence.total,
      ...(keyPresence.missing.length ? { intakeMissingKeys: keyPresence.missing } : {})
    });

    const intakeMailSentAt = existing.exists && existing.data()?.intakeMailSentAt;
    if (profileComplete && !intakeMailSentAt) {
      sendNewIntakeEmail(mergedProfile, userDocRef, FieldValue);
    }

    const responseOnboardingComplete = isLocked || rootUpdates.onboardingComplete === true;
    const responseOnboardingLockedAt = existingData.onboardingLockedAt ?? rootUpdates.onboardingLockedAt;
    const toIsoPut = (v) => {
      if (v == null) return null;
      if (typeof v.toDate === 'function') return v.toDate().toISOString();
      if (typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString();
      return null;
    };

    return res.json({
      success: true,
      data: {
        userId,
        profile: mergedProfile,
        profileComplete,
        role: rootUpdates.role ?? existingData.role ?? null,
        teamId: rootUpdates.teamId ?? existingData.teamId ?? null,
        onboardingComplete: responseOnboardingComplete,
        onboardingLockedAt: toIsoPut(responseOnboardingLockedAt),
        strava: rootUpdates.strava ?? existingData.strava ?? null
      }
    });
  } catch (error) {
    logger.error('Profile save failed', error);
    return res.status(500).json({ success: false, error: 'Failed to save profile', message: error.message });
  }
});

// POST /api/activities — manual workout; backend is single source of truth for Prime Load (Duration × RPE, rounded). Auth: uid from token (body.userId ignored).
app.post('/api/activities', userAuth, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const userId = req.user.uid;
    const { type, duration, rpe, date, includeInAcwr } = req.body || {};
    const durationMinutes = Number(duration);
    const rpeValue = Number(rpe);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid duration' });
    }
    if (!Number.isFinite(rpeValue) || rpeValue < 1 || rpeValue > 10) {
      return res.status(400).json({ success: false, error: 'Invalid RPE (1–10)' });
    }
    const primeLoad = Math.round(durationMinutes * rpeValue);
    const dateIso =
      date && typeof date === 'string'
        ? (date.length >= 10 ? date.slice(0, 10) : date)
        : new Date().toISOString().slice(0, 10);
    const startDateTs = new Date(dateIso + 'T00:00:00Z').getTime();
    const payload = {
      userId,
      source: 'manual',
      type: (type && String(type).trim()) || 'Manual Session',
      duration_minutes: durationMinutes,
      rpe: rpeValue,
      prime_load: primeLoad,
      date: dateIso,
      startDateTs,
      dayKey: dateIso,
      includeInAcwr: includeInAcwr === false ? false : true,
      created_at: new Date(),
    };
    const docRef = await db.collection('activities').add(payload);
    logger.info('Activity created', { primeLoad, durationMinutes, rpeValue });
    return res.json({ success: true, data: { id: docRef.id, ...payload } });
  } catch (err) {
    logger.error('POST /api/activities error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Teams: verify invite code (for auth store — no Firestore in frontend)
app.get('/api/teams/verify-invite', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: 'Firestore is not initialized' });
    }
    const { code } = req.query;
    const raw = (code || '').trim();
    if (!raw) {
      return res.status(400).json({ success: false, error: 'Missing code' });
    }
    const snap = await db.collection('teams').where('inviteCode', '==', raw).limit(1).get();
    if (snap.empty) {
      return res.status(404).json({ success: false, error: 'Teamcode niet gevonden' });
    }
    const teamDoc = snap.docs[0];
    const data = teamDoc.data() || {};
    return res.json({
      success: true,
      data: { id: teamDoc.id, ...data }
    });
  } catch (error) {
    logger.error('Teams verify-invite failed', error);
    return res.status(500).json({ success: false, error: error.message });
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

// Route to fetch last 28 daily logs (most recent first). Auth: uid from token (query.userId ignored).
app.get('/api/history', userAuth, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Firestore is not initialized'
      });
    }
    const userId = req.user.uid;

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

    logger.info('History query success', { count: docs.length });

    res.json({
      success: true,
      data: docs
    });
  } catch (error) {
    logger.error('History fetch failed', error);
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
  const kb = loadKnowledgeBase();
  knowledgeBaseContent = kb.content;
  kbVersion = kb.kbVersion;
  const stravaRoutes = createStravaRoutes({ db, admin, stravaService });
  app.use('/api/strava', stravaRoutes.apiRouter);
  app.use('/auth/strava', stravaRoutes.authRouter);
  app.use('/webhooks/strava', createStravaWebhookRouter({ db, admin }));
  const dailyRouter = createDailyRouter({ db, admin, openai, knowledgeBaseContent, FieldValue });
  app.use('/api', createDashboardRouter({ db, admin, kbVersion, stravaService }));
  app.use('/api', dailyRouter);
  app.use('/api/coach', createCoachRouter({ db, admin }));
  app.use('/api/activities', createActivityRouter({ db, admin }));
  app.use('/api/ai', createAiRouter({ db, admin, openai }));
  app.use('/api/admin', createAdminRouter({
    db,
    admin,
    openai,
    knowledgeBaseContent,
    reportService,
    stravaService,
    FieldValue
  }));
  if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      // Strava fallback: sync users with stale webhook every 6h
      if (db) {
        setInterval(() => runStravaFallbackSync(db, admin).catch((e) => console.error('Strava fallback:', e)), SIX_HOURS_MS);
        setTimeout(() => runStravaFallbackSync(db, admin).catch((e) => console.error('Strava fallback (initial):', e)), 60000);
      }
    });
  }
})();

module.exports = app;
