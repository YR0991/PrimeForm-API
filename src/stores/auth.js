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
    stravaConnected: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user,
    isAdmin: (state) => state.role === 'admin',
    isCoach: (state) => state.role === 'coach',
    isOnboardingComplete: (state) => !!state.onboardingComplete,
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

      this.role = profileData?.role ?? null
      this.teamId = profileData?.teamId ?? null
      this.onboardingComplete = !!profileData?.onboardingComplete
      const p = profileData?.profile || {}
      this.profile = {
        lastPeriodDate: p.lastPeriodDate ?? p.lastPeriod ?? null,
        cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : null),
      }
      this.stravaConnected = profileData?.strava?.connected === true
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
          const data = snapshot.data()
          this._setUserFromProfile(firebaseUser, data)
          return
        }

        const newProfile = {
          email: firebaseUser.email ?? null,
          displayName: firebaseUser.displayName ?? null,
          role: 'user',
          onboardingComplete: false,
          createdAt: serverTimestamp(),
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
          const data = snapshot.data()
          this._setUserFromProfile(firebaseUser, data)
          return
        }

        const profile = {
          email: firebaseUser.email ?? email,
          displayName: firebaseUser.displayName ?? null,
          role: 'user',
          onboardingComplete: false,
          createdAt: serverTimestamp(),
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
        const profile = {
          email: firebaseUser.email ?? email,
          displayName: firebaseUser.displayName ?? fullName ?? null,
          role: 'user',
          onboardingComplete: false,
          createdAt: serverTimestamp(),
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

      const data = snapshot.data()
      this.role = data.role ?? this.role
      this.teamId = data.teamId ?? this.teamId ?? null
      this.onboardingComplete = !!data.onboardingComplete
      const p = data.profile || {}
      this.profile = {
        lastPeriodDate: p.lastPeriodDate ?? p.lastPeriod ?? null,
        cycleLength: p.cycleLength != null ? Number(p.cycleLength) : (p.avgDuration != null ? Number(p.avgDuration) : null),
      }
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
        this.error = err?.message || 'Ontkoppelen mislukt'
        Notify.create({ type: 'negative', message: this.error })
        throw err
      } finally {
        this.loading = false
      }
    },
  },
})

