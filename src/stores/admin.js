import { defineStore } from 'pinia'
import {
  fetchAllUsers,
  fetchAllTeams,
  assignUserToTeam as assignUserToTeamApi,
  deleteUser as deleteUserApi,
  renameTeam as renameTeamApi,
  deleteTeam as deleteTeamApi,
} from '../services/adminService'

export const useAdminStore = defineStore('admin', {
  state: () => ({
    users: [],
    teams: [],
    loading: false,
  }),

  getters: {
    totalUsers: (state) => state.users.length,
    totalTeams: (state) => state.teams.length,
    orphanedUsers: (state) =>
      state.users.filter((u) => {
        const role = u.profile?.role ?? u.role ?? 'user'
        return !u.teamId && role !== 'admin' && role !== 'coach'
      }),
    systemCapacity: (state) =>
      state.teams.reduce((sum, team) => {
        const limit = Number(team.memberLimit)
        return sum + (Number.isFinite(limit) && limit > 0 ? limit : 0)
      }, 0),
  },

  actions: {
    async fetchAllData() {
      this.loading = true
      try {
        const [users, teams] = await Promise.all([fetchAllUsers(), fetchAllTeams()])
        this.users = Array.isArray(users) ? users.map((u) => ({ id: u.id ?? u.userId, ...u })) : []
        this.teams = Array.isArray(teams) ? teams.map((t) => ({ id: t.id, ...t })) : []
      } catch (err) {
        console.error('AdminStore: failed to fetch all data', err)
        throw err
      } finally {
        this.loading = false
      }
    },

    async assignUserToTeam(userId, teamId) {
      if (!userId) {
        throw new Error('userId is required')
      }
      try {
        await assignUserToTeamApi(userId, teamId ?? null)
        const user = this.users.find((u) => u.id === userId)
        if (user) {
          user.teamId = teamId ?? null
        }
      } catch (err) {
        console.error('AdminStore: failed to assign user to team', err)
        throw err
      }
    },

    async deleteUser(userId) {
      if (!userId) {
        throw new Error('userId is required')
      }
      try {
        await deleteUserApi(userId)
        this.users = this.users.filter((u) => u.id !== userId)
      } catch (err) {
        console.error('AdminStore: failed to delete user', err)
        throw err
      }
    },

    async renameTeam(teamId, newName) {
      if (!teamId) {
        throw new Error('teamId is required')
      }
      const name = (newName || '').trim()
      if (!name) {
        throw new Error('Nieuwe teamnaam is leeg')
      }
      try {
        await renameTeamApi(teamId, name)
        this.teams = this.teams.map((t) =>
          t.id === teamId
            ? {
                ...t,
                name,
              }
            : t
        )
      } catch (err) {
        console.error('AdminStore: failed to rename team', err)
        throw err
      }
    },

    async deleteTeam(teamId) {
      if (!teamId) {
        throw new Error('teamId is required')
      }
      try {
        await deleteTeamApi(teamId)
        // Remove team locally
        this.teams = this.teams.filter((t) => t.id !== teamId)
        // Orphan local users for immediate UI feedback
        this.users = this.users.map((u) =>
          u.teamId === teamId
            ? {
                ...u,
                teamId: null,
              }
            : u
        )
      } catch (err) {
        console.error('AdminStore: failed to delete team', err)
        throw err
      }
    },
  },
})

