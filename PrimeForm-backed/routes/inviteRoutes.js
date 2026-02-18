const express = require('express');
const crypto = require('crypto');
const { verifyIdToken, requireUser } = require('../middleware/auth');
const logger = require('../lib/logger');

/**
 * Best-effort millis converter for Firestore Timestamp | Date | number | string.
 */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }
  return null;
}

/**
 * Classify invite state based on isActive, expiresAt, uses/maxUses.
 * @param {object} invite
 * @returns {{ status: 'ok' | 'expired' | 'inactive' }}
 */
function classifyInvite(invite) {
  const nowMs = Date.now();
  const expiresMs = toMillis(invite.expiresAt);
  if (expiresMs != null && expiresMs <= nowMs) {
    return { status: 'expired' };
  }

  const isActive = invite.isActive !== false; // default to true if missing
  const uses = Number(invite.uses) || 0;
  const maxUses = invite.maxUses != null && Number.isFinite(Number(invite.maxUses))
    ? Number(invite.maxUses)
    : null;
  const limitReached = maxUses != null && uses >= maxUses;

  if (!isActive || limitReached) {
    return { status: 'inactive' };
  }

  return { status: 'ok' };
}

async function findInviteByCode(db, code) {
  const trimmed = (code || '').trim();
  if (!trimmed) {
    const err = new Error('Missing code');
    err.status = 400;
    err.code = 'MISSING_CODE';
    throw err;
  }

  // MVP: plain-text code match in teams/{teamId}/invites subcollections.
  const snap = await db.collectionGroup('invites').where('code', '==', trimmed).limit(1).get();
  if (snap.empty) {
    const err = new Error('Invalid invite code');
    err.status = 404;
    err.code = 'INVITE_NOT_FOUND';
    throw err;
  }

  const inviteDoc = snap.docs[0];
  const invite = inviteDoc.data() || {};

  const teamRef = inviteDoc.ref.parent.parent;
  if (!teamRef) {
    const err = new Error('Invite is missing parent team');
    err.status = 500;
    err.code = 'INVITE_TEAM_MISSING';
    throw err;
  }

  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) {
    const err = new Error('Team for invite not found');
    err.status = 404;
    err.code = 'TEAM_NOT_FOUND';
    throw err;
  }

  const team = teamSnap.data() || {};
  const teamId = teamRef.id;
  const teamName = team.name || team.teamName || null;

  const classification = classifyInvite(invite);
  if (classification.status === 'expired') {
    const err = new Error('Invite code is expired');
    err.status = 410;
    err.code = 'INVITE_EXPIRED';
    throw err;
  }
  if (classification.status === 'inactive') {
    const err = new Error('Invite code is inactive');
    err.status = 409;
    err.code = 'INVITE_INACTIVE';
    throw err;
  }

  return { inviteDoc, invite, teamId, teamName };
}

/**
 * @param {object} deps - { db, admin }
 * @returns {express.Router}
 */
function createInviteRouter(deps) {
  const { db, admin } = deps;
  const router = express.Router();

  const userAuth = [verifyIdToken(admin), requireUser()];

  // POST /api/invites/resolve
  // Body: { code }
  // Response: { teamId, teamName }
  router.post('/resolve', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ code: 'FIRESTORE_NOT_READY', message: 'Firestore is not initialized' });
      }
      const { code } = req.body || {};
      const result = await findInviteByCode(db, code);
      return res.json({ teamId: result.teamId, teamName: result.teamName });
    } catch (err) {
      const status = err.status || 500;
      const code = err.code || 'INVITE_RESOLVE_FAILED';
      if (status >= 500) {
        logger.error('POST /api/invites/resolve error', { message: err.message, code, stack: err.stack });
      }
      return res.status(status).json({ code, message: err.message || 'Failed to resolve invite' });
    }
  });

  // POST /api/invites/claim
  // Auth required
  // Body: { code }
  // Response: { teamId }
  router.post('/claim', userAuth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ code: 'FIRESTORE_NOT_READY', message: 'Firestore is not initialized' });
      }
      const uid = req.user && req.user.uid;
      if (!uid) {
        return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      }

      const { code } = req.body || {};
      if (!code || !String(code).trim()) {
        return res.status(400).json({ code: 'MISSING_CODE', message: 'Invite code is required' });
      }

      // First resolve the invite (validation + team metadata).
      const { inviteDoc, teamId } = await findInviteByCode(db, code);
      const inviteRef = inviteDoc.ref;
      const teamRef = inviteRef.parent.parent;
      const userRef = db.collection('users').doc(String(uid));

      await db.runTransaction(async (tx) => {
        const [inviteSnap, userSnap] = await Promise.all([
          tx.get(inviteRef),
          tx.get(userRef)
        ]);

        if (!inviteSnap.exists) {
          const txErr = new Error('Invalid invite code');
          txErr.status = 404;
          txErr.code = 'INVITE_NOT_FOUND';
          throw txErr;
        }

        const invite = inviteSnap.data() || {};
        const inviteState = classifyInvite(invite);
        if (inviteState.status === 'expired') {
          const txErr = new Error('Invite code is expired');
          txErr.status = 410;
          txErr.code = 'INVITE_EXPIRED';
          throw txErr;
        }
        if (inviteState.status === 'inactive') {
          const txErr = new Error('Invite code is inactive');
          txErr.status = 409;
          txErr.code = 'INVITE_INACTIVE';
          throw txErr;
        }

        const userData = userSnap.exists ? userSnap.data() || {} : {};
        const existingTeamId = userData.teamId || null;
        if (existingTeamId && existingTeamId !== teamId) {
          const txErr = new Error('User already belongs to a different team');
          txErr.status = 409;
          txErr.code = 'TEAM_ALREADY_SET';
          throw txErr;
        }

        const now = new Date();
        const userUpdate = {
          teamId,
          updatedAt: now
        };
        if (!userSnap.exists || !userData.createdAt) {
          userUpdate.createdAt = userData.createdAt || now;
        }
        tx.set(userRef, userUpdate, { merge: true });

        if (!teamRef) {
          const txErr = new Error('Team for invite not found');
          txErr.status = 404;
          txErr.code = 'TEAM_NOT_FOUND';
          throw txErr;
        }

        const memberRef = teamRef.collection('members').doc(String(uid));
        const memberSnap = await tx.get(memberRef);
        const memberData = memberSnap.exists ? memberSnap.data() || {} : {};
        const memberUpdate = {
          role: memberData.role || 'athlete'
        };
        if (!memberSnap.exists || !memberData.joinedAt) {
          memberUpdate.joinedAt = now;
        }
        tx.set(memberRef, memberUpdate, { merge: true });

        const uses = Number(invite.uses) || 0;
        tx.update(inviteRef, { uses: uses + 1 });
      });

      return res.json({ teamId });
    } catch (err) {
      const status = err.status || 500;
      const code = err.code || 'INVITE_CLAIM_FAILED';
      if (status >= 500) {
        const uidHash = uid ? crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 8) : null;
        logger.error('POST /api/invites/claim error', {
          message: err.message,
          code,
          stack: err.stack,
          uidHash
        });
      }
      return res.status(status).json({ code, message: err.message || 'Failed to claim invite' });
    }
  });

  return router;
}

module.exports = { createInviteRouter };

