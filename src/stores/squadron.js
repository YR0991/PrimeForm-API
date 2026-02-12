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

/**
 * Normalized Truth: athletesById + activitiesByAthleteId.
 * Data uit Firestore direct gemapt; metrics zoals in DB; acwr ontbreekt → null (geen herberekening).
 */
export const useSquadronStore = defineStore('squadron', {
  state: () => ({
    /** { [athleteId]: athleteDoc } — Firestore user doc, metrics direct uit DB */
    athletesById: {},
    /** { [athleteId]: activity[] } — activiteiten per atleet; Strava-velden behouden */
    activitiesByAthleteId: {},
    loading: false,
    error: null,
    /** Id van atleet waarvoor de Deep Dive modal open is */
    selectedPilotId: null,
    deepDiveLoading: false,
  }),

  getters: {
    /** Tabelrijen: array uit athletesById (zelfde volgorde als ids). */
    athletes(state) {
      return Object.values(state.athletesById)
    },

    /** Explicit: rijen voor q-table (zelfde als athletes). */
    squadRows(state) {
      return Object.values(state.athletesById)
    },

    squadronSize(state) {
      return Object.keys(state.athletesById).length
    },

    atRiskCount(state) {
      return Object.values(state.athletesById).reduce((count, athlete) => {
        const acwr = athlete?.metrics?.acwr ?? null
        const value = Number(acwr)
        if (Number.isFinite(value) && value > 1.5) return count + 1
        return count
      }, 0)
    },

    /** Voor modal: geselecteerde atleet + activiteiten uit genormaliseerde state. */
    selectedPilot(state) {
      if (!state.selectedPilotId) return null
      const a = state.athletesById[state.selectedPilotId]
      if (!a) return null
      return {
        ...a,
        activities: state.activitiesByAthleteId[state.selectedPilotId] || [],
      }
    },
  },

  actions: {
    /**
     * Load squad: map Firestore DIRECT naar athletesById.
     * data.metrics zoals in DB; acwr niet in DB → null (geen herberekening).
     */
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

        const nextById = {}
        snapshot.docs.forEach((docSnap) => {
          const d = docSnap.data()
          const metrics = d.metrics || {}
          // Fallback: acwr niet in DB → null (no recalculation)
          const acwr = metrics.acwr != null ? Number(metrics.acwr) : null
          nextById[docSnap.id] = {
            id: docSnap.id,
            ...d,
            metrics: { ...metrics, acwr },
          }
        })

        this.athletesById = nextById
        // Activities niet meegeladen bij squad fetch; alleen bij deep dive
      } catch (err) {
        console.error('SquadronStore: failed to fetch squadron', err)
        this.error = err?.message || 'Failed to fetch squadron'
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Haal profiel, metrics, readiness en recente activiteiten op voor Deep Dive.
     * Schrijft in athletesById en activitiesByAthleteId; zet selectedPilotId.
     * Strava-velden (start_date_local, moving_time, etc.) blijven op activiteiten behouden.
     */
    async fetchPilotDeepDive(pilotId) {
      if (!pilotId) {
        this.selectedPilotId = null
        return
      }

      this.deepDiveLoading = true
      this.selectedPilotId = pilotId

      try {
        const userRef = doc(db, USERS_COLLECTION, pilotId)
        const userSnap = await getDoc(userRef)
        const userData = userSnap.exists() ? userSnap.data() : {}

        const profile = userData.profile || {}
        const lastPeriodDate =
          profile.lastPeriodDate ||
          profile.lastPeriod ||
          profile.lastMenstruationDate ||
          profile.cycleData?.lastPeriodDate ||
          profile.cycleData?.lastPeriod ||
          null
        const cycleLength =
          Number(profile.cycleLength) ||
          Number(profile.avgDuration) ||
          Number(profile.cycleData?.avgDuration) ||
          28

        const metrics = userData.metrics || {}
        const acwr = metrics.acwr != null ? Number(metrics.acwr) : null

        const displayName =
          userData.displayName ||
          userData.name ||
          profile.fullName ||
          profile.name ||
          userData.email ||
          'Pilot'

        // Update athlete in normalized state (voor modal: profile + metrics)
        this.athletesById = {
          ...this.athletesById,
          [pilotId]: {
            id: pilotId,
            ...userData,
            name: displayName,
            displayName,
            email: userData.email || null,
            profile: {
              ...profile,
              lastPeriodDate,
              cycleLength,
            },
            stats: userData.stats || null,
            metrics: {
              ...metrics,
              acwr,
              ctl: metrics.ctl != null ? Number(metrics.ctl) : null,
              atl: metrics.atl != null ? Number(metrics.atl) : null,
            },
            readiness: userData.readiness != null ? userData.readiness : null,
          },
        }

        // Activities: root + user subcollection; Strava-velden behouden
        const rootActivitiesRef = collection(db, ACTIVITIES_COLLECTION)
        const rootActivitiesQuery = query(
          rootActivitiesRef,
          where('userId', '==', pilotId),
          limit(ACTIVITIES_LIMIT * 3)
        )
        const userActivitiesRef = collection(
          doc(db, USERS_COLLECTION, pilotId),
          ACTIVITIES_COLLECTION
        )
        const [rootSnap, subSnap] = await Promise.all([
          getDocs(rootActivitiesQuery),
          getDocs(userActivitiesRef),
        ])

        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - ACTIVITIES_DAYS_CUTOFF)
        const cutoffIso = cutoff.toISOString().slice(0, 10)

        const list = [...rootSnap.docs, ...subSnap.docs].map((d) => {
          const a = d.data()
          const dateVal = a.date ?? a.start_date_local ?? a.start_date
          const dateStr =
            typeof dateVal === 'string'
              ? dateVal.slice(0, 10)
              : dateVal?.toDate?.()?.toISOString?.()?.slice(0, 10) || ''
          const loadVal =
            a.prime_load != null ? a.prime_load
            : a.primeLoad != null ? a.primeLoad
            : a.load != null ? a.load
            : a.trainingLoad != null ? a.trainingLoad
            : a.suffer_score != null ? a.suffer_score
            : null
          return {
            ...a,
            id: d.id,
            date: dateStr,
            type: a.type || a.sport_type || 'Session',
            source: a.source || a.activity_source || 'strava',
            rawLoad: a.suffer_score != null ? a.suffer_score : null,
            load: loadVal,
            primeLoad: loadVal,
            suffer_score: a.suffer_score != null ? a.suffer_score : null,
            moving_time: a.moving_time != null ? a.moving_time : null,
          }
        })
        list.sort((x, y) => ((x.date || '0000-00-00') > (y.date || '0000-00-00') ? -1 : 1))
        const activities = list
          .filter((x) => x.date >= cutoffIso)
          .slice(0, ACTIVITIES_LIMIT)

        this.activitiesByAthleteId = {
          ...this.activitiesByAthleteId,
          [pilotId]: activities,
        }
      } catch (err) {
        console.error('SquadronStore: fetchPilotDeepDive failed', err)
        this.selectedPilotId = null
        throw err
      } finally {
        this.deepDiveLoading = false
      }
    },

    /** Selecteer atleet uit tabelrij; daarna fetchPilotDeepDive(id) aanroepen voor activiteiten. */
    setSelectedPilotFromRow(row) {
      if (!row) {
        this.selectedPilotId = null
        return
      }
      this.selectedPilotId = row.id || row.uid || null
    },

    clearSelectedPilot() {
      this.selectedPilotId = null
    },
  },
})
