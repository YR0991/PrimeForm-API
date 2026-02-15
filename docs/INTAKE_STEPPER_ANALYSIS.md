# IntakeStepper — Architectural Analysis (Backend-First)

## 1. Navigation Logic

### How users reach IntakeStepper
- **Login flow:** After login, user can be sent to `/intake` (e.g. from `LoginPage.vue` when not yet onboarded).
- **Router guards** (`src/router/index.js`):
  - **`/dashboard`:** If `authStore.isOnboardingComplete === false` → redirect to `/intake`.
  - **`/intake`:** 
    - Coaches/admins/impersonating → redirect to `/dashboard`.
    - If authenticated: `authStore.fetchUserProfile(uid)` is called (reads **Firestore directly**). If `profile.onboardingComplete === true` or `profile.profileComplete === true` → redirect to `/dashboard`.
    - If not authenticated: uses `getUserIdForProfileCheck()` (localStorage or generated ID) and fetches **via API** `GET /api/profile?userId=...`; if `profileComplete === true` → redirect to `/`.

### Consistency with Pinia (auth store)
- **Auth store** (`src/stores/auth.js`): `onboardingComplete` is set from:
  - `_setUserFromProfile()` when profile is loaded (from `profileData.onboardingComplete` or `profileData.profileComplete`).
  - `fetchUserProfile()` (Firestore `getDoc`) updates state and returns doc data.
- **Mismatch:** For `/intake` guard, when authenticated the router calls `fetchUserProfile(uid)` which reads **Firestore**, not the API. So the guard’s “is onboarding complete?” check is consistent with Firestore. But the auth store’s **initial** load in `init()` also uses `fetchUserProfile()` (Firestore). So both router and store rely on **Firestore as source of truth** for onboarding status, not the API.
- **App.vue:** Only waits for `authStore.isAuthReady`; no intake-specific logic.

**Conclusion:** Navigation is consistent with the auth store, but the **source of truth is Firestore** (via `fetchUserProfile`), not the Backend API. The only place that uses the API for “profile complete?” is the unauthenticated branch (`GET /api/profile`).

---

## 2. Data Flow Conflict (API vs Firestore)

### Current IntakeStepper save flow (`IntakeStepper.vue`)

1. **`api.put('/api/profile', { userId, profilePatch })`** — Backend writes to Firestore:
   - `server.js` `PUT /api/profile` merges `profilePatch` into `users/{userId}`.
   - Sets `profile`, `profileComplete`, `onboardingComplete: true` (when `onboardingCompleted === true` or profile complete), `updatedAt`.

2. **`setDoc(userRef, { onboardingComplete: true }, { merge: true })`** — **Direct Firestore write** from the client.
   - This is **redundant**: the API already set `onboardingComplete: true` when `profilePatch.onboardingCompleted === true`.

3. **`authStore.onboardingComplete = true`** — Local state update.

4. **`router.replace('/dashboard')`** — Navigate away.

So the Stepper is **hybrid**: it correctly uses the API for the main profile payload, but then does an extra Firestore write. That breaks strict Backend-First (all writes go through the API).

**Recommendation:** Remove the `setDoc` call after a successful `PUT /api/profile`. The API is the single writer; trust it and only update local state.

---

## 3. State Sync (Stale State Risk)

### When the Stepper succeeds
- **API** has already updated Firestore (`profile`, `onboardingComplete`, etc.).
- **Auth store:** `authStore.onboardingComplete = true` is set in the same tick, so the next navigation (e.g. dashboard) sees onboarding as complete.
- **No refetch:** The auth store does **not** call `fetchUserProfile()` again after save. So other profile fields in the store (e.g. `authStore.profile`, `authStore.teamId`) are **not** refreshed from the server.

### When could state be stale?
- If the user **refreshes** the page right after save: `init()` runs, `onAuthStateChanged` fires, `fetchUserProfile(uid)` runs and reads the **updated** Firestore doc. So after refresh, state is correct.
- If the user **does not refresh** and navigates only via the app: the only updated bit is `onboardingComplete`. So:
  - **Risk:** Other parts of the app that depend on `authStore.profile` (e.g. fullName, cycleData) might still see old values until the next full profile load (e.g. next login or a manual refetch).
- **Mitigation:** After a successful `PUT /api/profile`, either:
  - Call `authStore.fetchUserProfile(uid)` to refresh the whole profile from Firestore, or
  - Have the API return the updated profile in the response and pass it into the store (e.g. a dedicated `setProfileFromIntake(data)` that updates `profile`, `onboardingComplete`, etc.).

**Conclusion:** There is a small risk of stale auth/profile state until next reload or refetch. Removing the redundant `setDoc` does not change this; fixing it is about **refreshing auth state from API or Firestore after save**.

---

## 4. Schema Mismatch (Intake payload vs getSquadronData)

### What IntakeStepper sends (`profilePatch`)

