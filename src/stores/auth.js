import { defineStore } from 'pinia'
import { auth } from 'boot/firebase'
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
import { Notify } from 'quasar'
import { API_URL } from '../config/api.js'

async function apiGetProfile(userId) {
  const res = await fetch(`${API_URL}/api/profile?userId=${encodeURIComponent(userId)}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || json.message || 'Failed to load profile')
  return json.data
}

async function apiPutProfile(userId, body) {
  const res = await fetch(`${API_URL}/api/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...body }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || json.message || 'Failed to save profile')
  return json.data
}

async function apiVerifyInviteCode(code) {
  const res = await fetch(`${API_URL}/api/teams/verify-invite?code=${encodeURIComponent(code)}`)
  const json = await res.json()
  if (!res.ok) {
    if (res.status === 404) throw new Error('Teamcode niet gevonden')
    throw new Error(json.error || json.message || 'Verify failed')
  }
  return json.data
}

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
    // UID for which we have loaded profile (avoids redirect race before profile is in store)
    profileLoadedForUid: null,
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
    hasProfileLoadedForCurrentUser: (state) =>
      !!state.user?.uid && state.profileLoadedForUid === state.user.uid,
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
      // Intake: expliciet true → true; expliciet false → false; ontbreekt (oude accounts) → true
      if (profileData?.onboardingComplete === true || profileData?.profileComplete === true) {
        this.onboardingComplete = true
      } else if (profileData?.onboardingComplete === false) {
        this.onboardingComplete = false
      } else {
        this.onboardingComplete = true
      }
      const p = profileData?.profile || {}
      this.profile = {
        lastPeriodDate: p.lastPeriodDate ?? p.lastPeriod ?? null,
        cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : null),
      }
      this.preferences = p.preferences || {}
      this.stravaConnected = profileData?.strava?.connected === true
    },

    async loginWithGoogle() {
      this.loading = true
      this.error = null
      try {
        const result = await signInWithPopup(auth, googleProvider)
        const firebaseUser = result.user
        const uid = firebaseUser.uid

        let data = await apiGetProfile(uid)
        const hasDoc = data && (data.profile != null || data.role != null || data.onboardingComplete != null)
        if (hasDoc) {
          this._setUserFromProfile(firebaseUser, data)
          this.profileLoadedForUid = uid
          return
        }

        await apiPutProfile(uid, {
          profilePatch: { email: firebaseUser.email ?? null, displayName: firebaseUser.displayName ?? null },
          role: 'user',
          onboardingComplete: false,
        })
        data = await apiGetProfile(uid)
        this._setUserFromProfile(firebaseUser, data)
        this.profileLoadedForUid = uid
      } catch (err) {
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

        let data = await apiGetProfile(uid)
        const hasDoc = data && (data.profile != null || data.role != null || data.onboardingComplete != null)
        if (hasDoc) {
          this._setUserFromProfile(firebaseUser, data)
          this.profileLoadedForUid = uid
          return
        }

        await apiPutProfile(uid, {
          profilePatch: { email: firebaseUser.email ?? email, displayName: firebaseUser.displayName ?? null },
          role: 'user',
          onboardingComplete: false,
        })
        data = await apiGetProfile(uid)
        this._setUserFromProfile(firebaseUser, data)
        this.profileLoadedForUid = uid
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
        await apiPutProfile(uid, {
          profilePatch: {
            email: firebaseUser.email ?? email,
            displayName: firebaseUser.displayName ?? fullName ?? null,
          },
          role: 'user',
          onboardingComplete: false,
        })
        const data = await apiGetProfile(uid)
        this._setUserFromProfile(firebaseUser, data)
        this.profileLoadedForUid = uid
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
      try {
        const data = await apiGetProfile(uid)
        const hasDoc = data && (data.profile != null || data.role != null || data.onboardingComplete != null)
        if (!hasDoc) return null
        if (this.user?.uid === uid) {
          this._setUserFromProfile(this.user, data)
        } else {
          this.role = data.role ?? this.role
          this.teamId = data.teamId ?? this.teamId ?? null
          this.onboardingComplete = data.onboardingComplete === true || data.profileComplete === true
          if (data.onboardingComplete === false) this.onboardingComplete = false
          const p = data.profile || {}
          const cd = p.cycleData && typeof p.cycleData === 'object' ? p.cycleData : {}
          this.profile = {
            lastPeriodDate: p.lastPeriodDate ?? p.lastPeriod ?? cd.lastPeriodDate ?? cd.lastPeriod ?? null,
            cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : (cd.avgDuration != null ? Number(cd.avgDuration) : null)),
          }
          this.preferences = p.preferences || this.preferences || {}
          this.stravaConnected = data.strava?.connected === true
        }
        this.profileLoadedForUid = uid
        return data
      } catch {
        return null
      }
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
              this.profileLoadedForUid = null
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
              try {
                await apiPutProfile(firebaseUser.uid, {
                  profilePatch: {
                    email: firebaseUser.email ?? null,
                    displayName: firebaseUser.displayName ?? null,
                  },
                  role: 'user',
                  onboardingComplete: false,
                })
                const data = await apiGetProfile(firebaseUser.uid)
                this._setUserFromProfile(firebaseUser, data)
              } catch (err) {
                console.warn('Bootstrap profile failed', err)
                this._setUserFromProfile(firebaseUser, {
                  profile: null,
                  role: 'user',
                  teamId: null,
                  onboardingComplete: false,
                  strava: null,
                  email: firebaseUser.email ?? null,
                })
              }
              this.profileLoadedForUid = firebaseUser.uid
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
      if (!raw) throw new Error('Geen teamcode opgegeven')
      return apiVerifyInviteCode(raw)
    },

    /**
     * Persist onboarding data for the current athlete.
     * payload: { teamId, date, length }
     */
    async saveOnboardingData(payload) {
      const { teamId, date, length } = payload || {}
      if (!this.user?.uid) throw new Error('No authenticated user')

      this.loading = true
      this.error = null
      try {
        const body = {
          profilePatch: {
            lastPeriodDate: date || null,
            cycleLength: length != null ? Number(length) : null,
          },
          onboardingComplete: true,
        }
        if (teamId) body.teamId = teamId
        const data = await apiPutProfile(this.user.uid, body)
        if (data.teamId) this.teamId = data.teamId
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
      if (!this.user?.uid) throw new Error('No authenticated user')

      this.loading = true
      this.error = null
      try {
        const body = {
          profilePatch: {
            lastPeriodDate: date || null,
            cycleLength: length != null ? Number(length) : null,
          },
          onboardingComplete: false,
        }
        if (teamId) body.teamId = teamId
        const data = await apiPutProfile(this.user.uid, body)
        if (data.teamId) this.teamId = data.teamId
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
      if (!this.user?.uid) throw new Error('No authenticated user')
      this.loading = true
      this.error = null
      try {
        await apiPutProfile(this.user.uid, { onboardingComplete: true })
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
     * Update pilot profile (last period date, cycle length, baseline RHR/HRV). Persists via PUT /api/profile.
     */
    async updatePilotProfile({ lastPeriodDate, cycleLength, rhrBaseline, hrvBaseline }) {
      if (!this.user?.uid) throw new Error('No authenticated user')
      this.loading = true
      this.error = null
      try {
        const profile = {
          lastPeriodDate: lastPeriodDate || null,
          cycleLength: cycleLength != null ? Number(cycleLength) : null,
          ...(rhrBaseline != null && Number.isFinite(Number(rhrBaseline)) ? { rhrBaseline: Number(rhrBaseline) } : {}),
          ...(hrvBaseline != null && Number.isFinite(Number(hrvBaseline)) ? { hrvBaseline: Number(hrvBaseline) } : {}),
        }
        await apiPutProfile(this.user.uid, { profilePatch: profile })
        this.profile = { ...this.profile, ...profile }
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
      if (!this.user?.uid) throw new Error('No authenticated user')
      this.loading = true
      this.error = null
      try {
        await apiPutProfile(this.user.uid, { strava: { connected: false } })
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
      if (!this.user?.uid) throw new Error('No authenticated user')

      const profilePatch = {}
      if (firstName !== undefined) profilePatch.firstName = firstName || null
      if (lastName !== undefined) profilePatch.lastName = lastName || null
      if (preferences && typeof preferences === 'object') {
        profilePatch.preferences = { ...(this.preferences || {}), ...preferences }
      }
      if (Object.keys(profilePatch).length === 0) return

      try {
        this.loading = true
        this.error = null
        await apiPutProfile(this.user.uid, { profilePatch })

        this.profile = {
          ...this.profile,
          firstName: firstName !== undefined ? firstName : this.profile.firstName,
          lastName: lastName !== undefined ? lastName : this.profile.lastName,
        }
        if (preferences && typeof preferences === 'object') {
          this.preferences = { ...(this.preferences || {}), ...preferences }
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

