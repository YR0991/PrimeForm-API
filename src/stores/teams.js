import { defineStore } from 'pinia'
import { fetchAllTeams, createTeam as createTeamApi } from '../services/adminService'

export const useTeamsStore = defineStore('teams', {
  state: () => ({
    teams: [],
    loading: false,
  }),

  actions: {
    async fetchTeams() {
      this.loading = true
      try {
        const list = await fetchAllTeams()
        this.teams = Array.isArray(list) ? list.map((t) => ({ id: t.id, ...t })) : []
      } catch (err) {
        console.error('Failed to fetch teams', err)
        throw err
      } finally {
        this.loading = false
      }
    },

    async createTeam(payload) {
      const { name, coachEmail, memberLimit } = payload || {}
      if (!name) {
        throw new Error('Team name is required')
      }

      this.loading = true
      try {
        const { id } = await createTeamApi({ name, coachEmail, memberLimit })
        const list = await fetchAllTeams()
        this.teams = Array.isArray(list) ? list.map((t) => ({ id: t.id, ...t })) : []
        return id
      } catch (err) {
        console.error('Failed to create team', err)
        throw err
      } finally {
        this.loading = false
      }
    },
  },
})

