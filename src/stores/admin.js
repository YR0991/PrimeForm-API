import { defineStore } from 'pinia'
import { db } from 'boot/firebase'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'

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
      if (!userId || !teamId) {
        throw new Error('userId and teamId are required')
      }

      try {
        const userRef = doc(db, USERS_COLLECTION, userId)
        await updateDoc(userRef, { teamId })

        const user = this.users.find((u) => u.id === userId)
        if (user) {
          user.teamId = teamId
        }
      } catch (err) {
        console.error('AdminStore: failed to assign user to team', err)
        throw err
      }
    },
  },
})

