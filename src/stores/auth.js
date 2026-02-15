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
import { api } from '../services/httpClient.js'

async function apiGetProfile() {
  const res = await api.get('/api/profile')
  const data = res.data?.data
  if (!data && res.status !== 200) throw new Error('Failed to load profile')
  return data
}

async function apiPutProfile(body) {
  const res = await api.put('/api/profile', body)
  const data = res.data?.data
  if (!data && res.status !== 200) throw new Error('Failed to save profile')
  return data
}

async function apiVerifyInviteCode(code) {
  try {
    const res = await api.get('/api/teams/verify-invite', {
      params: { code: code },
    })
    return res.data?.data ?? res.data
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Teamcode niet gevonden')
    throw new Error(err.response?.data?.error || err.response?.data?.message || err.message || 'Verify failed')
  }
}

const googleProvider = new GoogleAuthProvider()

/**
 * Minimal profile completeness check: mirrors backend profileValidation.isProfileComplete(profile).
 * Requires cycleData.lastPeriodDate (YYYY-MM-DD), cycleData.avgDuration >= 21, cycleData.contraception non-empty,
 * plus fullName, email, birthDate, disclaimerAccepted, redFlags empty, goals 1-2, programmingType.
 * @param {object} profile - Profile object (e.g. profileData.profile)
 * @returns {boolean}
 */
function isProfileCompleteFromFields(profile) {
  if (!profile || typeof profile !== 'object') return false
  const fullNameOk = typeof profile.fullName === 'string' && profile.fullName.trim().length >= 2
  const emailOk = typeof profile.email === 'string' && profile.email.includes('@')
  const birthDateOk = typeof profile.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)
  const disclaimerOk = profile.disclaimerAccepted === true
  const redFlags = Array.isArray(profile.redFlags) ? profile.redFlags : []
  const redFlagsOk = redFlags.length === 0
  const goalsOk = Array.isArray(profile.goals) && profile.goals.length > 0 && profile.goals.length <= 2
  const programmingTypeOk =
    typeof profile.programmingType === 'string' && profile.programmingType.trim().length > 0
  const cycleData = profile.cycleData && typeof profile.cycleData === 'object' ? profile.cycleData : null
  const cycleLastPeriodOk =
    cycleData && typeof cycleData.lastPeriodDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cycleData.lastPeriodDate)
  const cycleAvgOk = cycleData && Number.isFinite(Number(cycleData.avgDuration)) && Number(cycleData.avgDuration) >= 21
  const contraceptionOk =
    cycleData && typeof cycleData.contraception === 'string' && cycleData.contraception.trim().length > 0
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
  )
}

/**
 * Single source of truth for profile completeness (onboarding). Used to set onboardingStatus after GET /api/profile.
 * Never defaults to true when flags are missing.
 * @param {object} profileData - Raw API response (data) from GET /api/profile
 * @returns {boolean}
 */
