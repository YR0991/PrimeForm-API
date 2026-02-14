# 02 — Beveiliging & auth

## Scope

- `PrimeForm-backed/server.js` (profile, teams, CORS)
- `PrimeForm-backed/routes/adminRoutes.js` (checkAdminAuth)
- `PrimeForm-backed/routes/dashboardRoutes.js`, `dailyRoutes.js` (uid usage)
- `PrimeForm/src/stores/auth.js`, `src/boot/firebase.js`

---

## Wat de code doet

1. **Admin gate:** Alle routes onder `/api/admin` gaan door `checkAdminAuth`: adminEmail uit `x-admin-email`, `query.adminEmail` of `body.adminEmail`; moet exact gelijk zijn aan `ADMIN_EMAIL` (hardcoded `yoramroemersma50@gmail.com`). Geen token/JWT.
2. **Coach role:** Geen aparte middleware. Profile GET: als email matcht `teams.coachEmail`, wordt op user doc `role: 'coach'`, `teamId` gezet (merge). Coach-routes (/api/coach) ontvangen requests; geen expliciete "isCoach" check in backend in geauditeerde snippet — frontend toont CoachDashboard op basis van authStore.isCoach (profile.role).
3. **Uid voor atleet:** Dashboard, daily-brief, save-checkin, sync-now: uid uit `X-User-Uid` header of query/body. Geen verificatie in code dat token.uid === X-User-Uid.
4. **Frontend auth:** Firebase onAuthStateChanged; profile via API (GET /api/profile?userId=uid); stravaConnected, role uit profile. Token wordt meegestuurd (Authorization Bearer) voor sommige calls.

---

## Bewijs

**1) Admin check**
```javascript
// PrimeForm-backed/routes/adminRoutes.js
const ADMIN_EMAIL = 'yoramroemersma50@gmail.com';
function checkAdminAuth(req, res, next) {
  const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || (req.body && req.body.adminEmail) || '').trim();
  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin access required', code: 'ADMIN_EMAIL_MISMATCH' });
  }
  next();
}
router.use(checkAdminAuth);
```

**2) Coach assignment from email**
```javascript
// PrimeForm-backed/server.js (GET /api/profile)
if ((!data.role || !data.teamId) && email && typeof email === 'string') {
  const teamsSnap = await db.collection('teams').where('coachEmail', '==', raw).limit(1).get();
  if (!teamsSnap.empty) {
    const patch = { role: 'coach', teamId, onboardingComplete: true };
    await userDocRef.set(patch, { merge: true });
  }
}
```

**3) Uid from header**
```javascript
// PrimeForm-backed/routes/dashboardRoutes.js
const uid = (req.headers['x-user-uid'] || req.query.uid || '').toString().trim();
if (!uid) return res.status(400).json({ success: false, error: 'Missing user id. Send X-User-Uid header or uid query.' });
```

---

## Data-contracten

| Item | Bron | Waarde |
|------|------|--------|
| ADMIN_EMAIL | adminRoutes.js, server.js | Hardcoded string |
| Admin auth | Request | x-admin-email / adminEmail (query/body) === ADMIN_EMAIL |
| Coach | Firestore user | role, teamId; teams.coachEmail → match |
| Uid | Request | X-User-Uid of query.uid / body.userId |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P0 | Admin = één hardcoded e-mail; geen token. | Iemand die het e-mailadres kent kan admin endpoints aanroepen. | Admin auth via IdP of signed token; email uit env. |
| P1 | Uid niet gekoppeld aan verified token op dashboard/daily. | Client kan andere uid sturen en data van andere user ophalen. | Verifieer Firebase ID token en gebruik token.uid. |
| P2 | Coach-toegang: backend vertrouwt role/teamId; geen extra check op /api/coach. | Als role gemanipuleerd wordt in DB, coach-routes toegankelijk. | Middleware: token + role uit Firestore of token claims. |

---

## Blind Spots

- Of en waar Firebase `admin.auth().verifyIdToken()` wordt aangeroepen niet in deze bestanden gevonden.
- Coach routes: of er een uid/teamId-scope check is op athlete-specifieke calls (bijv. alleen eigen team) niet volledig geaudit.
