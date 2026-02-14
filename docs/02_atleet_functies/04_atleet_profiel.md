# 04 — Atleet-profiel

## Scope

- `PrimeForm-backed/server.js` (GET/PUT /api/profile, isProfileComplete)
- `PrimeForm-backed/routes/stravaRoutes.js`, stravaWebhookService (athleteId → uid)
- Firestore users doc: profile, strava, email, role, teamId
- Frontend: profielbewerking, Strava-koppeling

---

## Wat de code doet

1. **Bewerkbare velden (profile):** PUT /api/profile accepteert profilePatch. Merge: profile.fullName, email, birthDate, disclaimerAccepted, redFlags, goals, programmingType, cycleData (lastPeriod/lastPeriodDate, avgDuration, contraception). Root-level email wordt gezet uit mergedProfile.email. role, teamId, strava, onboardingComplete kunnen apart in body. isProfileComplete bepaalt profileComplete; zie 01_onboarding_flow.
2. **Strava-koppeling:** Strava-gegevens op user doc: strava { connected, athleteId, accessToken, refreshToken, expiresAt, … }. athleteId gebruikt in webhook om uid te vinden (query users where strava.athleteId == payload.owner_id). Token refresh: stravaService.ensureValidToken. Routes: /api/strava/*, /auth/strava/*; sync-now en disconnect in stravaRoutes.
3. **Waar tokens/athleteId staan:** users/{uid}.strava (accessToken, refreshToken, expiresAt, athleteId). Niet in profile; apart veld strava op user doc. GET /api/profile retourneert data inclusief strava (als aanwezig); PUT kan strava object meegeven (server slaat rootUpdates.strava op).

---

## Bewijs

**1) Profile merge**
```javascript
// PrimeForm-backed/server.js
let mergedProfile = existingData.profile || {};
if (profilePatch && typeof profilePatch === 'object') {
  const { onboardingCompleted, onboardingComplete, ...profileOnly } = profilePatch;
  mergedProfile = { ...mergedProfile, ...profileOnly };
  if (mergedProfile.cycleData || profileOnly.cycleData) {
    mergedProfile.cycleData = { ...(mergedProfile.cycleData || {}), ...(profileOnly.cycleData || {}) };
  }
}
```

**2) Root strava**
```javascript
if (strava !== undefined) rootUpdates.strava = strava;
```

**3) Webhook lookup**
```javascript
// stravaWebhookService: find user by strava.athleteId === payload.owner_id
const userSnap = await db.collection('users').where('strava.athleteId', '==', athleteId).limit(1).get();
```

---

## Data-contracten

| Veld | Geschreven | Gelezen |
|------|------------|---------|
| profile.*, email, profileComplete, onboardingComplete, role, teamId, strava | PUT /api/profile, Strava connect/refresh | GET /api/profile, webhook, coachService |
| strava.athleteId, accessToken, refreshToken, expiresAt | Strava OAuth, sync, webhook meta | stravaService, webhook lookup |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| P2 | lastPeriod vs lastPeriodDate in cycleData: isProfileComplete gebruikt lastPeriod; cycleService gebruikt lastPeriodDate. | Fout als alleen lastPeriodDate wordt opgeslagen. | Backend normaliseert naar lastPeriodDate of isProfileComplete accepteert beide. |
| P1 | Strava tokens op user doc; geen encryptie-at-rest in code. | Firestore security rules moeten leesbeperking afdwingen. | Documenteer; overweeg secrets manager voor tokens. |

---

## Blind Spots

- Welke profielvelden de frontend daadwerkelijk toont/bewerkt: niet per veld geaudit.
- Strava disconnect: welke velden worden gewist (connected false, tokens null?), niet hier geverifieerd.
