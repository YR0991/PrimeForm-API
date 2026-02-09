import { defineStore } from 'pinia'
import { auth, db } from 'boot/firebase'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'

const googleProvider = new GoogleAuthProvider()

let unsubscribeAuthListener = null

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null, // { uid, email, displayName, photoURL }
    role: null, // 'user' | 'coach' | 'admin' | null
    teamId: null,
    loading: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user,
    isAdmin: (state) => state.role === 'admin',
    isCoach: (state) => state.role === 'coach',
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
    },

    async loginWithGoogle() {
      this.loading = true
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
      return data
    },

    init() {
      if (unsubscribeAuthListener) {
        return
      }

      unsubscribeAuthListener = onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
          this.user = null
          this.role = null
          this.teamId = null
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
          return
        }

        this._setUserFromProfile(firebaseUser, profile)
      })
    },
  },
})

