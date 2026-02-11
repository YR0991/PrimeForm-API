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
const reportService = require('./services/reportService');
const { createAdminRouter } = require('./routes/adminRoutes');
const { createCoachRouter } = require('./routes/coachRoutes');
const { createAiRouter } = require('./routes/aiRoutes');
const { createStravaRoutes } = require('./routes/stravaRoutes');
const { createDailyRouter } = require('./routes/dailyRoutes');
const { createDashboardRouter } = require('./routes/dashboardRoutes');

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

// Log origin voor alle admin-requests (debugging)
app.use('/api/admin', (req, res, next) => {
  console.log('API Request ontvangen van origin:', req.headers.origin);
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

    const { onboardingCompleted, onboardingComplete, ...profileOnly } = profilePatch;
    const mergedProfile = { ...existingProfile, ...profileOnly };
    if (existingProfile.cycleData || profileOnly.cycleData) {
      mergedProfile.cycleData = {
        ...(existingProfile.cycleData || {}),
        ...(profileOnly.cycleData || {})
      };
    }
    const profileComplete = isProfileComplete(mergedProfile);
    const forceOnboardingComplete = onboardingCompleted === true || onboardingComplete === true;

    await userDocRef.set(
      {
        profile: mergedProfile,
        profileComplete,
        ...(profileComplete || forceOnboardingComplete ? { onboardingComplete: true } : {}),
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
  const stravaRoutes = createStravaRoutes({ db, admin, stravaService });
  app.use('/api/strava', stravaRoutes.apiRouter);
  app.use('/auth/strava', stravaRoutes.authRouter);
  const dailyRouter = createDailyRouter({ db, admin, openai, knowledgeBaseContent, FieldValue });
  app.use('/api', createDashboardRouter({ db, admin }));
  app.use('/api', dailyRouter);
  app.use('/api/coach', createCoachRouter({ db, admin }));
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
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
})();

module.exports = app;
