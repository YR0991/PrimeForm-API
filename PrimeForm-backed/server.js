require('dotenv').config(); // 1. Eerst geheime sleutels laden

const express = require('express'); // 2. Frameworks inladen
const cors = require('cors');
const admin = require('firebase-admin');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const app = express(); // 3. NU pas bouwen we het 'huis' (de app)
const PORT = process.env.PORT || 3000;

// 4. Nu zetten we de deuren open en zorgen we dat hij JSON snapt
// CORS configuratie:
// - Altijd localhost:9000 toestaan voor lokale SPA dev
// - Productie subdomein: https://app.primeform.nl
// - Elke Vercel-URL toestaan die eindigt op ".vercel.app" (preview URL's)
const explicitAllowedOrigins = [
  'http://localhost:9000',
  'https://app.primeform.nl'
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (zoals mobile apps of curl)
      if (!origin) return callback(null, true);

      if (
        explicitAllowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app')
      ) {
        return callback(null, true);
      }

      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
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
          profileComplete: false
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
        profileComplete: data.profileComplete === true
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

    return res.json({
      success: true,
      data: { userId, profile: mergedProfile, profileComplete }
    });
  } catch (error) {
    console.error('❌ FIRESTORE FOUT:', error);
    return res.status(500).json({ success: false, error: 'Failed to save profile', message: error.message });
  }
});

// Initialize Firebase Admin (with explicit disconnect + forced key load)
let db = null;
async function initFirebase() {
  console.log('🔥 Firebase wordt geïnitialiseerd...');

  try {
    // Fully tear down any existing admin app instances (prevents stale creds)
    if (admin.apps.length) {
      await Promise.all(admin.apps.map((app) => app.delete()));
    }

    // Load credentials from env var OR local ignored file (NO hardcoded keys in codebase)
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
      // Gebruik __dirname zodat het pad altijd relatief is t.o.v. dit bestand,
      // ongeacht vanuit welke map "node server.js" wordt gestart.
      // Verwachting: firebase-key.json staat naast server.js in PrimeForm-backed/.
      const keyPath = path.join(__dirname, 'firebase-key.json');
      serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    }

    console.log('🔐 client_email uit sleutel:', serviceAccount.client_email);
    console.log('Verbinding maken met project:', serviceAccount.project_id);

    // Basic key sanity checks (do not log secrets)
    if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
      throw new Error('Service account JSON mist client_email/private_key/project_id');
    }
    if (typeof serviceAccount.private_key !== 'string' || serviceAccount.private_key.length < 100) {
      throw new Error('Service account JSON private_key lijkt ongeldig (te kort of geen string)');
    }

    const credential = admin.credential.cert(serviceAccount);

    // Prove we can mint an OAuth token with this key (do not print token)
    const tokenInfo = await credential.getAccessToken();
    console.log('🧾 Access token expiry (ms since epoch):', tokenInfo.expires_in ? '(relative expires_in present)' : tokenInfo.expirationTime);

    admin.initializeApp({
      credential,
      // Force projectId explicitly to avoid ambiguity
      projectId: serviceAccount.project_id
    });

    // Initialize Firestore
    // Use explicit Firestore client with explicit credentials to avoid any auth ambiguity
    db = new Firestore({
      projectId: serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key
      }
    });

    // Debug: which project is this credential pointing at?
    console.log('Project ID uit sleutel:', admin.app().options.credential.projectId);
  } catch (error) {
    console.error('❌ FIRESTORE FOUT:', error);
    // Keep server alive, but Firestore-dependent routes will fail gracefully
    db = null;
  }
}

// Middleware to parse JSON bodies
app.use(express.json());

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
 * Generate AI coaching message using OpenAI
 * @param {string} status - Training status (REST/RECOVER/MAINTAIN/PUSH)
 * @param {string} phaseName - Menstrual cycle phase name
 * @param {object} metrics - Metrics object with sleep, rhr, hrv, etc.
 * @param {object} redFlags - Red flags object with count and reasons
 * @returns {Promise<string>} - AI generated coaching message
 */
async function generateAICoachingMessage(status, phaseName, metrics, redFlags, profileContext = null) {
  try {
    const systemPrompt = `Je bent PrimeForm, de elite biohacking coach. Gebruik ONDERSTAANDE kennisbasis strikt voor je advies. Wijk hier niet van af.

--- KNOWLEDGE BASE START ---
${knowledgeBaseContent}
--- KNOWLEDGE BASE END ---

IntakeData (kan leeg zijn):
${profileContext ? JSON.stringify(profileContext).slice(0, 2500) : 'null'}`;
    
    // Calculate HRV change percentage for context
    const hrvRefBaseline = metrics.hrv.adjustedBaseline || metrics.hrv.baseline;
    const hrvChange = ((metrics.hrv.current - hrvRefBaseline) / hrvRefBaseline * 100).toFixed(1);
    const hrvTrend = metrics.hrv.current > hrvRefBaseline ? 'verhoogd' : metrics.hrv.current < hrvRefBaseline ? 'verlaagd' : 'stabiel';
    
    const userPrompt = `Status: ${status}
Cyclusfase: ${phaseName}
Readiness: ${metrics.readiness}/10
Slaap: ${metrics.sleep} uur
RHR: ${metrics.rhr.current} bpm (baseline: ${metrics.rhr.baseline} bpm${metrics.rhr.lutealCorrection ? ', Luteale correctie toegepast' : ''})
HRV: ${metrics.hrv.current} (baseline: ${metrics.hrv.baseline}${metrics.hrv.adjustedBaseline ? `, adjusted: ${Number(metrics.hrv.adjustedBaseline).toFixed(1)}${metrics.hrv.lutealOffsetApplied ? ' (Luteal offset +12%)' : ''}` : ''}, ${hrvTrend} met ${Math.abs(hrvChange)}%)
Red Flags: ${redFlags.count} (${redFlags.reasons.join(', ') || 'geen'})

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
    
    // Generate AI coaching message
    const aiMessage = await generateAICoachingMessage(
      recommendation.status,
      cycleInfo.phaseName,
      metricsForAI,
      { count: redFlags.count, reasons: redFlags.reasons },
      profileContext
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

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'PrimeForm Fitness App API',
    endpoints: {
      'POST /api/check-luteal-phase': 'Check if user is in Luteal phase',
      'POST /api/daily-advice': 'Get daily training recommendation with full PrimeForm logic',
      'POST /api/save-checkin': 'Save athlete check-in data to Firestore',
      'GET /health': 'Health check'
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
