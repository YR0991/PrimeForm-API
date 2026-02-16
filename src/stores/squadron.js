import { defineStore } from 'pinia'
import { useAuthStore } from './auth'
import { getCoachSquad, getAthleteDetail } from '../services/coachService'
import { getLiveLoadMetrics } from '../services/adminService'

/**
 * Squadron store — Backend-First. Storage only; no metric calculations.
 * State: athletesById (dict). Data stored exactly as the API sends.
 */
export const useSquadronStore = defineStore('squadron', {
  state: () => ({
    athletesById: {},
    loading: false,
    error: null,
    selectedAtleetId: null,
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
    selectedAtleet(state) {
      if (!state.selectedAtleetId) return null
      return state.athletesById[state.selectedAtleetId] ?? null
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

        const list = await getCoachSquad()
        if (!Array.isArray(list)) {
          this.error = 'Invalid squadron response'
          throw new Error('Invalid squadron response')
        }
        const filtered = list.filter((row) => row.teamId === teamId)

        const nextById = {}
        for (const athlete of filtered) {
          const id = athlete.id ?? athlete.uid
          if (!id) continue
          // Preserve full API response; only fill name/profile/metrics when missing (never overwrite with empty)
          const name = athlete.name ?? athlete.profile?.fullName ?? athlete.displayName ?? (athlete.email ? athlete.email.split('@')[0] : null)
          const profile = {
            fullName: athlete.profile?.fullName ?? athlete.name ?? athlete.displayName ?? null,
            firstName: athlete.profile?.firstName ?? null,
            lastName: athlete.profile?.lastName ?? null,
            avatar: athlete.profile?.avatar ?? athlete.avatar ?? null,
          }
          const metrics = {
            acwr: athlete.metrics?.acwr ?? athlete.acwr ?? null,
            acuteLoad: athlete.metrics?.acuteLoad ?? athlete.acuteLoad ?? null,
            chronicLoad: athlete.metrics?.chronicLoad ?? athlete.chronicLoad ?? null,
            form: athlete.metrics?.form ?? athlete.form ?? null,
            cyclePhase: athlete.metrics?.cyclePhase ?? athlete.cyclePhase ?? null,
            cycleDay: athlete.metrics?.cycleDay ?? athlete.cycleDay ?? null,
            readiness: athlete.metrics?.readiness ?? athlete.readiness ?? null,
          }
          const metricsMeta = athlete.metricsMeta ?? { loadMetricsStale: true }
          nextById[id] = { ...athlete, id, name, profile, metrics, metricsMeta }
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
        this.selectedAtleetId = null
        return
      }

      this.deepDiveLoading = true
      this.selectedAtleetId = id

      try {
        const data = await getAthleteDetail(id)
        const existing = this.athletesById[id]
        this.athletesById = {
          ...this.athletesById,
          [id]: { ...existing, ...data },
        }
      } catch (err) {
        console.error('SquadronStore: fetchAthleteDeepDive failed', err)
        this.selectedAtleetId = null
        throw err
      } finally {
        this.deepDiveLoading = false
      }
    },

    async fetchAtleetDeepDive(atleetId) {
      return this.fetchAthleteDeepDive(atleetId)
    },

    setSelectedAtleetFromRow(row) {
      if (!row) {
        this.selectedAtleetId = null
        return
      }
      this.selectedAtleetId = row.id ?? row.uid ?? null
    },

    clearSelectedAtleet() {
      this.selectedAtleetId = null
    },

    /**
     * Refresh live load metrics for one athlete; updates row.metrics.acwr and metricsMeta (stale=false).
     * Calls GET /api/admin/users/:uid/live-load-metrics?days=28 and merges result into athletesById.
     */
    async refreshLiveLoadMetrics(athleteId) {
      if (!athleteId) return
      try {
        const data = await getLiveLoadMetrics(athleteId, 28)
        if (!data || !data.success) return
        const existing = this.athletesById[athleteId]
        if (!existing) return
        const now = Date.now()
        this.athletesById = {
          ...this.athletesById,
          [athleteId]: {
            ...existing,
            metrics: {
              ...existing.metrics,
              acwr: data.acwr ?? existing.metrics?.acwr ?? null,
            },
            metricsMeta: {
              ...(existing.metricsMeta || {}),
              loadMetricsStale: false,
              loadMetricsComputedAt: now,
              loadMetricsWindowDays: data.windowDays ?? 28,
            },
          },
        }
      } catch (err) {
        console.error('SquadronStore: refreshLiveLoadMetrics failed', err)
        throw err
      }
    },
  },
})
