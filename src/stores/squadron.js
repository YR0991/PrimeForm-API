import { defineStore } from 'pinia'
import { db } from 'boot/firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
} from 'firebase/firestore'
import { useAuthStore } from './auth'

const USERS_COLLECTION = 'users'
const ACTIVITIES_COLLECTION = 'activities'
const ACTIVITIES_LIMIT = 10
const ACTIVITIES_DAYS_CUTOFF = 14

export const useSquadronStore = defineStore('squadron', {
  state: () => ({
    athletes: [],
    loading: false,
    error: null,
    /** Detailed pilot data for Deep Dive panel: profile, metrics, readiness, activities */
    selectedPilot: null,
    deepDiveLoading: false,
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

    /**
     * Fetch pilot profile, metrics, readiness and recent activities for Deep Dive panel.
     * Stores result in selectedPilot.
     */
    async fetchPilotDeepDive(pilotId) {
      if (!pilotId) {
        this.selectedPilot = null
        return
      }

      this.deepDiveLoading = true
      this.selectedPilot = null

      try {
        // Step A: Pilot profile from users/{pilotId}
        const userRef = doc(db, USERS_COLLECTION, pilotId)
        const userSnap = await getDoc(userRef)
        const userData = userSnap.exists() ? userSnap.data() : {}

        const profile = userData.profile || {}
        const lastPeriodDate =
          profile.lastPeriodDate ||
          profile.lastPeriod ||
          profile.cycleData?.lastPeriodDate ||
          profile.cycleData?.lastPeriod ||
          null
        const cycleLength =
          Number(profile.cycleLength) ||
          Number(profile.avgDuration) ||
          Number(profile.cycleData?.avgDuration) ||
          28

        const metrics = userData.metrics || {}
        const readiness = userData.readiness != null ? userData.readiness : null

        const displayName =
          userData.displayName ||
          userData.name ||
          profile.fullName ||
          profile.name ||
          userData.email ||
          'Pilot'

        // Step B: Recent activities (userId == pilotId), limit then sort by date desc in memory
        const activitiesRef = collection(db, ACTIVITIES_COLLECTION)
        const activitiesQuery = query(
          activitiesRef,
          where('userId', '==', pilotId),
          limit(ACTIVITIES_LIMIT * 3)
        )
        const activitiesSnap = await getDocs(activitiesQuery)

        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - ACTIVITIES_DAYS_CUTOFF)
        const cutoffIso = cutoff.toISOString().slice(0, 10)

        const list = activitiesSnap.docs.map((d) => {
          const a = d.data()
          const dateVal = a.date
          const dateStr =
            typeof dateVal === 'string'
              ? dateVal.slice(0, 10)
              : dateVal?.toDate?.()?.toISOString?.()?.slice(0, 10) || ''
          return {
            id: d.id,
            date: dateStr,
            type: a.type || a.sport_type || 'Session',
            source: a.source || 'strava',
            rawLoad: a.suffer_score != null ? a.suffer_score : null,
            load: a.prime_load != null ? a.prime_load : a.primeLoad ?? null,
            primeLoad: a.prime_load != null ? a.prime_load : a.primeLoad ?? null,
            _sortKey: dateStr || '0000-00-00',
          }
        })
        list.sort((x, y) => (x._sortKey > y._sortKey ? -1 : 1))
        const activities = list
          .filter((x) => x.date >= cutoffIso)
          .slice(0, ACTIVITIES_LIMIT)
          .map((o) => {
            const copy = { ...o }
            delete copy._sortKey
            return copy
          })

        // Step C: Commit to state
        this.selectedPilot = {
          id: pilotId,
          name: displayName,
          email: userData.email || null,
          profile: {
            lastPeriodDate,
            cycleLength,
          },
          stats: userData.stats || null,
          metrics: {
            acwr: metrics.acwr != null ? Number(metrics.acwr) : null,
            ctl: metrics.ctl != null ? Number(metrics.ctl) : null,
            atl: metrics.atl != null ? Number(metrics.atl) : null,
          },
          readiness,
          activities,
        }
      } catch (err) {
        console.error('SquadronStore: fetchPilotDeepDive failed', err)
        this.selectedPilot = null
        throw err
      } finally {
        this.deepDiveLoading = false
      }
    },

    clearSelectedPilot() {
      this.selectedPilot = null
    },
  },
})

