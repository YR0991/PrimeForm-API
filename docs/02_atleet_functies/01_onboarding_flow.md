# 01 — Onboarding flow

## Scope

- `PrimeForm-backed/server.js` (PUT /api/profile, isProfileComplete, profileComplete, onboardingComplete)
- `PrimeForm/src/stores/auth.js` (fetchUserProfile, onboardingComplete/profileComplete check)
- `PrimeForm/src/router/index.js` (profileCache, redirect op profileComplete)
- `PrimeForm/docs/INTAKE_STEPPER_ANALYSIS.md` (flow beschrijving)

---

## Wat de code doet

1. **Waar profileComplete gezet wordt:** Bij PUT /api/profile. mergedProfile = bestaand profile + profilePatch. profileComplete = isProfileComplete(mergedProfile). Root updates: profile, profileComplete; als profileComplete of forceOnboardingComplete dan ook onboardingComplete: true. Op user doc: profile, profileComplete, updatedAt, evt. onboardingComplete.
2. **Wat "compleet" betekent (isProfileComplete):** fullName string ≥2 tekens; email string met '@'; birthDate YYYY-MM-DD; disclaimerAccepted === true; redFlags array length 0; goals array length 1–2; programmingType niet-leeg string; **cycleData.lastPeriodDate** YYYY-MM-DD; cycleData.avgDuration getal ≥21; cycleData.contraception niet-leeg string (Route B-opties: Geen | Hormonaal (pil/…) | Spiraal (koper) | Spiraal (hormonaal) | Anders / Onbekend). Backend zet **contraceptionMode** (NATURAL | HBC_OTHER | COPPER_IUD | HBC_LNG_IUD | UNKNOWN) voor engine.
3. **Waar gecheckt:** Auth store: na fetchUserProfile, redirect naar /dashboard als profile.onboardingComplete === true of profile.profileComplete === true. Router (intake flow): GET /api/profile?userId=... → profileCache.profileComplete; als true redirect naar '/'. AtleetDetailDialog: toont (u.onboardingComplete ?? p.onboardingCompleted ?? u.profileComplete).
4. **Intake mail:** Eerste keer profileComplete true → sendNewIntakeEmail(mergedProfile) (fire-and-forget). Geen idempotency.

---

## Bewijs

**1) isProfileComplete**
```javascript
// PrimeForm-backed/server.js
function isProfileComplete(profile) {
  const fullNameOk = typeof profile.fullName === 'string' && profile.fullName.trim().length >= 2;
  const emailOk = typeof profile.email === 'string' && profile.email.includes('@');
  // ... birthDate, disclaimer, redFlags, goals, programmingType, cycleData.lastPeriod, avgDuration, contraception
  return fullNameOk && emailOk && birthDateOk && disclaimerOk && redFlagsOk && goalsOk && programmingTypeOk && cycleLastPeriodOk && cycleAvgOk && contraceptionOk;
}
```

**2) Zetten bij save**
```javascript
// server.js PUT /api/profile
const profileComplete = isProfileComplete(mergedProfile);
const rootUpdates = {
  profile: mergedProfile,
  profileComplete,
  ...(profileComplete || forceOnboardingComplete ? { onboardingComplete: true } : {}),
  ...
};
await userDocRef.set(rootUpdates, { merge: true });
```

**3) Redirect (auth)**
```javascript
// PrimeForm/src/stores/auth.js
if (profileData?.onboardingComplete === true || profileData?.profileComplete === true) {
  // → redirect to dashboard
}
```

---

## Data-contracten

| Veld | Geschreven | Gelezen |
|------|------------|---------|
| profile, profileComplete, onboardingComplete, updatedAt | PUT /api/profile | GET /api/profile, auth store, router, admin |
| profilePatch (body) | Client | server merge |

---

## Audit bevindingen

| Severity | Observatie | Impact | Fix-idee |
|----------|------------|--------|----------|
| — | ~~cycleData.lastPeriod vs lastPeriodDate~~ | — | **Opgelost:** Canonical key lastPeriodDate; isProfileComplete en cycle logic gebruiken lastPeriodDate. |
| P1 | Geen idempotency voor intake mail; dubbele save kan dubbele mail. | Spam-risico. | "intakeMailSentAt" of gelijke guard. |

---

## Blind Spots

- Of onboarding stepper zelf profileComplete in één keer zet of in stappen: niet per stap geaudit; eindresultaat PUT profile.
- Router profileCache invalidation (wanneer opnieuw fetchen): niet getraceerd.
