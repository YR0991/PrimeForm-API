import { defineStore } from 'pinia'
import { db } from 'boot/firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { useAuthStore } from './auth'

const USERS_COLLECTION = 'users'

export const useSquadronStore = defineStore('squadron', {
  state: () => ({
    athletes: [],
    loading: false,
    error: null,
  }),

  getters: {
    squadronSize: (state) => state.athletes.length,

    atRiskCount: (state) =>
      state.athletes.reduce((count, athlete) => {
        const value = Number(athlete.acwr)
        if (Number.isFinite(value) && value > 1.5) {
          return count + 1
        }
        return count
      }, 0),
  },

  actions: {
    async fetchSquadron() {
      this.loading = true
      this.error = null

      try {
        const authStore = useAuthStore()
        const teamId = authStore.teamId || authStore.user?.teamId

        if (!teamId) {
          const err = new Error('No Team Assigned')
          this.error = err.message
          throw err
        }

        const usersRef = collection(db, USERS_COLLECTION)
        const q = query(usersRef, where('teamId', '==', teamId))
        const snapshot = await getDocs(q)

        this.athletes = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }))
      } catch (err) {
        console.error('SquadronStore: failed to fetch squadron', err)
        this.error = err?.message || 'Failed to fetch squadron'
        throw err
      } finally {
        this.loading = false
      }
    },
  },
})

