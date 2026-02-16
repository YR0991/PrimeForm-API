/**
 * Firebase Admin ID token verification and requireUser helper.
 * Use verifyIdToken(admin) then requireUser() on routes that must be authenticated.
 */

/**
 * Verifies Authorization: Bearer <idToken> and sets req.user = { uid, email, claims }.
 * Returns 401 if header missing or token invalid.
 * @param {object} admin - Firebase Admin SDK (must be initialized)
 * @returns {function(req, res, next)}
 */
function verifyIdToken(admin) {
  return async (req, res, next) => {
    const authHeader = (req.headers.authorization || req.headers.Authorization || '').trim();
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header. Use: Authorization: Bearer <idToken>'
      });
    }
    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Empty Bearer token'
      });
    }
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email || null,
        claims: decodedToken
      };
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: err.code === 'auth/id-token-expired' ? 'Token expired' : 'Invalid ID token'
      });
    }
  };
}

/**
 * Requires req.user to be set (by verifyIdToken). Returns 401 if not.
 * @returns {function(req, res, next)}
 */
function requireUser() {
  return (req, res, next) => {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }
    next();
  };
}

/**
 * Requires a Firebase custom claim (e.g. admin, coach) on req.user.claims.
 * Use after verifyIdToken + requireUser. Break-glass: if BREAKGLASS_ENABLED==="true"
 * and req.user.email === BREAKGLASS_ADMIN_EMAIL, allows and logs BREAKGLASS_USED.
 * @param {string} role - Claim key to require (e.g. 'admin', 'coach')
 * @returns {function(req, res, next)}
 */
function requireRole(role) {
  const breakglassEnabled = process.env.BREAKGLASS_ENABLED === 'true';
  const breakglassEmail = (process.env.BREAKGLASS_ADMIN_EMAIL || '').trim().toLowerCase();

  return (req, res, next) => {
    const email = (req.user?.email || '').toString().trim().toLowerCase();
    const hasClaim = req.user?.claims && req.user.claims[role] === true;

    if (hasClaim) {
      return next();
    }
    if (breakglassEnabled && breakglassEmail && email === breakglassEmail) {
      console.warn('BREAKGLASS_USED', { role, email });
      return next();
    }
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN_ROLE',
      error: 'Forbidden',
      message: `Role '${role}' required`
    });
  };
}

/**
 * Requires at least one of the given roles on req.user.claims.
 * Use after verifyIdToken + requireUser. Returns 403 with code FORBIDDEN_ROLE if none match.
 * Break-glass applies only when 'admin' is in allowedRoles and BREAKGLASS_* env is set.
 * Coach accounts must have setCustomUserClaims(uid, { coach: true }) and user doc teamId (or claims.teamId).
 * @param {string[]} roles - e.g. ['admin', 'coach']
 * @returns {function(req, res, next)}
 */
function requireAnyRole(roles) {
  const allowed = new Set(Array.isArray(roles) ? roles : [roles]);
  const breakglassEnabled = process.env.BREAKGLASS_ENABLED === 'true';
  const breakglassEmail = (process.env.BREAKGLASS_ADMIN_EMAIL || '').trim().toLowerCase();

  return (req, res, next) => {
    const email = (req.user?.email || '').toString().trim().toLowerCase();
    const claims = req.user?.claims || {};
    const hasAny = [...allowed].some((role) => claims[role] === true);
    if (hasAny) return next();
    if (allowed.has('admin') && breakglassEnabled && breakglassEmail && email === breakglassEmail) {
      console.warn('BREAKGLASS_USED', { roles: [...allowed], email });
      return next();
    }
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN_ROLE',
      error: 'Forbidden',
      message: `One of roles [${[...allowed].join(', ')}] required`
    });
  };
}

/**
 * For routes with :uid: allow admin; for coach, allow only if target user's teamId matches coach's teamId.
 * Use after requireAnyRole(['admin','coach']). Expects req.params.uid.
 * @param {object} db - Firestore
 * @returns {function(req, res, next)}
 */
function requireCoachTeamMatch(db) {
  return async (req, res, next) => {
    const claims = req.user?.claims || {};
    if (claims.admin === true) return next();
    const targetUid = req.params.uid;
    if (!targetUid) return next();
    let coachTeamId = claims.teamId || null;
    if (coachTeamId == null && req.user?.uid) {
      try {
        const coachSnap = await db.collection('users').doc(String(req.user.uid)).get();
        if (coachSnap.exists) coachTeamId = (coachSnap.data() || {}).teamId ?? null;
      } catch {
        coachTeamId = null;
      }
    }
    const targetSnap = await db.collection('users').doc(String(targetUid)).get();
    if (!targetSnap.exists) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const targetTeamId = (targetSnap.data() || {}).teamId ?? null;
    if (coachTeamId == null || targetTeamId == null || coachTeamId !== targetTeamId) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_TEAM',
        error: 'Forbidden',
        message: 'Target user is not in your team'
      });
    }
    next();
  };
}

module.exports = { verifyIdToken, requireUser, requireRole, requireAnyRole, requireCoachTeamMatch };
