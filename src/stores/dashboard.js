import { defineStore } from 'pinia'
import { auth } from 'boot/firebase'
import { API_URL } from '../config/api.js'

export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    telemetry: null,
    loading: false,
    error: null,
  }),

  getters: {
    currentPhase: (state) => {
      const t = state.telemetry || {}
      const phase = t.phase || t.currentPhase || t.phase_name || null
      const day = t.phaseDay || t.currentPhaseDay || t.day || null
      const length = t.cycleLength || t.phaseLength || 28

      return {
        name: phase || 'Unknown',
        day: day != null ? Number(day) : null,
        length: Number(length) || 28,
      }
    },

    loadStatus: (state) => {
      const acwr = Number(state.telemetry?.acwr)
      if (!Number.isFinite(acwr)) return null
      if (acwr >= 1.5) return 'DANGER'
      if (acwr >= 1.3) return 'OVERREACHING'
      return 'OPTIMAL'
    },
  },

  actions: {
    async fetchUserDashboard() {
      this.loading = true
      this.error = null

      try {
        const user = auth.currentUser
        if (!user) {
          throw new Error('Geen ingelogde gebruiker')
        }

        const uid = user.uid
        const token = await user.getIdToken?.()

        const headers = token
          ? {
              Authorization: `Bearer ${token}`,
              'X-User-Uid': uid,
            }
          : {
              'X-User-Uid': uid,
            }

        const res = await fetch(`${API_URL}/api/dashboard`, {
          method: 'GET',
          headers,
        })

        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Dashboard data ophalen mislukt')
        }

        const json = await res.json()
        const data = json?.data || json

        this.telemetry = {
          acwr: data.acwr ?? data.ACWR ?? null,
          phase: data.phase || data.current_phase || null,
          phaseDay: data.phaseDay ?? data.current_phase_day ?? null,
          phaseLength: data.phaseLength ?? data.cycle_length ?? 28,
          readinessToday: data.readiness_today ?? data.readiness ?? null,
          activities: data.recent_activities || data.activities || [],
          raw: data,
        }
      } catch (err) {
        console.error('fetchUserDashboard failed', err)
        this.error = err?.message || 'Dashboard ophalen mislukt'
        throw err
      } finally {
        this.loading = false
      }
    },
  },
})

