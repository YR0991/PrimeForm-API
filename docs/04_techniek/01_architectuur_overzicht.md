# 01 — Architectuur overzicht

## Scope

- `PrimeForm/` (Vue app): `quasar.config.js`, `src/`, `src/router/`, `src/stores/`, `src/boot/`
- `PrimeForm-backed/`: `server.js`, routes, services
- Geen Next.js, geen Firebase Functions (alleen Firestore + Express)

---

## Wat de code doet

1. **Frontend:** Vue 3 + Quasar (SPA). Boot: Firebase auth. Router: auth guard, redirects voor Strava/intake. Stores: auth (Firebase + profile API), dashboard (GET /api/dashboard, GET /api/daily-brief), squadron (coach).
2. **Backend:** Express op PORT (default 3000). CORS: whitelist origins (localhost:9000, Vercel, primeform.nl/com). JSON body parser. Firebase Admin: init uit `FIREBASE_SERVICE_ACCOUNT_JSON` of lokaal `firebase-key.json`; `db = admin.firestore()`.
3. **Auth flow:** Frontend: Firebase Auth (Google/email); token in headers. Backend: geen Firebase Auth middleware op meeste routes; uid via `X-User-Uid` header of query/body. Admin: `checkAdminAuth` op `/api/admin` (x-admin-email moet gelijk zijn aan hardcoded ADMIN_EMAIL).
4. **Routes:** Health op /api/health, /health, /healthz. Profile GET/PUT op /api/profile. Dashboard GET /api/dashboard, GET /api/daily-brief. Daily: /api/save-checkin, /api/daily-advice, /api/update-user-stats. Strava: /api/strava/*, /auth/strava/*, /webhooks/strava. Coach: /api/coach/*. Admin: /api/admin/*. Activities: /api/activities. AI: /api/ai/*.
5. **Deployment hints:** PORT env; FIREBASE_SERVICE_ACCOUNT_JSON voor Render; CORS whitelist; FRONTEND_APP_URL, STRAVA_REDIRECT_URI in .env. Geen expliciete deploy scripts in audited files.

---

## Bewijs

**1) Server bootstrap en Firebase**
```javascript
// PrimeForm-backed/server.js
const admin = require('firebase-admin');
// ...
db = admin.firestore();
firebaseProjectId = serviceAccount.project_id;
```

**2) CORS en origins**
```javascript
// PrimeForm-backed/server.js
const allowedOrigins = [
  'http://localhost:9000',
  'https://prime-form-frontend2701.vercel.app',
  'https://app.primeform.nl', ...
];
app.use(cors({ origin: function (origin, callback) { ... }, credentials: true }));
```

**3) Route mounting**
```javascript
// PrimeForm-backed/server.js (async start)
app.use('/api/strava', stravaRoutes.apiRouter);
app.use('/auth/strava', stravaRoutes.authRouter);
app.use('/webhooks/strava', createStravaWebhookRouter({ db, admin }));
app.use('/api', createDashboardRouter({ db, admin }));
app.use('/api/coach', createCoachRouter({ db, admin }));
app.use('/api/admin', createAdminRouter({ ... }));
```

---

## Data-contracten (hoog niveau)

| Bron | Lezen | Schrijven |
|------|--------|-----------|
| Firestore | `users`, `users/{uid}/dailyLogs`, `users/{uid}/activities`, `teams` | idem + serverTimestamp, merge |
| API in | Headers: X-User-Uid, Authorization, x-admin-email. Body: userId, profilePatch, etc. | — |
| API out | JSON: success, data, error | — |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P1 | Geen centrale auth middleware: uid vertrouwd uit header/query. | Vervalsing uid mogelijk als token niet gevalideerd wordt. | Firebase Auth token verifiëren op beschermde routes en uid daaruit halen. |
| P2 | firebase-key.json lokaal fallback: pad in code. | Lokaal nodig; niet in repo. | Documenteer in README; .gitignore controleren. |
| P0 | ADMIN_EMAIL hardcoded in server.js en adminRoutes.js. | Admin gate afhankelijk van één e-mail. | Verplaats naar env (ADMIN_EMAIL) en documenteer. |

---

## Blind Spots

- Waar wordt Firebase Auth token daadwerkelijk geverifieerd (getIdToken vs backend verify)? Niet in geauditeerde server.js-routes gezien.
- Exacte deploy pipeline (Render/Firebase Hosting) niet in deze codebase; alleen CORS/URL hints.