function isProfileComplete(profileData) {
  if (!profileData || typeof profileData !== 'object') return false
  if (profileData.onboardingComplete === true) return true
  if (profileData.onboardingComplete === false) return false
  if (profileData.profileComplete === true) return true
  if (profileData.profileComplete === false) return false
  return isProfileCompleteFromFields(profileData.profile || profileData)
}

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
    // Tri-state: UNKNOWN until profile loaded after auth; then COMPLETE or INCOMPLETE
    onboardingStatus: 'UNKNOWN', // 'UNKNOWN' | 'COMPLETE' | 'INCOMPLETE'
    // UID for which we have loaded profile (avoids redirect race before profile is in store)
    profileLoadedForUid: null,
    profile: { lastPeriodDate: null, cycleLength: null, contraception: null },
    preferences: {},
    stravaConnected: false,
    // Shadow Mode: admin impersonation of an athlete
    impersonatingUser: null, // { id, name } | null
    shadowUid: null, // persisted target uid
    isShadow: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user,
    isAdmin: (state) => state.role === 'admin',
    isCoach: (state) =>
      state.role === 'coach' || state.impersonatingUser?.role === 'coach',
    isOnboardingComplete: (state) => !!state.onboardingComplete,
    isOnboardingStatusUnknown: (state) => state.onboardingStatus === 'UNKNOWN',
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
      this.onboardingComplete = isProfileComplete(profileData)
      this.onboardingStatus = this.onboardingComplete ? 'COMPLETE' : 'INCOMPLETE'
      const p = profileData?.profile || {}
      const cd = p.cycleData && typeof p.cycleData === 'object' ? p.cycleData : {}
      this.profile = {
        lastPeriodDate: p.lastPeriodDate ?? p.lastPeriod ?? null,
        cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : null),
        contraception: cd.contraception ?? null,
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
        await firebaseUser.getIdToken()

        let data = await apiGetProfile()
        const hasDoc = data && (data.profile != null || data.role != null || data.onboardingComplete != null)
        if (hasDoc) {
          this._setUserFromProfile(firebaseUser, data)
          this.profileLoadedForUid = uid
          return
        }

        await apiPutProfile({
          profilePatch: { email: firebaseUser.email ?? null, displayName: firebaseUser.displayName ?? null },
          role: 'user',
          onboardingComplete: false,
        })
        data = await apiGetProfile()
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
        await firebaseUser.getIdToken()

        let data = await apiGetProfile()
        const hasDoc = data && (data.profile != null || data.role != null || data.onboardingComplete != null)
        if (hasDoc) {
          this._setUserFromProfile(firebaseUser, data)
          this.profileLoadedForUid = uid
          return
        }

        await apiPutProfile({
          profilePatch: { email: firebaseUser.email ?? email, displayName: firebaseUser.displayName ?? null },
          role: 'user',
          onboardingComplete: false,
        })
        data = await apiGetProfile()
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
        this.shadowUid = null
        this.isShadow = false
        localStorage.removeItem('user_email')
        localStorage.removeItem('coach_email')
        localStorage.removeItem('pf_shadow_uid')
        localStorage.removeItem('pf_shadow_enabled')
      } finally {
        this.loading = false
      }
    },

    async fetchUserProfile(uid) {
      if (!uid) return null
      try {
        const data = await apiGetProfile()
        const hasDoc = data && (data.profile != null || data.role != null || data.onboardingComplete != null)
        if (!hasDoc) return null
        if (this.user?.uid === uid) {
          this._setUserFromProfile(this.user, data)
        } else {
          this.role = data.role ?? this.role
          this.teamId = data.teamId ?? this.teamId ?? null
          this.onboardingComplete = isProfileComplete(data)
          this.onboardingStatus = this.onboardingComplete ? 'COMPLETE' : 'INCOMPLETE'
          const p = data.profile || {}
          const cd = p.cycleData && typeof p.cycleData === 'object' ? p.cycleData : {}
          this.profile = {
            lastPeriodDate: p.lastPeriodDate ?? cd.lastPeriodDate ?? null,
            cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : (cd.avgDuration != null ? Number(cd.avgDuration) : null)),
            contraception: cd.contraception ?? null,
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

    /**
     * Load profile for current user and set onboardingStatus. Call from router when status is UNKNOWN.
     */
    async bootstrapProfile() {
      const uid = this.user?.uid
      if (!uid) return
      const data = await this.fetchUserProfile(uid)
      if (!data && this.user) {
        this.onboardingStatus = 'INCOMPLETE'
        this.profileLoadedForUid = uid
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
              this.profile = { lastPeriodDate: null, cycleLength: null, contraception: null }
              this.stravaConnected = false
              this.impersonatingUser = null
              this.shadowUid = null
              this.isShadow = false
              this.profileLoadedForUid = null
              this.onboardingStatus = 'UNKNOWN'
              localStorage.removeItem('pf_shadow_uid')
              localStorage.removeItem('pf_shadow_enabled')
              this.isAuthReady = true
              this.isInitialized = true
              if (!resolved) {
                resolved = true
                resolve()
              }
              return
            }

            // Restore profile on reload; UNKNOWN until profile is loaded
            this.onboardingStatus = 'UNKNOWN'
            const profile = await this.fetchUserProfile(firebaseUser.uid)

            if (!profile) {
              try {
                await apiPutProfile({
                  profilePatch: {
                    email: firebaseUser.email ?? null,
                    displayName: firebaseUser.displayName ?? null,
                  },
                  role: 'user',
                  onboardingComplete: false,
                })
                const data = await apiGetProfile()
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
              this.onboardingStatus = this.onboardingComplete ? 'COMPLETE' : 'INCOMPLETE'
              this._restoreShadowFromStorage()
              this.isAuthReady = true
              this.isInitialized = true
              if (!resolved) {
                resolved = true
                resolve()
              }
              return
            }

            this._setUserFromProfile(firebaseUser, profile)
            this._restoreShadowFromStorage()
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
        const data = await apiPutProfile(body)
        if (data.teamId) this.teamId = data.teamId
        this.onboardingComplete = true
        this.onboardingStatus = 'COMPLETE'
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
        const resp = await api.post('/api/strava/exchange', { code: raw })
        return resp?.data ?? resp
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
        const data = await apiPutProfile(body)
        if (data.teamId) this.teamId = data.teamId
        this.onboardingComplete = false
        this.onboardingStatus = 'INCOMPLETE'
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
        await apiPutProfile({ onboardingComplete: true })
        this.onboardingComplete = true
        this.onboardingStatus = 'COMPLETE'
      } catch (err) {
        console.error('completeOnboarding failed', err)
        this.error = err?.message || 'Onboarding voltooien mislukt'
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Update atleet profile (last period date, contraception, cycle length, baseline RHR/HRV). Persists via PUT /api/profile.
     */
    async updateAtleetProfile({ lastPeriodDate, contraception, cycleLength, rhrBaseline, hrvBaseline }) {
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
        if (contraception !== undefined) {
          profile.cycleData = { ...(this.profile?.cycleData || {}), contraception: contraception ?? 'Geen' }
        }
        await apiPutProfile({ profilePatch: profile })
        this.profile = { ...this.profile, ...profile }
        if (profile.cycleData) {
          this.profile.cycleData = { ...(this.profile.cycleData || {}), ...profile.cycleData }
          if (profile.cycleData.contraception !== undefined) this.profile.contraception = profile.cycleData.contraception ?? null
        }
        Notify.create({ type: 'positive', message: 'Kalibratie bijgewerkt' })
      } catch (err) {
        console.error('updateAtleetProfile failed', err)
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
        await apiPutProfile({ strava: { connected: false } })
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
        await apiPutProfile({ profilePatch })

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
     * Restore shadow state from localStorage (admin only, after auth ready).
     */
    _restoreShadowFromStorage() {
      if (this.role !== 'admin') return
      const enabled = localStorage.getItem('pf_shadow_enabled')
      const uid = localStorage.getItem('pf_shadow_uid')
      if (enabled !== '1' || !uid || !uid.trim()) return
      const targetUid = uid.trim()
      this.shadowUid = targetUid
      this.isShadow = true
      this.impersonatingUser = {
        id: targetUid,
        name: targetUid,
        role: 'user',
        teamId: null,
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
      const targetUid = String(user.id)
      const role = user.profile?.role || user.role || 'user'
      const teamId = user.teamId ?? null
      localStorage.setItem('pf_shadow_uid', targetUid)
      localStorage.setItem('pf_shadow_enabled', '1')
      this.shadowUid = targetUid
      this.isShadow = true
      this.impersonatingUser = {
        id: targetUid,
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
      Notify.create({ type: 'warning', message: `Shadow ON: ${targetUid}` })
    },

    /**
     * Shadow Mode: stop impersonating and return to own context.
     */
    stopImpersonation() {
      this.impersonatingUser = null
      this.shadowUid = null
      this.isShadow = false
      localStorage.removeItem('pf_shadow_uid')
      localStorage.removeItem('pf_shadow_enabled')
    },
  },
})

