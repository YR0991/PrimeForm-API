import { defineStore } from 'pinia'
import { auth, db } from 'boot/firebase'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import { Notify } from 'quasar'
import { API_URL } from '../config/api.js'

const googleProvider = new GoogleAuthProvider()

let unsubscribeAuthListener = null
let initPromise = null

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null, // { uid, email, displayName, photoURL }
    role: null, // 'user' | 'coach' | 'admin' | null
    teamId: null,
    onboardingComplete: false,
    loading: false,
    error: null,
    // True once Firebase Auth has fired onAuthStateChanged at least once
    isAuthReady: false,
    // Alias for router guards / external waiters
    isInitialized: false,
    profile: { lastPeriodDate: null, cycleLength: null },
    preferences: {},
    stravaConnected: false,
    // Shadow Mode: admin impersonation of an athlete
    impersonatingUser: null, // { id, name } | null
  }),

  getters: {
    isAuthenticated: (state) => !!state.user,
    isAdmin: (state) => state.role === 'admin',
    isCoach: (state) =>
      state.role === 'coach' || state.impersonatingUser?.role === 'coach',
    isOnboardingComplete: (state) => !!state.onboardingComplete,
    activeUid: (state) =>
      state.impersonatingUser?.id || state.user?.uid || null,
    isImpersonating: (state) => !!state.impersonatingUser,
  },

  actions: {
    _setUserFromProfile(firebaseUser, profileData) {
      this.user = firebaseUser
        ? {
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? null,
          displayName: firebaseUser.displayName ?? null,
          photoURL: firebaseUser.photoURL ?? null,
        }
        : null

      const email = firebaseUser?.email ?? ''
      if (email) {
        localStorage.setItem('user_email', email)
        const role = profileData?.role ?? profileData?.profile?.role
        if (role === 'coach') {
          localStorage.setItem('coach_email', email)
        } else {
          localStorage.removeItem('coach_email')
        }
      } else {
        localStorage.removeItem('user_email')
        localStorage.removeItem('coach_email')
      }

      const rootRole = profileData?.role
      const profileRole = profileData?.profile?.role
      this.role = rootRole ?? profileRole ?? null
      this.teamId = profileData?.teamId ?? null
      // Intake compleet: onboardingComplete of profileComplete
      this.onboardingComplete = !!(
        profileData?.onboardingComplete === true ||
        profileData?.profileComplete === true
      )
      const p = profileData?.profile || {}
      this.profile = {
        lastPeriodDate: p.lastPeriodDate ?? p.lastPeriod ?? null,
        cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : null),
      }
      this.preferences = p.preferences || {}
      this.stravaConnected = profileData?.strava?.connected === true
    },

    async _detectCoachTeamIdForEmail(email) {
      const raw = (email || '').trim().toLowerCase()
      if (!raw) return null

      const teamsRef = collection(db, 'teams')
      const qTeams = query(teamsRef, where('coachEmail', '==', raw))
      const snap = await getDocs(qTeams)
      if (snap.empty) return null
      const teamDoc = snap.docs[0]
      return teamDoc.id
    },

    async _applyCoachAssignmentIfNeeded(uid, baseProfile) {
      const currentRole = baseProfile?.role
      const hasCoachFlags =
        currentRole === 'coach' &&
        !!baseProfile?.teamId &&
        baseProfile?.onboardingComplete === true

      if (hasCoachFlags) {
        return baseProfile
      }

      const email =
        (baseProfile?.email || baseProfile?.profile?.email || this.user?.email || '').toString()
      const teamId = await this._detectCoachTeamIdForEmail(email)
      if (!teamId) return baseProfile

      const patch = {
        role: 'coach',
        teamId,
        onboardingComplete: true,
      }

      try {
        const userRef = doc(db, 'users', uid)
        await updateDoc(userRef, patch)
      } catch (err) {
        console.warn('Failed to persist coach assignment for user', uid, err)
      }

      return {
        ...baseProfile,
        ...patch,
      }
    },

    async loginWithGoogle() {
      this.loading = true
      this.error = null
      try {
        const result = await signInWithPopup(auth, googleProvider)
        const firebaseUser = result.user
        const uid = firebaseUser.uid

        const userRef = doc(db, 'users', uid)
        const snapshot = await getDoc(userRef)

        if (snapshot.exists()) {
          let data = snapshot.data()
          data = await this._applyCoachAssignmentIfNeeded(uid, data)
          this._setUserFromProfile(firebaseUser, data)
          return
        }

        const baseProfile = {
          email: firebaseUser.email ?? null,
          displayName: firebaseUser.displayName ?? null,
          role: 'user',
          onboardingComplete: false,
          createdAt: serverTimestamp(),
        }

        const teamId = await this._detectCoachTeamIdForEmail(baseProfile.email)
        const newProfile = {
          ...baseProfile,
          role: teamId ? 'coach' : baseProfile.role,
          onboardingComplete: teamId ? true : baseProfile.onboardingComplete,
          teamId: teamId ?? null,
        }

        await setDoc(userRef, newProfile)
        this._setUserFromProfile(firebaseUser, newProfile)
      } catch (err) {
        // Log and surface error for UI
        console.error('Google login failed', err)
        this.error = err?.message || 'Google login failed'
      } finally {
        this.loading = false
      }
    },

    async loginWithEmail(email, password) {
      this.loading = true
      this.error = null
      try {
        const credential = await signInWithEmailAndPassword(auth, email, password)
        const firebaseUser = credential.user
        const uid = firebaseUser.uid

        const userRef = doc(db, 'users', uid)
        const snapshot = await getDoc(userRef)

        if (snapshot.exists()) {
          let data = snapshot.data()
          data = await this._applyCoachAssignmentIfNeeded(uid, data)
          this._setUserFromProfile(firebaseUser, data)
          return
        }

        const baseProfile = {
          email: firebaseUser.email ?? email,
          displayName: firebaseUser.displayName ?? null,
          role: 'user',
          onboardingComplete: false,
          createdAt: serverTimestamp(),
        }

        const teamId = await this._detectCoachTeamIdForEmail(baseProfile.email)
        const profile = {
          ...baseProfile,
          role: teamId ? 'coach' : baseProfile.role,
          onboardingComplete: teamId ? true : baseProfile.onboardingComplete,
          teamId: teamId ?? null,
        }

        await setDoc(userRef, profile)
        this._setUserFromProfile(firebaseUser, profile)
      } catch (err) {
        console.error('Email login failed', err)
        this.error = err?.message || 'Email login failed'
      } finally {
        this.loading = false
      }
    },

    async registerWithEmail(email, password, fullName) {
      this.loading = true
      this.error = null
      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        const firebaseUser = credential.user

        if (fullName) {
          try {
            await updateProfile(firebaseUser, { displayName: fullName })
          } catch (err) {
            console.warn('Failed to update displayName for new user', err)
          }
        }

        const uid = firebaseUser.uid
        const userRef = doc(db, 'users', uid)
        const baseProfile = {
          email: firebaseUser.email ?? email,
          displayName: firebaseUser.displayName ?? fullName ?? null,
          role: 'user',
          onboardingComplete: false,
          createdAt: serverTimestamp(),
        }

        const teamId = await this._detectCoachTeamIdForEmail(baseProfile.email)
        const profile = {
          ...baseProfile,
          role: teamId ? 'coach' : baseProfile.role,
          onboardingComplete: teamId ? true : baseProfile.onboardingComplete,
          teamId: teamId ?? null,
        }

        await setDoc(userRef, profile)
        this._setUserFromProfile(firebaseUser, profile)
      } catch (err) {
        console.error('Email registration failed', err)
        this.error = err?.message || 'Registration failed'
      } finally {
        this.loading = false
      }
    },

    async logoutUser() {
      this.loading = true
      try {
        await signOut(auth)
        this.user = null
        this.role = null
        this.teamId = null
        this.impersonatingUser = null
        localStorage.removeItem('user_email')
        localStorage.removeItem('coach_email')
      } finally {
        this.loading = false
      }
    },

    async fetchUserProfile(uid) {
      if (!uid) return null

      const userRef = doc(db, 'users', uid)
      const snapshot = await getDoc(userRef)
      if (!snapshot.exists()) {
        return null
      }

      let data = snapshot.data()
      data = await this._applyCoachAssignmentIfNeeded(uid, data)
      this.role = data.role ?? this.role
      this.teamId = data.teamId ?? this.teamId ?? null
      // Intake compleet: Firestore velden onboardingComplete of profileComplete
      this.onboardingComplete = !!(
        data.onboardingComplete === true ||
        data.profileComplete === true
      )
      const p = data.profile || {}
      const cd = p.cycleData && typeof p.cycleData === 'object' ? p.cycleData : {}
      this.profile = {
        lastPeriodDate: p.lastPeriodDate ?? p.lastPeriod ?? cd.lastPeriodDate ?? cd.lastPeriod ?? null,
        cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : (cd.avgDuration != null ? Number(cd.avgDuration) : null)),
      }
      this.preferences = p.preferences || this.preferences || {}
      this.stravaConnected = data.strava?.connected === true
      return data
    },

    init() {
      // Singleton: reuse existing promise & listener
      if (initPromise) {
        return initPromise
      }

      initPromise = new Promise((resolve) => {
        if (unsubscribeAuthListener) {
          // Listener already active; resolve immediately if we've already run at least once
          if (this.isAuthReady) {
            resolve()
          }
          return
        }

        let resolved = false

        unsubscribeAuthListener = onAuthStateChanged(auth, async (firebaseUser) => {
          try {
            if (!firebaseUser) {
              this.user = null
              this.role = null
              this.teamId = null
              this.profile = { lastPeriodDate: null, cycleLength: null }
              this.stravaConnected = false
              this.impersonatingUser = null
              this.isAuthReady = true
              this.isInitialized = true
              if (!resolved) {
                resolved = true
                resolve()
              }
              return
            }

            // Restore profile on reload
            const profile = await this.fetchUserProfile(firebaseUser.uid)

            if (!profile) {
              // If Firestore doc does not exist (user signed in outside loginWithGoogle)
              const bootstrapProfile = {
                email: firebaseUser.email ?? null,
                displayName: firebaseUser.displayName ?? null,
                role: 'user',
                onboardingComplete: false,
                createdAt: serverTimestamp(),
              }
              const userRef = doc(db, 'users', firebaseUser.uid)
              await setDoc(userRef, bootstrapProfile)
              this._setUserFromProfile(firebaseUser, bootstrapProfile)
              this.isAuthReady = true
              this.isInitialized = true
              if (!resolved) {
                resolved = true
                resolve()
              }
              return
            }

            this._setUserFromProfile(firebaseUser, profile)
            this.isAuthReady = true
            this.isInitialized = true
            if (!resolved) {
              resolved = true
              resolve()
            }
          } catch (err) {
            console.error('Auth init failed', err)
            this.isAuthReady = true
            this.isInitialized = true
            if (!resolved) {
              resolved = true
              resolve()
            }
          }
        })
      })

      return initPromise
    },

    /**
     * Verify a team invite code and return team { id, name, ...data }.
     */
    async verifyInviteCode(code) {
      const raw = (code || '').trim()
      if (!raw) {
        throw new Error('Geen teamcode opgegeven')
      }

      const teamsRef = collection(db, 'teams')
      const q = query(teamsRef, where('inviteCode', '==', raw))
      const snap = await getDocs(q)
      if (snap.empty) {
        throw new Error('Teamcode niet gevonden')
      }

      const teamDoc = snap.docs[0]
      const data = teamDoc.data() || {}
      return {
        id: teamDoc.id,
        ...data,
      }
    },

    /**
     * Persist onboarding data for the current athlete.
     * payload: { teamId, date, length }
     */
    async saveOnboardingData(payload) {
      const { teamId, date, length } = payload || {}

      if (!this.user?.uid) {
        throw new Error('No authenticated user')
      }

      this.loading = true
      this.error = null

      try {
        const uid = this.user.uid
        const userRef = doc(db, 'users', uid)

        const updatePayload = {
          onboardingComplete: true,
          profile: {
            lastPeriodDate: date || null,
            cycleLength: length != null ? Number(length) : null,
          },
        }

        if (teamId) {
          updatePayload.teamId = teamId
        }

        await updateDoc(userRef, updatePayload)

        // Update local auth state
        if (teamId) {
          this.teamId = teamId
        }
        this.onboardingComplete = true
      } catch (err) {
        console.error('saveOnboardingData failed', err)
        this.error = err?.message || 'Onboarding opslaan mislukt'
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Placeholder: exchange Strava OAuth code for tokens via backend.
     */
    async exchangeStravaCode(code) {
      const raw = (code || '').toString().trim()
      if (!raw) {
        throw new Error('Geen Strava code ontvangen')
      }

      try {
        const resp = await fetch(`${API_URL}/api/strava/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: raw }),
        })

        if (!resp.ok) {
          const text = await resp.text()
          throw new Error(text || 'Strava exchange failed')
        }

        return await resp.json()
      } catch (err) {
        console.error('exchangeStravaCode failed', err)
        throw err
      }
    },

    /**
     * Persist bio onboarding data without completing Strava step yet.
     * payload: { teamId, date, length }
     */
    async submitBioData(payload) {
      const { teamId, date, length } = payload || {}

      if (!this.user?.uid) {
        throw new Error('No authenticated user')
      }

      this.loading = true
      this.error = null

      try {
        const uid = this.user.uid
        const userRef = doc(db, 'users', uid)

        const updatePayload = {
          onboardingComplete: false,
          profile: {
            lastPeriodDate: date || null,
            cycleLength: length != null ? Number(length) : null,
          },
        }

        if (teamId) {
          updatePayload.teamId = teamId
        }

        await updateDoc(userRef, updatePayload)

        if (teamId) {
          this.teamId = teamId
        }
        this.onboardingComplete = false
      } catch (err) {
        console.error('submitBioData failed', err)
        this.error = err?.message || 'Onboarding opslaan mislukt'
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Mark onboarding as complete (e.g. skip Strava).
     */
    async completeOnboarding() {
      if (!this.user?.uid) {
        throw new Error('No authenticated user')
      }

      this.loading = true
      this.error = null

      try {
        const uid = this.user.uid
        const userRef = doc(db, 'users', uid)
        await updateDoc(userRef, { onboardingComplete: true })
        this.onboardingComplete = true
      } catch (err) {
        console.error('completeOnboarding failed', err)
        this.error = err?.message || 'Onboarding voltooien mislukt'
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Update pilot profile (last period date, cycle length). Persists to Firestore and local state.
     */
    async updatePilotProfile({ lastPeriodDate, cycleLength }) {
      const uid = this.user?.uid
      if (!uid) {
        throw new Error('No authenticated user')
      }

      this.loading = true
      this.error = null

      try {
        const userRef = doc(db, 'users', uid)
        const profile = {
          lastPeriodDate: lastPeriodDate || null,
          cycleLength: cycleLength != null ? Number(cycleLength) : null,
        }
        await updateDoc(userRef, { profile })
        this.profile = { ...profile }
        Notify.create({ type: 'positive', message: 'Kalibratie bijgewerkt' })
      } catch (err) {
        console.error('updatePilotProfile failed', err)
        this.error = err?.message || 'Bijwerken mislukt'
        Notify.create({ type: 'negative', message: this.error })
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Disconnect Strava: clear Strava data on user document and update local state.
     */
    async disconnectStrava() {
      const uid = this.user?.uid
      if (!uid) {
        throw new Error('No authenticated user')
      }

      this.loading = true
      this.error = null

      try {
        const userRef = doc(db, 'users', uid)
        await updateDoc(userRef, { strava: { connected: false } })
        this.stravaConnected = false
        Notify.create({ type: 'positive', message: 'Strava ontkoppeld' })
      } catch (err) {
        console.error('disconnectStrava failed', err)
        this.error = err?.message || 'Strava ontkoppelen mislukt'
        Notify.create({ type: 'negative', message: this.error })
        throw err
      } finally {
        this.loading = false
      }
    },

    async sendPasswordReset() {
      const email = this.user?.email
      if (!email) {
        Notify.create({ type: 'negative', message: 'Geen e-mailadres gevonden voor dit account.' })
        return
      }
      try {
        this.loading = true
        await sendPasswordResetEmail(auth, email)
        Notify.create({
          type: 'positive',
          message: 'Wachtwoord reset link verzonden naar je e-mailadres.',
        })
      } catch (err) {
        console.error('sendPasswordReset failed', err)
        const msg = err?.message || 'Verzenden van reset-link mislukt.'
        this.error = msg
        Notify.create({ type: 'negative', message: msg })
      } finally {
        this.loading = false
      }
    },

    async updateSelfProfileSettings({ firstName, lastName, preferences } = {}) {
      const uid = this.user?.uid
      if (!uid) {
        throw new Error('No authenticated user')
      }

      const updates = {}
      if (firstName !== undefined) {
        updates['profile.firstName'] = firstName || null
      }
      if (lastName !== undefined) {
        updates['profile.lastName'] = lastName || null
      }
      if (preferences && typeof preferences === 'object') {
        Object.entries(preferences).forEach(([key, value]) => {
          updates[`profile.preferences.${key}`] = value
        })
      }

      if (Object.keys(updates).length === 0) return

      try {
        this.loading = true
        this.error = null
        const userRef = doc(db, 'users', uid)
        await updateDoc(userRef, updates)

        this.profile = {
          ...this.profile,
          firstName: firstName !== undefined ? firstName : this.profile.firstName,
          lastName: lastName !== undefined ? lastName : this.profile.lastName,
        }
        if (preferences && typeof preferences === 'object') {
          this.preferences = {
            ...(this.preferences || {}),
            ...preferences,
          }
        }

        Notify.create({ type: 'positive', message: 'Instellingen opgeslagen.' })
      } catch (err) {
        console.error('updateSelfProfileSettings failed', err)
        const msg = err?.message || 'Instellingen opslaan mislukt.'
        this.error = msg
        Notify.create({ type: 'negative', message: msg })
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Shadow Mode: start impersonating a specific athlete (admin only).
     * Expects a user-like object with an id field.
     */
    startImpersonation(user) {
      console.log('Starting impersonation for:', user?.id)
      if (!this.isAdmin) {
        Notify.create({
          type: 'negative',
          message: 'Alleen admins mogen Shadow Mode gebruiken.',
        })
        return
      }
      if (!user || !user.id) {
        Notify.create({
          type: 'negative',
          message: 'Ongeldige atleet voor Shadow Mode.',
        })
        return
      }
      const role = user.profile?.role || user.role || 'user'
      const teamId = user.teamId ?? null
      this.impersonatingUser = {
        id: user.id,
        name:
          user.displayName ||
          user.profile?.fullName ||
          user.email ||
          user.profile?.email ||
          'Atleet',
        role,
        teamId,
      }
      if (teamId) {
        this.teamId = teamId
      }
    },

    /**
     * Shadow Mode: stop impersonating and return to own context.
     */
    stopImpersonation() {
      this.impersonatingUser = null
    },
  },
})

