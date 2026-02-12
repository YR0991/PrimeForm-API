import { defineStore } from 'pinia'
import { auth } from 'boot/firebase'
import { API_URL } from '../config/api.js'
import { updateUserStats } from '../services/telemetryService'
import { useAuthStore } from './auth'
import { watch } from 'vue'

export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    telemetry: null,
    loading: false,
    syncing: false,
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
    _ensureActiveUidWatcher() {
      if (this._uidWatcherStop) {
        return
      }
      const authStore = useAuthStore()
      this._uidWatcherStop = watch(
        () => authStore.activeUid,
        (newUid, oldUid) => {
          if (!newUid || newUid === oldUid) return
          // Refetch dashboard data whenever the active athlete changes (Shadow Mode)
          this.fetchUserDashboard().catch(() => {
            // error is stored in state; UI remains graceful
          })
        }
      )
    },

    async fetchUserDashboard() {
      this.loading = true
      this.error = null

      try {
        this._ensureActiveUidWatcher()
        const authStore = useAuthStore()
        const user = auth.currentUser
        if (!user) {
          throw new Error('Geen ingelogde gebruiker')
        }

        const uid = authStore.activeUid || user.uid
        console.log('Dashboard fetch for UID:', uid)
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

        const raw = { ...data }
        if (data.todayLog) {
          const tl = data.todayLog
          raw.last_checkin = {
            readiness: tl.metrics?.readiness ?? null,
            hrv: tl.metrics?.hrv ?? null,
            rhr: tl.metrics?.rhr ?? null,
            sleep: tl.metrics?.sleep ?? null,
            date: new Date().toISOString().slice(0, 10),
          }
          const status = tl.recommendation?.status ?? null
          raw.last_directive = {
            status,
            aiMessage: tl.aiMessage ?? null,
            cycleInfo: tl.cycleInfo ?? null,
          }
        }

        this.telemetry = {
          acwr: data.acwr ?? data.ACWR ?? null,
          phase: data.phase || data.current_phase || null,
          phaseDay: data.phaseDay ?? data.current_phase_day ?? null,
          phaseLength: data.phaseLength ?? data.cycle_length ?? 28,
          readinessToday: data.readiness_today ?? data.readiness ?? null,
          activities: data.recent_activities || data.activities || [],
          raw,
        }
      } catch (err) {
        console.error('fetchUserDashboard failed', err)
        this.error = err?.message || 'Dashboard ophalen mislukt'
        throw err
      } finally {
        this.loading = false
      }
    },

    async syncStrava() {
      const authStore = useAuthStore()
      const user = auth.currentUser
      if (!user) {
        throw new Error('Geen ingelogde gebruiker')
      }
      this.syncing = true
      this.error = null
      try {
        const token = await user.getIdToken?.()
        const uid = authStore.activeUid || user.uid
        const headers = token
          ? { Authorization: `Bearer ${token}`, 'X-User-Uid': uid }
          : { 'X-User-Uid': uid }
        const res = await fetch(`${API_URL}/api/strava/sync/${uid}`, {
          method: 'GET',
          headers,
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || 'Strava sync mislukt')
        }
        await this.fetchUserDashboard()
      } finally {
        this.syncing = false
      }
    },

    async injectManualSession({ duration, rpe, date }) {
      const authStore = useAuthStore()
      const user = auth.currentUser
      if (!user) {
        throw new Error('Geen ingelogde gebruiker')
      }

      const durationMinutes = Number(duration)
      const rpeValue = Number(rpe)

      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        throw new Error('Ongeldige duur')
      }
      if (!Number.isFinite(rpeValue) || rpeValue < 1 || rpeValue > 10) {
        throw new Error('Ongeldige RPE')
      }

      const uid = authStore.activeUid || user.uid
      const dateIso = date && typeof date === 'string' ? date : new Date().toISOString()

      const res = await fetch(`${API_URL}/api/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: uid,
          type: 'Manual Session',
          duration: durationMinutes,
          rpe: rpeValue,
          date: dateIso,
        }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err = new Error(text || 'Activiteit opslaan mislukt')
        throw err
      }

      const json = await res.json()
      const data = json?.data || {}

      // Optimistic local update so the cockpit feed reflects the injection immediately
      if (this.telemetry) {
        const existing = Array.isArray(this.telemetry.activities)
          ? this.telemetry.activities
          : []
        this.telemetry = {
          ...this.telemetry,
          activities: [
            {
              id: data.id,
              type: data.type,
              duration_minutes: data.duration_minutes,
              rpe: data.rpe,
              prime_load: data.prime_load,
              date: data.date,
              start_date: data.date,
              start_date_local: data.date,
              moving_time: (data.duration_minutes || 0) * 60,
            },
            ...existing,
          ],
        }
      }

      updateUserStats(uid).catch((err) =>
        console.warn('updateUserStats after manual workout:', err)
      )

      return data
    },

    /**
     * Submit Daily Check-in: full directive flow (sleep, menstruation, sick/Handrem).
     * Backend returns status, aiMessage, cycleInfo; we store them for the Pre-Race card.
     */
    async submitDailyCheckIn({ readiness, hrv, rhr, sleep = 8, menstruationStarted = false, isSick = false }) {
      const authStore = useAuthStore()
      const user = auth.currentUser
      if (!user) {
        throw new Error('Geen ingelogde gebruiker')
      }

      const readinessVal = Number(readiness)
      const hrvVal = Number(hrv)
      const rhrVal = Number(rhr)
      const sleepVal = Number(sleep)

      if (!Number.isFinite(readinessVal) || readinessVal < 1 || readinessVal > 10) {
        throw new Error('Readiness moet tussen 1 en 10 liggen')
      }
      if (!Number.isFinite(hrvVal) || hrvVal <= 0) {
        throw new Error('Ongeldige HRV-waarde')
      }
      if (!Number.isFinite(rhrVal) || rhrVal <= 0) {
        throw new Error('Ongeldige RHR-waarde')
      }
      if (!Number.isFinite(sleepVal) || sleepVal < 3 || sleepVal > 12) {
        throw new Error('Slaap moet tussen 3 en 12 uur liggen')
      }

      const profile = authStore.profile || {}
      const todayIso = new Date().toISOString().slice(0, 10)

      const lastPeriodDate =
        profile.lastPeriodDate ||
        profile.lastPeriod ||
        profile.cycleData?.lastPeriodDate ||
        profile.cycleData?.lastPeriod ||
        todayIso

      const cycleLength =
        Number(profile.cycleLength) ||
        Number(profile.avgDuration) ||
        Number(profile.cycleData?.avgDuration) ||
        28

      const rhrBaseline = rhrVal
      const hrvBaseline = hrvVal

      const body = {
        userId: authStore.activeUid || user.uid,
        lastPeriodDate,
        cycleLength,
        sleep: sleepVal,
        rhr: rhrVal,
        rhrBaseline,
        hrv: hrvVal,
        hrvBaseline,
        readiness: readinessVal,
        menstruationStarted: Boolean(menstruationStarted),
        isSick: Boolean(isSick),
      }

      const res = await fetch(`${API_URL}/api/save-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || 'Daily check-in opslaan mislukt')
      }

      const json = await res.json().catch(() => ({}))
      const data = json?.data || {}

      this.telemetry = {
        ...(this.telemetry || {}),
        readinessToday: readinessVal,
        ...(data.cycleInfo && {
          phase: data.cycleInfo.phase,
          phaseDay: data.cycleInfo.currentCycleDay,
          phaseLength: data.cycleInfo.cycleLength,
          current_phase: data.cycleInfo.phase,
          current_phase_day: data.cycleInfo.currentCycleDay,
          cycle_length: data.cycleInfo.cycleLength,
        }),
        raw: {
          ...(this.telemetry?.raw || {}),
          last_checkin: {
            readiness: readinessVal,
            hrv: hrvVal,
            rhr: rhrVal,
            sleep: sleepVal,
            date: data.date || todayIso,
          },
          last_directive: {
            status: data.status || null,
            aiMessage: data.aiMessage || null,
            cycleInfo: data.cycleInfo || null,
          },
        },
      }

      if (menstruationStarted) {
        await authStore.fetchUserProfile(authStore.activeUid || user.uid)
      }

      updateUserStats(authStore.activeUid || user.uid).catch((err) =>
        console.warn('updateUserStats after check-in:', err)
      )

      return data
    },
  },
})

