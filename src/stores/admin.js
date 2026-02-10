import { defineStore } from 'pinia'
import { db } from 'boot/firebase'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import {
  deleteUser as deleteUserApi,
  renameTeam as renameTeamApi,
  deleteTeam as deleteTeamApi,
} from '../services/adminService'

const USERS_COLLECTION = 'users'
const TEAMS_COLLECTION = 'teams'

export const useAdminStore = defineStore('admin', {
  state: () => ({
    users: [],
    teams: [],
    loading: false,
  }),

  getters: {
    totalUsers: (state) => state.users.length,
    totalTeams: (state) => state.teams.length,
    orphanedUsers: (state) => state.users.filter((u) => !u.teamId),
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
        const usersRef = collection(db, USERS_COLLECTION)
        const teamsRef = collection(db, TEAMS_COLLECTION)

        const [usersSnap, teamsSnap] = await Promise.all([getDocs(usersRef), getDocs(teamsRef)])

        this.users = usersSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }))

        this.teams = teamsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }))
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
        const userRef = doc(db, USERS_COLLECTION, userId)
        await updateDoc(userRef, { teamId: teamId ?? null })

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