- `fullName`, `email`, `birthDate`, `disclaimerAccepted`, `redFlags`
- `goals`, `painPoint`, `successScenario`, `injuries`
- `trainingFrequency`, `sessionDuration`, `programmingType`, `stravaLink`, `wearables`
- `sleepAvg`, `stress`, `recoveryHabits`
- `symptoms`, `checkinTime`, `hrvBaseline`, `rhrBaseline`
- `cycleData`: `{ lastPeriodDate, avgDuration, contraception }` — **Route B** contraception options: Geen | Hormonaal (pil/pleister/ring/implantaat/injectie) | Spiraal (koper) | Spiraal (hormonaal) | Anders / Onbekend. Backend derives `contraceptionMode` (NATURAL | HBC_OTHER | COPPER_IUD | HBC_LNG_IUD | UNKNOWN) for engine gating.
- `onboardingCompleted: true`

### What the backend stores

- `PUT /api/profile` merges all of the above (except `onboardingCompleted`/`onboardingComplete`) into `users/{uid}.profile`. So the Firestore doc has:
  - `profile.fullName`, `profile.email`, `profile.cycleData.lastPeriod`, `profile.cycleData.avgDuration`, etc.
  - Root-level: `onboardingComplete`, `profileComplete`, `updatedAt`.

### What getSquadronData expects (`backend/services/coachService.js`)

- `userData.profile` (e.g. `profile.fullName`, `profile.displayName`, `profile.photoURL`, `profile.cycleData.lastPeriod` / `lastPeriodDate`, `profile.cycleData.avgDuration`).
- `userData.email` — can come from **root** of the user doc. The API does **not** set a root-level `email`; it only sets `profile`. So for a user who **only** did intake (no other flow that sets root `email`), `userData.email` may be missing unless:
  - Firebase Auth custom claims / sync write it, or
  - The initial bootstrap on first login wrote it (auth store creates a bootstrap doc with `email`, `displayName`, etc.).

So:
- **Name:** `profile.fullName` is set by intake → getSquadronData uses `profile.fullName || profile.displayName` → **OK**.
- **Email:** If the user doc has no root-level `email`, getSquadronData falls back to nothing and the coach might see no email. The intake stores `email` only inside `profile`. So either:
  - Backend `PUT /api/profile` should also set a root-level `email` from `profilePatch.email` (for squadron/list views), or
  - getSquadronData should use `userData.email || profile.email`.
- **teamId:** Intake does **not** send `teamId`. New users typically get `teamId` when an admin assigns them to a team. So “Onbekend” or missing in coach list is not caused by intake schema; it’s either missing `email` (above) or coach filtering by `teamId` (unassigned users are excluded).

**Conclusion:** The main schema gap is **root-level `email`**: intake only puts email in `profile`. Either the API or getSquadronData should align so the squadron list can show email. Level (“Rookie”) comes from `getDashboardStats` / athlete level logic, not from the intake payload; that’s independent.

---

## 5. Summary & Integration Plan

### Out-of-sync points

| Area | Issue |
|------|--------|
| **Navigation** | Router and auth store use **Firestore** (via `fetchUserProfile`) for “onboarding complete?”. Only the unauthenticated branch uses the API. |
| **Data flow** | IntakeStepper correctly uses `PUT /api/profile`, but then does a **redundant** `setDoc(..., { onboardingComplete: true })` on Firestore. |
| **State sync** | After save, only `onboardingComplete` is set in the store; the rest of the profile is not refetched, so other screens can be slightly stale until next load. |
| **Schema** | Root-level `email` may be missing for intake-only users; getSquadronData (or the API) should use or set `profile.email` so the coach list has an email. |

### Recommended changes (Backend-First)

1. **IntakeStepper**
   - Remove the **Firestore `setDoc`** after a successful `PUT /api/profile`. Rely on the API as the single writer.
   - After successful save, either:
     - Call `authStore.fetchUserProfile(authStore.user.uid)` to refresh from Firestore, or
     - Use the API response (if it returns the updated profile) to update the auth store so `profile` and `onboardingComplete` are in sync.

2. **Backend `PUT /api/profile`**
   - When saving profile, set a root-level **`email`** on the user doc from `profilePatch.email` (if present), so squadron and other readers that use `userData.email` get a value.

3. **Backend getSquadronData** (defensive)
   - Use `userData.email || (userData.profile && userData.profile.email)` so that even if root `email` is missing, profile email is used.

4. **Router (optional)**
   - For consistency, the `/intake` guard could use **API** `GET /api/profile?userId=...` for the “profile complete?” check when authenticated as well, so the single source of truth for “complete” is the API/Firestore behind it, and the frontend does not depend on a direct Firestore read in the guard. This is optional if you keep using `fetchUserProfile` (which reads Firestore).

5. **Auth store**
   - Add a small helper used after intake save, e.g. `setOnboardingCompleteFromResponse(data)` or simply `fetchUserProfile(uid)` after `PUT /api/profile` success, so the rest of the app sees updated profile state without a full page reload.

Implementing (1) and (2)–(3) removes redundancy and aligns intake with Backend-First; (4)–(5) improve consistency and avoid stale state.
