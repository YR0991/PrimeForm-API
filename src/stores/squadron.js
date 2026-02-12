import { defineStore } from 'pinia'
import { useAuthStore } from './auth'
import { getCoachSquad, getAthleteDetail } from '../services/coachService'

/**
 * Squadron store — Backend-First. Storage only; no metric calculations.
 * State: athletesById (dict). Data stored exactly as the API sends.
 */
export const useSquadronStore = defineStore('squadron', {
  state: () => ({
    athletesById: {},
    loading: false,
    error: null,
    selectedPilotId: null,
    deepDiveLoading: false,
  }),

  getters: {
    /** List of athletes (for table). */
    squadronList(state) {
      return Object.values(state.athletesById)
    },

    /** Alias for table binding. */
    squadRows(state) {
      return Object.values(state.athletesById)
    },

    squadronSize(state) {
      return Object.keys(state.athletesById).length
    },

    /** Count of athletes with stored acwr > 1.5 (read-only, no calculation). */
    atRiskCount(state) {
      return Object.values(state.athletesById).reduce((count, a) => {
        const acwr = a?.metrics?.acwr ?? a?.acwr ?? null
        const v = Number(acwr)
        if (Number.isFinite(v) && v > 1.5) return count + 1
        return count
      }, 0)
    },

    /** Athlete by id. */
    getAthlete: (state) => (id) => {
      if (!id) return null
      return state.athletesById[id] ?? null
    },

    /** Selected athlete (for modal). */
    selectedPilot(state) {
      if (!state.selectedPilotId) return null
      return state.athletesById[state.selectedPilotId] ?? null
    },
  },

  actions: {
    /**
     * Fetch squadron from API. Map array to athletesById (key = athlete.id).
     * Stores exactly what the API sends; no transformation.
     */
    async fetchSquadron() {
      this.loading = true
      this.error = null

      const authStore = useAuthStore()
      const teamId = authStore.teamId ?? authStore.user?.teamId

      try {
        if (!teamId) {
          this.error = 'No Team Assigned'
          throw new Error('No Team Assigned')
        }

        const response = await getCoachSquad()
        const list = Array.isArray(response) ? response : (response?.data ?? [])
        const filtered = list.filter((row) => row.teamId === teamId)

        const nextById = {}
        for (const athlete of filtered) {
          const id = athlete.id ?? athlete.uid
          if (!id) continue
          const profile = athlete.profile ?? {
            fullName: athlete.name ?? athlete.displayName ?? null,
            firstName: null,
            lastName: null,
            avatar: athlete.avatar ?? null,
          }
          const metrics = athlete.metrics ?? {
            acwr: athlete.acwr ?? null,
            acuteLoad: athlete.acuteLoad ?? null,
            chronicLoad: athlete.chronicLoad ?? null,
            form: athlete.form ?? null,
            cyclePhase: athlete.cyclePhase ?? null,
            cycleDay: athlete.cycleDay ?? null,
            readiness: athlete.readiness ?? null,
          }
          nextById[id] = { ...athlete, profile, metrics }
        }
        this.athletesById = nextById
      } catch (err) {
        console.error('SquadronStore: fetchSquadron failed', err)
        this.error = err?.message ?? 'Failed to fetch squadron'
        throw err
      } finally {
        this.loading = false
      }
    },

    /**
     * Fetch one athlete detail from API and merge into athletesById.
     * Does not mutate API response; merges into a new object.
     */
    async fetchAthleteDeepDive(id) {
      if (!id) {
        this.selectedPilotId = null
        return
      }

      this.deepDiveLoading = true
      this.selectedPilotId = id

      try {
        const data = await getAthleteDetail(id)
        const existing = this.athletesById[id]
        this.athletesById = {
          ...this.athletesById,
          [id]: { ...existing, ...data },
        }
      } catch (err) {
        console.error('SquadronStore: fetchAthleteDeepDive failed', err)
        this.selectedPilotId = null
        throw err
      } finally {
        this.deepDiveLoading = false
      }
    },

    /** Alias for backward compatibility. */
    async fetchPilotDeepDive(pilotId) {
      return this.fetchAthleteDeepDive(pilotId)
    },

    setSelectedPilotFromRow(row) {
      if (!row) {
        this.selectedPilotId = null
        return
      }
      this.selectedPilotId = row.id ?? row.uid ?? null
    },

    clearSelectedPilot() {
      this.selectedPilotId = null
    },
  },
})
