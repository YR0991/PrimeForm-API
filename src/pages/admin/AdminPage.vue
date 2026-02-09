<template>
  <q-page class="admin-page">
    <!-- Simple admin gate -->
    <div v-if="!isAdminAuthenticated" class="admin-container q-pa-lg">
      <q-card class="admin-login-card" flat dark>
        <q-card-section>
          <div class="text-h6 q-mb-md">Super Admin Access</div>
          <p class="text-body2 text-grey q-mb-md">
            Voer je beheerder e-mailadres in om Mission Control te openen.
          </p>
          <q-input
            v-model="adminEmailInput"
            type="email"
            label="E-mailadres"
            outlined
            dark
            class="q-mb-md"
            :error="!!adminLoginError"
            :error-message="adminLoginError"
            @keyup.enter="submitAdminLogin"
          />
          <div class="row q-gutter-sm">
            <q-btn color="primary" label="Toegang" @click="submitAdminLogin" />
            <q-btn flat label="Terug naar app" to="/" />
          </div>
        </q-card-section>
      </q-card>
    </div>

    <div v-else class="admin-container">
      <!-- Header -->
      <div class="admin-header">
        <div>
          <div class="admin-title">SUPER ADMIN • MISSION CONTROL</div>
          <div class="admin-subtitle">
            Global Telemetry • Squadrons • Pilots
          </div>
        </div>
        <q-btn
          flat
          round
          icon="refresh"
          color="white"
          :loading="adminStore.loading"
          @click="adminStore.fetchAllData"
        />
      </div>

      <!-- KPI Row -->
      <div class="kpi-grid q-mb-lg">
        <q-card class="kpi-card" flat>
          <q-card-section>
            <div class="kpi-label">TOTAL SQUADRONS</div>
            <div class="kpi-value">{{ adminStore.totalTeams }}</div>
          </q-card-section>
        </q-card>

        <q-card class="kpi-card" flat>
          <q-card-section>
            <div class="kpi-label">ACTIVE PILOTS</div>
            <div class="kpi-value">{{ adminStore.totalUsers }}</div>
          </q-card-section>
        </q-card>

        <q-card class="kpi-card" flat>
          <q-card-section>
            <div class="kpi-label">SYSTEM LOAD</div>
            <div class="kpi-value">
              <span v-if="systemCapacity > 0">
                {{ systemLoadPercent.toFixed(0) }}%
              </span>
              <span v-else>—</span>
            </div>
            <div class="kpi-caption" v-if="systemCapacity > 0">
              {{ adminStore.totalUsers }} / {{ systemCapacity }} pilots
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Ghost Grid: Orphaned Users -->
      <q-card
        v-if="orphanedUsers.length > 0"
        class="ghost-card q-mb-lg"
        flat
      >
        <q-card-section>
          <div class="ghost-header row items-center justify-between q-mb-md">
            <div>
              <div class="ghost-title">
                ⚠️ UNASSIGNED PILOTS (ACTION REQUIRED)
              </div>
              <div class="ghost-subtitle">
                Pilots without a Constructor assignment are invisible to squad telemetry.
              </div>
            </div>
            <div class="ghost-count">
              {{ orphanedUsers.length }}
            </div>
          </div>

          <q-table
            :rows="orphanedUsers"
            :columns="ghostColumns"
            :row-key="(row) => row.id"
            flat
            dark
            dense
            class="ghost-table"
            :loading="adminStore.loading"
            :rows-per-page-options="[5, 10, 25]"
          >
            <template #body-cell-joinedAt="props">
              <q-td :props="props">
                {{ formatJoinedAt(props.row) }}
              </q-td>
            </template>

            <template #body-cell-team="props">
              <q-td :props="props">
                <q-select
                  v-model="userAssignments[props.row.id]"
                  :options="teamOptions"
                  emit-value
                  map-options
                  dense
                  outlined
                  dark
                  options-dense
                  placeholder="Assign Squad"
                  @update:model-value="(val) => onAssignTeam(props.row.id, val)"
                />
              </q-td>
            </template>

            <template #no-data>
              <div class="text-grey text-caption q-pa-md">
                All pilots are assigned. No ghosts in the system.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- Constructor Configuration -->
      <q-card class="teams-card" flat>
        <q-card-section class="row items-center justify-between">
          <div class="teams-header">
            <div class="teams-title">CONSTRUCTOR CONFIGURATION</div>
            <div class="teams-subtitle">
              Active Squadrons • Coaches • Codes • Occupancy
            </div>
          </div>
          <q-btn
            class="new-team-btn"
            color="primary"
            outline
            no-caps
            :loading="teamsLoading"
            @click="openTeamDialog"
          >
            [+] DEPLOY NEW TEAM
          </q-btn>
        </q-card-section>

        <q-card-section>
          <q-table
            :rows="teamsWithOccupancy"
            :columns="teamColumns"
            row-key="id"
            flat
            dark
            :loading="adminStore.loading || teamsLoading"
            :rows-per-page-options="[5, 10, 25]"
            class="teams-table"
          >
            <template #body-cell-inviteCode="props">
              <q-td :props="props">
                <span class="team-code">{{ props.row.inviteCode || '—' }}</span>
                <q-btn
                  v-if="props.row.inviteCode"
                  flat
                  dense
                  round
                  icon="content_copy"
                  size="sm"
                  class="q-ml-xs"
                  @click="copyTeamInvite(props.row.inviteCode)"
                >
                  <q-tooltip>Copy invite code</q-tooltip>
                </q-btn>
              </q-td>
            </template>

            <template #body-cell-occupancy="props">
              <q-td :props="props">
                <div class="row items-center no-wrap">
                  <q-linear-progress
                    :value="props.row.occupancyRatio"
                    :color="occupancyColor(props.row.occupancyRatio)"
                    class="flex-grow-1 q-mr-sm"
                    track-color="rgba(255,255,255,0.12)"
                  />
                  <div class="occupancy-label">
                    {{ props.row.memberCount }}/{{ props.row.memberLimit || '∞' }}
                  </div>
                </div>
              </q-td>
            </template>

            <template #no-data>
              <div class="text-grey text-caption q-pa-md">
                Nog geen teams geregistreerd. Gebruik de knop
                <span class="text-white">DEPLOY NEW TEAM</span>
                om een eerste squadron te activeren.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- Team dialog (existing logic) -->
      <q-dialog v-model="teamDialogOpen" persistent>
        <q-card class="user-dialog-card" dark style="min-width: 360px">
          <q-card-section>
            <div class="text-h6">Nieuw Team</div>
            <div class="text-caption text-grey q-mt-xs">
              Koppel een coach en stel een limiet voor leden in.
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <q-input
              v-model="teamForm.name"
              label="Teamnaam"
              outlined
              dark
              class="q-mb-md"
            />
            <q-input
              v-model="teamForm.coachEmail"
              label="Coach e-mail"
              type="email"
              outlined
              dark
              class="q-mb-md"
            />
            <q-input
              v-model.number="teamForm.memberLimit"
              label="Max leden (default 10)"
              type="number"
              outlined
              dark
              class="q-mb-md"
            />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Annuleren" :disable="teamsLoading" v-close-popup />
            <q-btn
              label="Bevestigen"
              color="primary"
              :loading="teamsLoading"
              @click="submitTeam"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Notify, copyToClipboard } from 'quasar'
import { useTeamsStore } from '../../stores/teams'
import { useAdminStore } from '../../stores/admin'

const ADMIN_EMAIL = 'yoramroemersma50@gmail.com'

const adminStore = useAdminStore()

const isAdminAuthenticated = ref(false)
const adminEmailInput = ref('')
const adminLoginError = ref('')

// Team creation (reuse existing logic)
const teamsStore = useTeamsStore()
const teamDialogOpen = ref(false)
const teamForm = ref({
  name: '',
  coachEmail: '',
  memberLimit: 10,
})

const teamsLoading = computed(() => teamsStore.loading)

const resetTeamForm = () => {
  teamForm.value = {
    name: '',
    coachEmail: '',
    memberLimit: 10,
  }
}

const openTeamDialog = () => {
  resetTeamForm()
  teamDialogOpen.value = true
}

const submitTeam = async () => {
  if (!teamForm.value.name) {
    Notify.create({
      type: 'negative',
      message: 'Teamnaam is verplicht.',
    })
    return
  }

  try {
    await teamsStore.createTeam({
      name: teamForm.value.name,
      coachEmail: teamForm.value.coachEmail || null,
      memberLimit: teamForm.value.memberLimit ?? 10,
    })

    // Refresh Admin telemetry
    await adminStore.fetchAllData()

    Notify.create({
      type: 'positive',
      message: 'Team aangemaakt.',
    })

    teamDialogOpen.value = false
  } catch (error) {
    console.error('Failed to create team:', error)
    Notify.create({
      type: 'negative',
      message: error?.message || 'Team aanmaken mislukt.',
    })
  }
}

const copyTeamInvite = (code) => {
  if (!code) return
  copyToClipboard(code)
    .then(() => {
      Notify.create({
        type: 'positive',
        message: 'Invite code gekopieerd.',
      })
    })
    .catch(() => {
      Notify.create({
        type: 'negative',
        message: 'Kopiëren van invite code mislukt.',
      })
    })
}

// Firestore timestamp helper
const toDateFromFirestore = (value) => {
  if (!value) return null

  if (typeof value.toDate === 'function') {
    const d = value.toDate()
    return isNaN(d.getTime()) ? null : d
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }

  if (typeof value === 'object') {
    const seconds = value._seconds ?? value.seconds
    const nanos = value._nanoseconds ?? value.nanoseconds ?? 0

    if (typeof seconds === 'number') {
      const millis = seconds * 1000 + nanos / 1e6
      const d = new Date(millis)
      return isNaN(d.getTime()) ? null : d
    }
  }

  return null
}

// Ghost Grid data
const orphanedUsers = computed(() => adminStore.orphanedUsers || [])

const formatJoinedAt = (user) => {
  const raw = user.createdAt || user.joinedAt
  const date = toDateFromFirestore(raw)
  if (!date) return '—'
  return date.toLocaleDateString('nl-NL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

const ghostColumns = [
  {
    name: 'email',
    label: 'Email',
    field: (row) => row.email || row.profile?.email || '—',
    align: 'left',
    sortable: true,
  },
  {
    name: 'name',
    label: 'Name',
    field: (row) => row.displayName || row.profile?.fullName || '—',
    align: 'left',
    sortable: true,
  },
  {
    name: 'joinedAt',
    label: 'Joined',
    field: () => '',
    align: 'left',
    sortable: false,
  },
  {
    name: 'team',
    label: 'Assign Squad',
    field: () => '',
    align: 'right',
  },
]

// Local select state for assignments
const userAssignments = ref({})

const teamOptions = computed(() =>
  (adminStore.teams || []).map((team) => ({
    label: team.name || 'Unnamed Squad',
    value: team.id,
  })),
)

const onAssignTeam = async (userId, teamId) => {
  if (!userId || !teamId) return
  try {
    await adminStore.assignUserToTeam(userId, teamId)
    Notify.create({
      type: 'positive',
      message: 'Pilot assigned to squad.',
    })
  } catch (err) {
    console.error('Failed to assign user to team', err)
    Notify.create({
      type: 'negative',
      message: err?.message || 'Toewijzen mislukt.',
    })
  }
}

// Teams telemetry
const teamsWithOccupancy = computed(() => {
  const users = adminStore.users || []
  const teams = adminStore.teams || []

  return teams.map((team) => {
    const limit = Number(team.memberLimit)
    const memberLimit = Number.isFinite(limit) && limit > 0 ? limit : null
    const memberCount = users.filter((u) => u.teamId === team.id).length
    const occupancyRatio =
      memberLimit && memberLimit > 0 ? Math.min(memberCount / memberLimit, 1) : 0

    return {
      ...team,
      memberCount,
      memberLimit,
      occupancyRatio,
    }
  })
})

const teamColumns = [
  {
    name: 'name',
    label: 'Name',
    field: 'name',
    align: 'left',
    sortable: true,
  },
  {
    name: 'coachEmail',
    label: 'Coach Email',
    field: (row) => row.coachEmail || '—',
    align: 'left',
    sortable: true,
  },
  {
    name: 'inviteCode',
    label: 'Invite Code',
    field: 'inviteCode',
    align: 'left',
    sortable: true,
  },
  {
    name: 'occupancy',
    label: 'Occupancy',
    field: () => '',
    align: 'right',
  },
]

const occupancyColor = (ratio) => {
  if (!Number.isFinite(ratio)) return 'grey-7'
  if (ratio >= 1) return 'negative' // 100%+
  if (ratio >= 0.8) return 'orange-5' // >80%
  return 'positive' // <80%
}

// KPIs
const systemCapacity = computed(() => adminStore.systemCapacity || 0)
const systemLoadPercent = computed(() => {
  if (!systemCapacity.value) return 0
  return (adminStore.totalUsers / systemCapacity.value) * 100
})

// Admin auth
const checkAdminAuth = () => {
  const stored = (localStorage.getItem('admin_email') || '').trim()
  isAdminAuthenticated.value = stored === ADMIN_EMAIL
  if (isAdminAuthenticated.value) {
    adminEmailInput.value = stored
  }
}

const submitAdminLogin = () => {
  adminLoginError.value = ''
  const email = adminEmailInput.value.trim()
  if (!email) {
    adminLoginError.value = 'Voer een e-mailadres in.'
    return
  }
  if (email !== ADMIN_EMAIL) {
    adminLoginError.value = 'Geen toegang. Alleen beheerders hebben toegang.'
    return
  }
  localStorage.setItem('admin_email', email)
  isAdminAuthenticated.value = true
  adminStore.fetchAllData()
}

onMounted(() => {
  checkAdminAuth()
  if (isAdminAuthenticated.value) {
    adminStore.fetchAllData()
  }
})
</script>

<style scoped lang="scss">
.admin-page {
  background: #050505;
  min-height: 100vh;
  padding: 24px;
}

.admin-container {
  max-width: 1440px;
  margin: 0 auto;
}

.admin-login-card {
  max-width: 420px;
  margin: 0 auto;
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.admin-title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 900;
  font-style: italic;
  color: #fbbf24;
  font-size: 1.4rem;
  margin: 0;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.admin-subtitle {
  margin-top: 4px;
  font-size: 0.8rem;
  color: rgba(156, 163, 175, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  grid-auto-rows: 1fr;
  gap: 16px;
}

.kpi-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.kpi-label {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(156, 163, 175, 0.9);
  margin-bottom: 8px;
}

.kpi-value {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 2.4rem;
  font-weight: 800;
  color: #fbbf24;
  line-height: 1.1;
}

.kpi-caption {
  margin-top: 8px;
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.ghost-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(239, 68, 68, 0.7) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.ghost-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 8px;
}

.ghost-title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.85rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #fbbf24;
}

.ghost-subtitle {
  margin-top: 4px;
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
}

.ghost-count {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 1.6rem;
  font-weight: 800;
  color: #ef4444;
}

.ghost-table :deep(.q-table thead tr th) {
  background: rgba(255, 255, 255, 0.04) !important;
  color: rgba(255, 255, 255, 0.9) !important;
  font-weight: 600;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.ghost-table :deep(.q-table tbody tr) {
  background: rgba(255, 255, 255, 0.02) !important;
}

.ghost-table :deep(.q-table tbody tr:hover) {
  background: rgba(255, 255, 255, 0.05) !important;
}

.ghost-table :deep(.q-table tbody td) {
  color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.teams-card {
  margin-top: 8px;
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.teams-header {
  display: flex;
  flex-direction: column;
}

.teams-title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.9rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #fbbf24;
}

.teams-subtitle {
  margin-top: 4px;
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
}

.new-team-btn {
  border-radius: 2px !important;
  border-width: 1px;
  border-color: #fbbf24;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.teams-table :deep(.q-table thead tr th) {
  background: rgba(255, 255, 255, 0.04) !important;
  color: rgba(255, 255, 255, 0.9) !important;
  font-weight: 600;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.teams-table :deep(.q-table tbody tr) {
  background: rgba(255, 255, 255, 0.02) !important;
}

.teams-table :deep(.q-table tbody tr:hover) {
  background: rgba(255, 255, 255, 0.05) !important;
}

.teams-table :deep(.q-table tbody td) {
  color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.team-code {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace !important;
}

.user-dialog-card {
  background: #050505 !important;
  color: #e5e5e5 !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.occupancy-label {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.9);
}
</style>

<template>
  <q-page class="admin-page">
    <!-- Geen geldig admin e-mail (bv. incognito): toon inlogformulier i.p.v. prompt() -->
    <div v-if="!isAdminAuthenticated" class="admin-container q-pa-lg">
      <q-card class="admin-login-card" flat dark>
        <q-card-section>
          <div class="text-h6 q-mb-md">Admin toegang</div>
          <p class="text-body2 text-grey q-mb-md">Voer je beheerder e-mailadres in om het dashboard te openen.</p>
          <q-input
            v-model="adminEmailInput"
            type="email"
            label="E-mailadres"
            outlined
            dark
            class="q-mb-md"
            :error="!!adminLoginError"
            :error-message="adminLoginError"
            @keyup.enter="submitAdminLogin"
          />
          <div class="row q-gutter-sm">
            <q-btn color="primary" label="Toegang" @click="submitAdminLogin" />
            <q-btn flat label="Naar dashboard" to="/dashboard" />
          </div>
        </q-card-section>
      </q-card>
    </div>

    <div v-else class="admin-container">
      <div class="admin-header">
        <h1 class="admin-title">Admin Dashboard</h1>
        <q-btn
          flat
          round
          icon="refresh"
          color="white"
          @click="loadUsers"
          :loading="loading"
        />
      </div>

      <q-banner v-if="adminLoadError" class="bg-negative text-white q-mb-md elite-banner">
        {{ adminLoadError }}
        <template #action>
          <q-btn flat dense label="Sluiten" @click="adminLoadError = ''" />
        </template>
      </q-banner>

      <!-- Statistics Cards -->
      <div class="stats-grid q-mb-lg">
        <q-card class="stat-card" flat>
          <q-card-section>
            <div class="stat-value">{{ stats.totalMembers }}</div>
            <div class="stat-label">Totaal Leden</div>
          </q-card-section>
        </q-card>

        <q-card class="stat-card" flat>
          <q-card-section>
            <div class="stat-value">{{ stats.newThisWeek }}</div>
            <div class="stat-label">Nieuw deze week</div>
          </q-card-section>
        </q-card>

        <q-card class="stat-card" flat>
          <q-card-section>
            <div class="stat-value">{{ stats.checkinsToday }}</div>
            <div class="stat-label">Check-ins vandaag</div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Attention: Alert Cards -->
      <div class="alerts-row q-mb-lg">
        <q-card class="alert-card missed-card" flat>
          <q-card-section>
            <div class="alert-title">
              <q-icon name="event_busy" size="sm" class="q-mr-sm" />
              Missed Check-ins
            </div>
            <div class="alert-count">{{ alerts.missed.length }}</div>
            <div class="alert-list">
              <template v-if="alerts.missed.length === 0">
                <span class="text-caption text-grey">Geen leden &gt;3 dagen inactief</span>
              </template>
              <template v-else>
                <q-btn
                  v-for="item in alerts.missed.slice(0, 5)"
                  :key="item.userId"
                  flat
                  dense
                  no-caps
                  class="alert-name-btn"
                  @click="openUserDialogByUserId(item.userId)"
                >
                  {{ item.fullName }}
                </q-btn>
                <span v-if="alerts.missed.length > 5" class="text-caption">+{{ alerts.missed.length - 5 }} meer</span>
              </template>
            </div>
          </q-card-section>
        </q-card>
        <q-card class="alert-card critical-card" flat>
          <q-card-section>
            <div class="alert-title">
              <q-icon name="warning" size="sm" class="q-mr-sm" />
              Critical Status
            </div>
            <div class="alert-count">{{ alerts.critical.length }}</div>
            <div class="alert-list">
              <template v-if="alerts.critical.length === 0">
                <span class="text-caption text-grey">Geen REST/RECOVER vandaag</span>
              </template>
              <template v-else>
                <q-btn
                  v-for="item in alerts.critical.slice(0, 5)"
                  :key="item.userId"
                  flat
                  dense
                  no-caps
                  class="alert-name-btn"
                  @click="openUserDialogByUserId(item.userId)"
                >
                  {{ item.fullName }} <span class="status-badge status-recover q-ml-xs">{{ item.status }}</span>
                </q-btn>
                <span v-if="alerts.critical.length > 5" class="text-caption">+{{ alerts.critical.length - 5 }} meer</span>
              </template>
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Users Table -->
      <q-card class="users-card" flat>
        <q-card-section>
          <div class="text-h6 q-mb-md">Gebruikers</div>
          
            <q-table
            :rows="users"
            :columns="columns"
            :row-key="row => row.id || row.userId"
            :loading="loading"
            :rows-per-page-options="[10, 25, 50]"
            flat
            dark
            class="admin-table"
          >
            <template v-slot:body-cell-actions="props">
              <q-td :props="props">
                <q-btn
                  flat
                  dense
                  round
                  icon="visibility"
                  color="primary"
                  @click="openUserDialog(props.row)"
                >
                  <q-tooltip>Bekijk details</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  dense
                  round
                  icon="sync"
                  :loading="syncingUserId === (props.row.id || props.row.userId)"
                  :disable="!!syncingUserId"
                  color="secondary"
                  @click="syncStravaForUser(props.row)"
                >
                  <q-tooltip>Sync Strava Historie</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  dense
                  round
                  icon="assessment"
                  color="secondary"
                  @click="openWeeklyReport(props.row)"
                >
                  <q-tooltip>Genereer Weekrapport</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  dense
                  round
                  icon="delete"
                  color="negative"
                  @click="confirmDeleteUser(props.row)"
                >
                  <q-tooltip>Gebruiker verwijderen</q-tooltip>
                </q-btn>
              </q-td>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- Team Management / Constructor Configuration -->
      <q-card class="teams-card q-mt-lg" flat>
        <q-card-section class="row items-center justify-between">
          <div class="teams-header">
            <div class="teams-title">CONSTRUCTOR CONFIGURATION</div>
            <div class="teams-subtitle">Active Squadrons • Coaches • Invite Codes</div>
          </div>
          <q-btn
            class="new-team-btn"
            color="primary"
            outline
            no-caps
            :loading="teamsLoading"
            @click="openTeamDialog"
          >
            [+] DEPLOY NEW TEAM
          </q-btn>
        </q-card-section>
        <q-card-section>
          <q-table
            :rows="teams"
            :columns="teamColumns"
            row-key="id"
            flat
            dark
            :loading="teamsLoading"
            :rows-per-page-options="[5, 10, 25]"
            class="teams-table"
          >
            <template #body-cell-inviteCode="props">
              <q-td :props="props">
                <span class="team-code">{{ props.row.inviteCode || '—' }}</span>
                <q-btn
                  v-if="props.row.inviteCode"
                  flat
                  dense
                  round
                  icon="content_copy"
                  size="sm"
                  class="q-ml-xs"
                  @click="copyTeamInvite(props.row.inviteCode)"
                >
                  <q-tooltip>Copy invite code</q-tooltip>
                </q-btn>
              </q-td>
            </template>
            <template #no-data>
              <div class="text-grey text-caption q-pa-md">
                Nog geen teams geregistreerd. Gebruik de knop <span class="text-white">NEW TEAM</span> om een eerste team aan te maken.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- Team dialog -->
      <q-dialog v-model="teamDialogOpen" persistent>
        <q-card class="user-dialog-card" dark style="min-width: 360px">
          <q-card-section>
            <div class="text-h6">Nieuw Team</div>
            <div class="text-caption text-grey q-mt-xs">
              Koppel een coach en stel een limiet voor leden in.
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <q-input
              v-model="teamForm.name"
              label="Teamnaam"
              outlined
              dark
              class="q-mb-md"
            />
            <q-input
              v-model="teamForm.coachEmail"
              label="Coach e-mail"
              type="email"
              outlined
              dark
              class="q-mb-md"
            />
            <q-input
              v-model.number="teamForm.memberLimit"
              label="Max leden (default 10)"
              type="number"
              outlined
              dark
              class="q-mb-md"
            />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Annuleren" :disable="teamsLoading" v-close-popup />
            <q-btn
              label="Bevestigen"
              color="primary"
              :loading="teamsLoading"
              @click="submitTeam"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Weekly Report Dialog -->
      <q-dialog v-model="weeklyReportOpen" maximized persistent>
        <q-card class="user-dialog-card" dark>
          <q-card-section class="row items-center q-pb-none">
            <div class="text-h6">Weekrapport — {{ weeklyReportUserName || 'Gebruiker' }}</div>
            <q-space />
            <q-btn flat round dense icon="close" v-close-popup />
          </q-card-section>
          <q-card-section v-if="weeklyReportLoading" class="flex flex-center">
            <q-spinner size="xl" color="primary" />
            <div class="q-mt-md">Rapport wordt gegenereerd...</div>
          </q-card-section>
          <q-card-section v-else class="row q-col-gutter-lg">
            <div class="col-12 col-md-4">
              <div class="text-subtitle1 q-mb-sm">Harde cijfers</div>
              <q-table
                :rows="weeklyReportStatsRows"
                :columns="weeklyReportStatsColumns"
                flat
                dark
                dense
                hide-pagination
                class="report-stats-table"
              >
                <template v-slot:body-cell-value="props">
                  <q-td :props="props">
                    <span
                      v-if="props.row.label === 'ACWR (Ratio)'"
                      :class="acwrInRange ? 'acwr-value acwr-green' : 'acwr-value acwr-orange'"
                    >
                      {{ props.row.value }}
                    </span>
                    <span v-else>{{ props.row.value }}</span>
                  </q-td>
                </template>
              </q-table>
            </div>
            <div class="col-12 col-md-8">
              <div class="text-subtitle1 q-mb-sm">Concepttekst (bewerkbaar)</div>
              <q-input
                v-model="weeklyReportMessage"
                type="textarea"
                outlined
                dark
                autogrow
                class="report-message-input"
                rows="12"
              />
              <div class="row q-gutter-sm q-mt-md">
                <q-btn color="primary" icon="content_copy" label="Kopieer naar klembord" @click="copyReportToClipboard" />
                <q-btn flat label="Sluiten" v-close-popup />
              </div>
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <div class="row items-center justify-between q-mb-sm">
              <div class="text-subtitle1">Activiteiten</div>
              <q-btn-toggle
                v-model="reportActivitiesTab"
                toggle-color="primary"
                :options="[
                  { label: 'Huidige Week', value: 'week' },
                  { label: 'Analyse (56d)', value: '56d' }
                ]"
                dense
                no-caps
              />
            </div>
            <q-table
              v-if="weeklyReportActivitiesForTable.length > 0"
              :rows="weeklyReportActivitiesForTable"
              :columns="weeklyReportActivityColumns"
              :row-key="(row, i) => row.date + '-' + i"
              flat
              dark
              dense
              :hide-pagination="reportActivitiesTab === 'week'"
              :pagination="reportActivitiesTab === '56d' ? { rowsPerPage: 20 } : undefined"
              class="report-activities-table"
            />
            <div v-else class="text-grey text-body2">Geen activiteiten gevonden in deze periode.</div>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- User Detail Dialog -->
      <q-dialog v-model="userDialogOpen" maximized>
        <q-card class="user-dialog-card" dark>
          <q-card-section class="row items-center q-pb-none">
            <div class="text-h6">Gebruiker Details</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>

          <q-card-section v-if="selectedUser">
            <div class="user-header q-mb-md row items-center justify-between">
              <div>
                <div class="text-h6">{{ selectedUser.profile?.fullName || 'Geen naam' }}</div>
                <div class="text-caption text-grey">{{ selectedUser.profile?.email || 'Geen e-mail' }}</div>
              </div>
              <div class="cycle-manager row items-center q-gutter-sm">
                <span class="text-caption text-grey">Cyclus:</span>
                <q-badge :label="`Dag ${cycleDisplay.day}`" color="primary" />
                <q-badge :label="cycleDisplay.phase" color="secondary" />
                <q-btn flat dense round size="sm" icon="edit" @click="openCycleEdit">
                  <q-tooltip>Cyclus bewerken</q-tooltip>
                </q-btn>
              </div>
            </div>

            <q-tabs v-model="dialogTab" align="left" dark active-color="#fbbf24">
              <q-tab name="trends" label="Trends" />
              <q-tab name="insights" label="Inzichten" />
              <q-tab name="intake" label="Intake" />
              <q-tab name="history" label="Historie" />
              <q-tab name="notes" label="Notities" />
              <q-tab name="import" label="Import Historie" />
            </q-tabs>

            <q-separator />

            <q-tab-panels v-model="dialogTab" animated dark>
              <!-- Trends Tab (HRV/RHR chart) -->
              <q-tab-panel name="trends">
                <div class="trends-panel">
                  <div class="card-label q-mb-sm">HRV & RHR • laatste 28 metingen</div>
                  <div v-if="!userHistory || userHistory.length === 0" class="text-grey text-center q-pa-lg">
                    Nog geen trenddata. Gebruik Import Historie of wacht op check-ins.
                  </div>
                  <div v-else class="apex-wrap">
                    <VueApexCharts
                      type="line"
                      height="280"
                      :options="trendsChartOptions"
                      :series="trendsSeries"
                    />
                  </div>
                </div>
              </q-tab-panel>

              <!-- Inzichten Tab: cycluskalender + trends + cycle comparison -->
              <q-tab-panel name="insights">
                <div class="insights-admin-panel">
                  <div class="card-label q-mb-sm">Cyclus kalender</div>
                  <CycleCalendar
                    v-if="insightsLastPeriod && insightsCycleLength"
                    :last-period-date="insightsLastPeriod"
                    :cycle-length="insightsCycleLength"
                  />
                  <div v-else class="text-grey text-center q-pa-md">Geen cyclusdata voor deze gebruiker.</div>
                  <div class="card-label q-mt-lg q-mb-sm">Cyclus vergelijking • HRV / RHR</div>
                  <CycleComparisonChart
                    :history="userHistory"
                    :last-period-date="insightsLastPeriod"
                    :cycle-length="insightsCycleLength"
                  />
                  <div class="card-label q-mt-lg q-mb-sm">Trends • HRV & RHR</div>
                  <div v-if="!userHistory || userHistory.length === 0" class="text-grey text-center q-pa-md">Nog geen trenddata.</div>
                  <div v-else class="apex-wrap">
                    <VueApexCharts
                      type="line"
                      height="260"
                      :options="trendsChartOptions"
                      :series="trendsSeries"
                    />
                  </div>
                </div>
              </q-tab-panel>

              <!-- Intake Tab: dynamisch alle velden uit profile/intake + createdAt/onboardingDate -->
              <q-tab-panel name="intake">
                <div v-if="loadingDetails" class="text-center q-pa-lg">
                  <q-spinner color="primary" size="3em" />
                </div>
                <q-list v-else-if="intakeEntries.length > 0" dark separator class="admin-list">
                  <q-item v-for="entry in intakeEntries" :key="entry.key" class="intake-row">
                    <q-item-section>
                      <q-item-label>{{ entry.keyFormatted }}</q-item-label>
                      <q-item-label caption class="intake-value">{{ entry.valueFormatted }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
                <div v-else class="text-center q-pa-lg text-grey">
                  Geen intake data beschikbaar
                </div>
              </q-tab-panel>

              <!-- History Tab -->
              <q-tab-panel name="history">
                <div v-if="loadingHistory" class="text-center q-pa-lg">
                  <q-spinner color="primary" size="3em" />
                </div>
                <q-timeline v-else-if="userHistory && userHistory.length > 0" color="#fbbf24" side="right" dark>
                  <q-timeline-entry
                    v-for="(entry, index) in userHistory"
                    :key="entry.id || index"
                    :title="formatDate(entry.timestamp || entry.date)"
                    :subtitle="`Status: ${entry.recommendation?.status || 'N/A'}`"
                  >
                    <div class="history-entry row items-start justify-between">
                      <div>
                        <div class="q-mb-sm">
                          <strong>Readiness:</strong> {{ entry.metrics?.readiness || 'N/A' }}/10
                        </div>
                        <div class="q-mb-sm">
                          <strong>Slaap:</strong> {{ entry.metrics?.sleep || 'N/A' }} uur
                        </div>
                        <div class="q-mb-sm">
                          <strong>RHR:</strong> {{ entry.metrics?.rhr?.current || entry.metrics?.rhr || 'N/A' }} bpm
                        </div>
                        <div class="q-mb-sm">
                          <strong>HRV:</strong> {{ entry.metrics?.hrv?.current || entry.metrics?.hrv || 'N/A' }}
                        </div>
                        <div v-if="getActivityForEntry(entry)" class="q-mb-sm row items-center">
                          <q-icon :name="getActivityIcon(getActivityForEntry(entry).type)" size="sm" color="orange" class="q-mr-xs" />
                          <span class="text-caption">Activity: {{ getActivityForEntry(entry).type }} — Load {{ getActivityForEntry(entry).load }}</span>
                        </div>
                        <div v-if="entry.redFlags?.count > 0" class="q-mt-sm">
                          <q-chip color="negative" size="sm">
                            {{ entry.redFlags.count }} Red Flag(s)
                          </q-chip>
                        </div>
                        <div v-if="entry.aiMessage || entry.advice" class="q-mt-sm">
                          <q-expansion-item
                            dense
                            expand-separator
                            icon="psychology"
                            label="AI Advies"
                            class="ai-advice-item"
                          >
                            <div
                              class="ai-advice-content"
                              v-html="entry.aiMessage || entry.advice"
                            />
                          </q-expansion-item>
                        </div>
                      </div>
                      <q-btn flat dense round size="sm" icon="edit" color="primary" @click="openEditCheckIn(entry)">
                        <q-tooltip>Check-in bewerken</q-tooltip>
                      </q-btn>
                    </div>
                  </q-timeline-entry>
                </q-timeline>
                <div v-else class="text-center q-pa-lg text-grey">
                  Geen check-in geschiedenis beschikbaar
                </div>
              </q-tab-panel>

              <!-- Notities Tab (admin-only) -->
              <q-tab-panel name="notes">
                <div class="notes-panel">
                  <div class="text-caption text-grey q-mb-md">Interne notities (niet zichtbaar voor de gebruiker)</div>
                  <q-input
                    v-model="adminNotesLocal"
                    type="textarea"
                    outlined
                    dark
                    placeholder="Notities over deze gebruiker..."
                    rows="12"
                    class="notes-textarea"
                  />
                  <div class="row justify-end q-mt-md">
                    <q-btn label="Opslaan" color="primary" :loading="savingNotes" @click="saveNotes" />
                  </div>
                </div>
              </q-tab-panel>

              <!-- Import Historie Tab -->
              <q-tab-panel name="import">
                <div class="import-section">
                  <div class="text-h6 q-mb-md">Batch Import Historische Data</div>
                  <div class="text-caption text-grey q-mb-lg">
                    Importeer HRV en RHR data voor baseline berekening. Kies een startdatum en vul de waarden in.
                  </div>

                  <div class="q-mb-md">
                    <q-input
                      v-model="importStartDate"
                      outlined
                      dark
                      label="Startdatum"
                      type="date"
                      @update:model-value="generateImportRows"
                      class="q-mb-md import-date-input"
                      label-color="rgba(255, 255, 255, 0.7)"
                    />
                  </div>

                  <div v-if="importRows.length > 0" class="import-table-container">
                    <q-table
                      :rows="importRows"
                      :columns="importColumns"
                      row-key="date"
                      flat
                      dark
                      class="import-table"
                      :pagination="{ rowsPerPage: 0 }"
                    >
                      <template v-slot:body-cell-hrv="props">
                        <q-td :props="props">
                          <q-input
                            v-model.number="props.row.hrv"
                            outlined
                            dense
                            dark
                            type="number"
                            placeholder="HRV"
                            @update:model-value="validateImportRow(props.row)"
                            class="import-number-input"
                          />
                        </q-td>
                      </template>
                      <template v-slot:body-cell-rhr="props">
                        <q-td :props="props">
                          <q-input
                            v-model.number="props.row.rhr"
                            outlined
                            dense
                            dark
                            type="number"
                            placeholder="RHR"
                            @update:model-value="validateImportRow(props.row)"
                            class="import-number-input"
                          />
                        </q-td>
                      </template>
                    </q-table>
                  </div>

                  <div class="q-mt-lg">
                    <q-linear-progress
                      v-if="importing"
                      :value="importProgress"
                      color="primary"
                      class="q-mb-md"
                    />
                    <div class="row justify-end q-gutter-sm">
                      <q-btn
                        flat
                        label="Annuleren"
                        color="white"
                        @click="resetImport"
                      />
                      <q-btn
                        label="Opslaan"
                        color="primary"
                        :loading="importing"
                        :disable="!canImport"
                        @click="saveImport"
                      />
                    </div>
                  </div>

                  <q-banner
                    v-if="importMessage"
                    :class="importSuccess ? 'bg-positive' : 'bg-negative'"
                    class="q-mt-md"
                  >
                    {{ importMessage }}
                  </q-banner>
                </div>
              </q-tab-panel>
            </q-tab-panels>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Cycle edit dialog -->
      <q-dialog v-model="cycleEditOpen" persistent>
        <q-card class="user-dialog-card" dark style="min-width: 320px">
          <q-card-section>
            <div class="text-h6">Cyclus bewerken</div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <q-input v-model.number="cycleDayEdit" outlined dark type="number" label="Cyclusdag" :min="1" :max="cycleLengthEdit" class="q-mb-md" />
            <q-select
              v-model="cyclePhaseEdit"
              outlined
              dark
              label="Fase"
              :options="['Menstrual','Follicular','Ovulation','Luteal']"
              class="q-mb-md"
            />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Annuleren" v-close-popup />
            <q-btn label="Opslaan" color="primary" :loading="savingCycle" @click="saveCycle" />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Edit check-in dialog -->
      <q-dialog v-model="editCheckInOpen" persistent>
        <q-card class="user-dialog-card" dark style="min-width: 340px">
          <q-card-section>
            <div class="text-h6">Check-in bewerken</div>
            <div class="text-caption text-grey" v-if="editCheckInEntry">{{ formatDate(editCheckInEntry.timestamp || editCheckInEntry.date) }}</div>
          </q-card-section>
          <q-card-section class="q-pt-none" v-if="editCheckInEntry">
            <q-input v-model.number="editForm.hrv" outlined dark type="number" label="HRV" class="q-mb-sm" />
            <q-input v-model.number="editForm.rhr" outlined dark type="number" label="RHR (bpm)" class="q-mb-sm" />
            <q-input v-model.number="editForm.sleep" outlined dark type="number" step="0.5" label="Slaap (uur)" class="q-mb-sm" />
            <q-input v-model.number="editForm.redFlagsCount" outlined dark type="number" label="Red Flags (aantal)" min="0" class="q-mb-sm" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Annuleren" v-close-popup />
            <q-btn label="Opslaan" color="primary" :loading="savingCheckIn" @click="saveCheckInEdit" />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Delete user confirmation -->
      <q-dialog v-model="deleteConfirmOpen" persistent>
        <q-card class="user-dialog-card" dark style="min-width: 320px">
          <q-card-section>
            <div class="text-h6">Gebruiker verwijderen</div>
            <div class="text-body2 q-mt-sm text-grey">
              Weet je zeker dat je deze gebruiker definitief wilt verwijderen? Dit verwijdert alle data en kan niet ongedaan worden gemaakt.
            </div>
            <div v-if="userToDelete" class="q-mt-md text-weight-medium">
              {{ userToDelete.profile?.fullName || userToDelete.id }}
            </div>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Annuleren" :disable="deleting" v-close-popup />
            <q-btn label="Verwijderen" color="negative" :loading="deleting" @click="doDeleteUser" />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, watch, watchEffect } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import CycleCalendar from '../../components/CycleCalendar.vue'
import CycleComparisonChart from '../../components/CycleComparisonChart.vue'
import { Notify, copyToClipboard } from 'quasar'
import { API_URL } from '../../config/api.js'
import { useTeamsStore } from '../../stores/teams'
import {
  fetchAllUsers,
  getUserDetails,
  getUserHistory,
  getStravaActivities,
  calculateStats,
  importHistory,
  fetchAdminStats,
  saveAdminNotes,
  updateCheckIn,
  fetchAlerts,
  updateUserCycle,
  deleteUser,
  fetchWeeklyReport,
  syncStravaHistory
} from '../../services/adminService.js'

const ADMIN_EMAIL = 'yoramroemersma50@gmail.com'
const isAdminAuthenticated = ref(false)
const adminEmailInput = ref('')
const adminLoginError = ref('')

const loading = ref(false)
const adminLoadError = ref('')
const users = ref([])
const stats = ref({
  totalMembers: 0,
  newThisWeek: 0,
  checkinsToday: 0
})
const alerts = ref({ missed: [], critical: [] })

const userDialogOpen = ref(false)
const selectedUser = ref(null)
const userDetails = ref(null)
const userHistory = ref([])
const userActivities = ref([])
const loadingDetails = ref(false)
const loadingHistory = ref(false)
const dialogTab = ref('intake')

const adminNotesLocal = ref('')
const savingNotes = ref(false)

const cycleEditOpen = ref(false)
const cycleDayEdit = ref(1)
const cyclePhaseEdit = ref('Follicular')
const savingCycle = ref(false)

const editCheckInOpen = ref(false)
const editCheckInEntry = ref(null)
const editForm = ref({ hrv: null, rhr: null, sleep: null, redFlagsCount: 0 })
const savingCheckIn = ref(false)

const deleteConfirmOpen = ref(false)
const userToDelete = ref(null)
const deleting = ref(false)

const weeklyReportOpen = ref(false)
const weeklyReportLoading = ref(false)
const weeklyReportUserName = ref('')
const weeklyReportStats = ref({})
const weeklyReportMessage = ref('')
const weeklyReportActivities = ref([])
const weeklyReportHistoryActivities = ref([])
const reportActivitiesTab = ref('week')
const syncingUserId = ref(null)
const weeklyReportStatsColumns = [
  { name: 'label', label: 'Metric', field: 'label', align: 'left' },
  { name: 'value', label: 'Waarde', field: 'value', align: 'right' }
]
const weeklyReportActivityColumns = [
  { name: 'date', label: 'Datum', field: 'date', align: 'left' },
  { name: 'type', label: 'Type', field: 'type', align: 'left' },
  { name: 'distance_km', label: 'Afstand (km)', field: 'distance_km', align: 'right' },
  { name: 'duration_min', label: 'Tijd (min)', field: 'duration_min', align: 'right' },
  { name: 'avg_hr', label: 'HR Gem.', field: 'avg_hr', align: 'right' },
  { name: 'load', label: 'Load', field: 'load', align: 'right' },
  { name: 'prime_load', label: 'Prime Load', field: 'prime_load', align: 'right' }
]
const athleteLevelLabel = (level) => {
  if (level === 1) return 'Rookie'
  if (level === 2) return 'Active'
  if (level === 3) return 'Elite'
  return level != null ? String(level) : '—'
}
const weeklyReportStatsRows = computed(() => {
  const s = weeklyReportStats.value
  const rows = []
  if (s.load_total != null) rows.push({ label: 'Week Load', value: s.load_total })
  if (s.athlete_level != null) rows.push({ label: 'Atleet Level', value: athleteLevelLabel(s.athlete_level) })
  if (s.acute_load != null) rows.push({ label: 'Acute Load (7d)', value: s.acute_load })
  if (s.chronic_load != null) rows.push({ label: 'Chronic Load', value: s.chronic_load })
  if (s.acwr != null) rows.push({ label: 'ACWR (Ratio)', value: s.acwr })
  if (s.hrv_avg != null) rows.push({ label: 'HRV gem.', value: s.hrv_avg })
  if (s.rhr_avg != null) rows.push({ label: 'RHR gem.', value: s.rhr_avg })
  if (s.subjective_avg != null) rows.push({ label: 'Readiness gem.', value: s.subjective_avg })
  if (s.days_with_logs != null) rows.push({ label: 'Dagen met logs', value: s.days_with_logs })
  if (s.activities_count != null) rows.push({ label: 'Activiteiten', value: s.activities_count })
  return rows.length ? rows : [{ label: '—', value: 'Geen data' }]
})
const weeklyReportActivitiesForTable = computed(() => {
  return reportActivitiesTab.value === '56d'
    ? weeklyReportHistoryActivities.value
    : weeklyReportActivities.value
})
const acwrInRange = computed(() => {
  const r = weeklyReportStats.value?.acwr
  if (r == null || typeof r !== 'number') return false
  return r >= 0.8 && r <= 1.3
})

// Import state
const importStartDate = ref('')
const importRows = ref([])
const importing = ref(false)
const importProgress = ref(0)
const importMessage = ref('')
const importSuccess = ref(false)

const importColumns = [
  {
    name: 'date',
    label: 'Datum',
    field: 'date',
    align: 'left',
    sortable: true
  },
  {
    name: 'hrv',
    label: 'HRV',
    field: 'hrv',
    align: 'left'
  },
  {
    name: 'rhr',
    label: 'RHR',
    field: 'rhr',
    align: 'left'
  }
]

const canImport = computed(() => {
  return importRows.value.length > 0 && 
         importRows.value.some(row => row.hrv !== null && row.rhr !== null)
})

const cycleDisplay = computed(() => {
  const cd = userDetails.value?.cycleData || selectedUser.value?.profile?.cycleData
  return {
    day: cd?.cycleDay ?? 1,
    phase: cd?.currentPhase || 'Follicular'
  }
})

const cycleLengthEdit = computed(() => {
  const cd = userDetails.value?.cycleData || selectedUser.value?.profile?.cycleData
  return Number(cd?.avgDuration) || 28
})

const insightsLastPeriod = computed(() => {
  const cd = userDetails.value?.cycleData || selectedUser.value?.profile?.cycleData
  return cd?.lastPeriod || ''
})

const insightsCycleLength = computed(() => {
  const cd = userDetails.value?.cycleData || selectedUser.value?.profile?.cycleData
  const n = Number(cd?.avgDuration)
  return Number.isFinite(n) && n >= 21 ? n : 28
})

/** Format camelCase/snake_case key for display (e.g. cycleLength → Cycle Length) */
function formatIntakeKey(key) {
  if (!key || typeof key !== 'string') return key
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Format a value for display: arrays as comma list, objects flattened, null/undefined as placeholder */
function formatIntakeValue(value) {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.map(v => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(', ')
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${formatIntakeKey(k)}: ${formatIntakeValue(v)}`)
      .join(' • ')
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nee'
  if (value instanceof Date) return value.toLocaleDateString('nl-NL', { dateStyle: 'medium' })
  return String(value)
}

/** Flatten object to entries with dot-notation keys for nested objects */
function flattenForIntake(obj, prefix = '') {
  const entries = []
  if (!obj || typeof obj !== 'object') return entries
  const skipKeys = ['adminNotes']
  for (const [key, value] of Object.entries(obj)) {
    if (skipKeys.includes(key)) continue
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      entries.push(...flattenForIntake(value, fullKey))
    } else {
      entries.push({ key: fullKey, keyFormatted: formatIntakeKey(key), value, valueFormatted: formatIntakeValue(value) })
    }
  }
  return entries
}

/** All intake entries: profile/userDetails flattened + createdAt, updatedAt, onboardingDate from user doc */
const intakeEntries = computed(() => {
  const details = userDetails.value || selectedUser.value?.profile || {}
  const user = selectedUser.value || {}
  const list = flattenForIntake(details)
  const extra = []
  const add = (raw, keyFormatted) => {
    if (raw == null) return
    const val = typeof raw.toDate === 'function' ? raw.toDate() : raw
    const str = val instanceof Date ? val.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }) : String(val)
    extra.push({ key: keyFormatted, keyFormatted, valueFormatted: str })
  }
  add(user.createdAt, 'Created At')
  add(user.updatedAt, 'Updated At')
  add(user.onboardingDate, 'Onboarding Date')
  return [...list, ...extra]
})

const toMillis = (ts) => {
  if (!ts) return 0
  const d = new Date(ts)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

const trendsSeries = computed(() => {
  const logs = Array.isArray(userHistory.value) ? userHistory.value : []
  const sorted = [...logs].sort((a, b) => toMillis(a.timestamp || a.date) - toMillis(b.timestamp || b.date))
  const hrvData = sorted.map((l) => {
    const hrvVal = Number(l.hrv) || Number(l.metrics?.hrv) || Number(l.metrics?.hrv?.current) || Number(l.metrics?.hrv?.value)
    return { x: toMillis(l.timestamp || l.date), y: hrvVal }
  }).filter(p => Number.isFinite(p.y) && p.y > 0)
  const rhrData = sorted.map((l) => {
    const rhrVal = Number(l.metrics?.rhr?.current) || Number(l.metrics?.rhr) || null
    return { x: toMillis(l.timestamp || l.date), y: rhrVal }
  }).filter(p => Number.isFinite(p.y))
  return [
    { name: 'HRV', data: hrvData },
    { name: 'RHR', data: rhrData }
  ]
})

// Teams store
const teamsStore = useTeamsStore()
const teamDialogOpen = ref(false)
const teamForm = ref({
  name: '',
  coachEmail: '',
  memberLimit: 10,
})

const teams = computed(() => teamsStore.teams)
const teamsLoading = computed(() => teamsStore.loading)

const teamColumns = [
  {
    name: 'name',
    label: 'Naam',
    field: 'name',
    align: 'left',
    sortable: true,
  },
  {
    name: 'coachEmail',
    label: 'Coach E-mail',
    field: 'coachEmail',
    align: 'left',
    sortable: true,
  },
  {
    name: 'memberLimit',
    label: 'Max Leden',
    field: (row) => row.memberLimit ?? '—',
    align: 'right',
    sortable: true,
  },
  {
    name: 'createdAt',
    label: 'Created At',
    field: (row) => {
      if (!row.createdAt) return '—'
      const date = toDateFromFirestore(row.createdAt)
      if (!date) return '—'
      return date.toLocaleDateString('nl-NL', { year: 'numeric', month: '2-digit', day: '2-digit' })
    },
    align: 'right',
    sortable: true,
  },
  {
    name: 'inviteCode',
    label: 'Invite Code',
    field: 'inviteCode',
    align: 'right',
    sortable: true,
  },
]

const resetTeamForm = () => {
  teamForm.value = {
    name: '',
    coachEmail: '',
    memberLimit: 10,
  }
}

const openTeamDialog = () => {
  resetTeamForm()
  teamDialogOpen.value = true
}

const submitTeam = async () => {
  if (!teamForm.value.name) {
    Notify.create({
      type: 'negative',
      message: 'Teamnaam is verplicht.',
    })
    return
  }

  try {
    await teamsStore.createTeam({
      name: teamForm.value.name,
      coachEmail: teamForm.value.coachEmail || null,
      memberLimit: teamForm.value.memberLimit ?? 10,
    })

    Notify.create({
      type: 'positive',
      message: 'Team aangemaakt.',
    })

    teamDialogOpen.value = false
  } catch (error) {
    console.error('Failed to create team:', error)
    Notify.create({
      type: 'negative',
      message: error?.message || 'Team aanmaken mislukt.',
    })
  }
}

const copyTeamInvite = (code) => {
  if (!code) return
  copyToClipboard(code)
    .then(() => {
      Notify.create({
        type: 'positive',
        message: 'Invite code gekopieerd.',
      })
    })
    .catch(() => {
      Notify.create({
        type: 'negative',
        message: 'Kopiëren van invite code mislukt.',
      })
    })
}

const trendsChartOptions = computed(() => ({
  chart: { type: 'line', background: 'transparent', toolbar: { show: false }, foreColor: 'rgba(255,255,255,0.75)' },
  theme: { mode: 'dark' },
  stroke: { curve: 'smooth', width: 2 },
  colors: ['#fbbf24', '#10b981'],
  grid: { borderColor: 'rgba(255,255,255,0.08)' },
  xaxis: { type: 'datetime', labels: { style: { colors: 'rgba(255,255,255,0.55)' } } },
  yaxis: { labels: { style: { colors: 'rgba(255,255,255,0.55)' } } },
  tooltip: { theme: 'dark', x: { format: 'dd MMM' } }
}))

const toDateFromFirestore = (value) => {
  if (!value) return null

  if (typeof value.toDate === 'function') {
    const d = value.toDate()
    return isNaN(d.getTime()) ? null : d
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }

  if (typeof value === 'object') {
    const seconds = value._seconds ?? value.seconds
    const nanos = value._nanoseconds ?? value.nanoseconds ?? 0

    if (typeof seconds === 'number') {
      const millis = seconds * 1000 + nanos / 1e6
      const d = new Date(millis)
      return isNaN(d.getTime()) ? null : d
    }
  }

  return null
}

const columns = [
  {
    name: 'name',
    required: true,
    label: 'Naam',
    align: 'left',
    field: row => row.profile?.fullName || 'Geen naam',
    sortable: true
  },
  {
    name: 'email',
    label: 'E-mail',
    align: 'left',
    field: row => row.profile?.email || 'Geen e-mail',
    sortable: true
  },
  {
    name: 'createdAt',
    label: 'Aangemeld',
    align: 'left',
    field: row => {
      if (!row.createdAt) return 'Onbekend'
      const date = toDateFromFirestore(row.createdAt)
      if (!date) return 'Onbekend'
      return date.toLocaleDateString('nl-NL')
    },
    sortable: true
  },
  {
    name: 'actions',
    label: 'Acties',
    align: 'center',
    field: () => ''
  }
]

const loadAlerts = async () => {
  try {
    const data = await fetchAlerts()
    alerts.value = { missed: data.missed || [], critical: data.critical || [] }
  } catch (error) {
    console.error('Failed to load alerts:', error)
    alerts.value = { missed: [], critical: [] }
  }
}

const loadUsers = async () => {
  loading.value = true
  adminLoadError.value = ''
  console.log('Fetching data van:', API_URL + '/api/admin/users')
  try {
    const allUsers = await fetchAllUsers()
    users.value = allUsers

    let backendStats = { newThisWeek: undefined, checkinsToday: undefined }
    try {
      backendStats = await fetchAdminStats()
    } catch (error) {
      console.error('Failed to load admin stats from backend:', error)
    }

    stats.value = calculateStats(allUsers, backendStats)
    await loadAlerts()
  } catch (error) {
    console.error('Failed to load users:', error)
    users.value = []
    const msg = error?.message || 'Kon data niet laden.'
    adminLoadError.value = msg
    Notify.create({ type: 'negative', message: msg, caption: 'Controleer of je met het juiste admin e-mailadres bent ingelogd.' })
  } finally {
    loading.value = false
  }
}

const openUserDialogByUserId = (userId) => {
  const user = users.value.find(u => (u.id || u.userId) === userId)
  if (user) openUserDialog(user)
}

const confirmDeleteUser = (row) => {
  userToDelete.value = row
  deleteConfirmOpen.value = true
}

const doDeleteUser = async () => {
  if (!userToDelete.value) return
  const uid = userToDelete.value.id || userToDelete.value.userId
  deleting.value = true
  try {
    await deleteUser(uid)
    deleteConfirmOpen.value = false
    userToDelete.value = null
    await loadUsers()
  } catch (error) {
    console.error('Delete user failed:', error)
  } finally {
    deleting.value = false
  }
}

async function openWeeklyReport(row) {
  const uid = row.id || row.userId
  weeklyReportUserName.value = row.profile?.fullName || uid
  weeklyReportOpen.value = true
  weeklyReportLoading.value = true
  weeklyReportStats.value = {}
  weeklyReportMessage.value = ''
  weeklyReportActivities.value = []
  weeklyReportHistoryActivities.value = []
  reportActivitiesTab.value = 'week'
  try {
    const data = await fetchWeeklyReport(uid)
    weeklyReportStats.value = data.stats || {}
    weeklyReportMessage.value = data.message || 'Geen rapport gegenereerd.'
    weeklyReportActivities.value = Array.isArray(data.activities_list) ? data.activities_list : []
    weeklyReportHistoryActivities.value = Array.isArray(data.history_activities) ? data.history_activities : []
  } catch (error) {
    console.error('Weekly report failed:', error)
    Notify.create({ type: 'negative', message: error?.message || 'Weekrapport genereren mislukt.' })
    weeklyReportOpen.value = false
  } finally {
    weeklyReportLoading.value = false
  }
}

function copyReportToClipboard() {
  const text = weeklyReportMessage.value
  if (!text) return
  navigator.clipboard.writeText(text).then(() => {
    Notify.create({ type: 'positive', message: 'Tekst gekopieerd naar klembord' })
  }).catch(() => {
    Notify.create({ type: 'negative', message: 'Kopiëren mislukt' })
  })
}

async function syncStravaForUser(row) {
  const uid = row.id || row.userId
  syncingUserId.value = uid
  try {
    const data = await syncStravaHistory(uid)
    const count = data?.count ?? 0
    Notify.create({ type: 'positive', message: `${count} activiteiten opgehaald en opgeslagen.` })
  } catch (error) {
    console.error('Strava sync failed:', error)
    Notify.create({ type: 'negative', message: error?.message || 'Sync Strava mislukt.' })
  } finally {
    syncingUserId.value = null
  }
}

const openUserDialog = async (user) => {
  selectedUser.value = user
  userDialogOpen.value = true
  dialogTab.value = 'intake'
  userDetails.value = null
  userHistory.value = []
  userActivities.value = []
  adminNotesLocal.value = selectedUser.value?.adminNotes ?? ''

  loadingDetails.value = true
  try {
    userDetails.value = await getUserDetails(user.id || user.userId)
  } catch (error) {
    console.error('Failed to load user details:', error)
  } finally {
    loadingDetails.value = false
  }

  await Promise.all([
    loadUserHistory(user.id || user.userId),
    loadUserActivities(user.id || user.userId)
  ])
}

const openEditCheckIn = (entry) => {
  editCheckInEntry.value = entry
  const m = entry.metrics || {}
  editForm.value = {
    hrv: m.hrv?.current ?? m.hrv ?? null,
    rhr: m.rhr?.current ?? m.rhr ?? null,
    sleep: m.sleep ?? null,
    redFlagsCount: entry.redFlags?.count ?? 0
  }
  editCheckInOpen.value = true
}

const saveCheckInEdit = async () => {
  if (!selectedUser.value || !editCheckInEntry.value) return
  savingCheckIn.value = true
  try {
    await updateCheckIn(
      selectedUser.value.id || selectedUser.value.userId,
      editCheckInEntry.value.id,
      {
        hrv: editForm.value.hrv,
        rhr: editForm.value.rhr,
        sleep: editForm.value.sleep,
        redFlags: { count: editForm.value.redFlagsCount }
      }
    )
    editCheckInOpen.value = false
    await loadUserHistory(selectedUser.value.id || selectedUser.value.userId)
  } catch (error) {
    console.error('Failed to update check-in:', error)
  } finally {
    savingCheckIn.value = false
  }
}

const saveNotes = async () => {
  if (!selectedUser.value) return
  savingNotes.value = true
  try {
    await saveAdminNotes(selectedUser.value.id || selectedUser.value.userId, adminNotesLocal.value)
    selectedUser.value.adminNotes = adminNotesLocal.value
  } catch (error) {
    console.error('Failed to save notes:', error)
  } finally {
    savingNotes.value = false
  }
}

const openCycleEdit = () => {
  cycleDayEdit.value = cycleDisplay.value.day
  cyclePhaseEdit.value = cycleDisplay.value.phase
  cycleEditOpen.value = true
}

const saveCycle = async () => {
  if (!selectedUser.value) return
  savingCycle.value = true
  try {
    await updateUserCycle(
      selectedUser.value.id || selectedUser.value.userId,
      cycleDayEdit.value,
      cyclePhaseEdit.value
    )
    if (userDetails.value?.cycleData) {
      userDetails.value.cycleData.cycleDay = cycleDayEdit.value
      userDetails.value.cycleData.currentPhase = cyclePhaseEdit.value
    }
    if (selectedUser.value?.profile?.cycleData) {
      selectedUser.value.profile.cycleData = selectedUser.value.profile.cycleData || {}
      selectedUser.value.profile.cycleData.cycleDay = cycleDayEdit.value
      selectedUser.value.profile.cycleData.currentPhase = cyclePhaseEdit.value
    }
    cycleEditOpen.value = false
  } catch (error) {
    console.error('Failed to save cycle:', error)
  } finally {
    savingCycle.value = false
  }
}

const formatDate = (dateString) => {
  if (!dateString) return 'Onbekend'
  const date = new Date(dateString)
  return date.toLocaleDateString('nl-NL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const generateImportRows = () => {
  if (!importStartDate.value) {
    importRows.value = []
    return
  }

  const startDate = new Date(importStartDate.value)
  const rows = []

  for (let i = 0; i < 30; i++) {
    const currentDate = new Date(startDate)
    currentDate.setDate(startDate.getDate() + i)
    
    const dateStr = currentDate.toISOString().split('T')[0]
    
    rows.push({
      date: dateStr,
      hrv: null,
      rhr: null,
      valid: false
    })
  }

  importRows.value = rows
}

const validateImportRow = (row) => {
  row.valid = row.hrv !== null && row.rhr !== null && 
              row.hrv > 0 && row.rhr > 0
}

const resetImport = () => {
  importStartDate.value = ''
  importRows.value = []
  importMessage.value = ''
  importSuccess.value = false
  importProgress.value = 0
}

const saveImport = async () => {
  if (!selectedUser.value) return

  const userId = selectedUser.value.id || selectedUser.value.userId
  const validEntries = importRows.value
    .filter(row => row.hrv !== null && row.rhr !== null && row.hrv > 0 && row.rhr > 0)
    .map(row => ({
      date: row.date,
      hrv: Number(row.hrv),
      rhr: Number(row.rhr)
    }))

  if (validEntries.length === 0) {
    importMessage.value = 'Geen geldige data om te importeren'
    importSuccess.value = false
    return
  }

  importing.value = true
  importProgress.value = 0
  importMessage.value = ''

  try {
    // Simulate progress
    const progressInterval = setInterval(() => {
      if (importProgress.value < 0.9) {
        importProgress.value += 0.1
      }
    }, 100)

    await importHistory(userId, validEntries)

    clearInterval(progressInterval)
    importProgress.value = 1

    importMessage.value = `${validEntries.length} dagen historie succesvol toegevoegd`
    importSuccess.value = true

    // Refresh history tab
    await loadUserHistory(userId)

    // Reset form after 2 seconds
    setTimeout(() => {
      resetImport()
      dialogTab.value = 'history'
    }, 2000)
  } catch (error) {
    console.error('Import failed:', error)
    importMessage.value = `Import mislukt: ${error.message}`
    importSuccess.value = false
  } finally {
    importing.value = false
  }
}

const loadUserHistory = async (userId) => {
  loadingHistory.value = true
  try {
    userHistory.value = await getUserHistory(userId)
  } catch (error) {
    console.error('Failed to load user history:', error)
  } finally {
    loadingHistory.value = false
  }
}

const loadUserActivities = async (userId) => {
  try {
    userActivities.value = await getStravaActivities(userId)
  } catch (error) {
    console.error('Failed to load Strava activities:', error)
    userActivities.value = []
  }
}

function entryDateStr(entry) {
  const ts = entry.timestamp || entry.date
  if (!ts) return ''
  const d = typeof ts === 'string' ? new Date(ts) : (ts?.toDate ? ts.toDate() : new Date(ts))
  return d.toISOString ? d.toISOString().slice(0, 10) : ''
}

function getActivityForEntry(entry) {
  const dateStr = entryDateStr(entry)
  if (!dateStr) return null
  const act = userActivities.value.find((a) => (a.start_date_local || a.start_date || '').toString().slice(0, 10) === dateStr)
  if (!act) return null
  const ss = act.suffer_score != null ? Number(act.suffer_score) : null
  let load = '—'
  if (ss != null) load = ss <= 50 ? 'Low' : ss <= 100 ? 'Medium' : 'High'
  return { type: act.type || 'Workout', load }
}

function getActivityIcon(type) {
  if (type === 'Run') return 'directions_run'
  if (type === 'Ride' || type === 'VirtualRide') return 'directions_bike'
  return 'fitness_center'
}

// Watch for dialog tab changes to reset import when switching away
watch(dialogTab, (newTab) => {
  if (newTab !== 'import') {
    resetImport()
  }
})

const hasFetchedOnce = ref(false)

function checkAdminAuth() {
  const stored = (localStorage.getItem('admin_email') || '').trim()
  isAdminAuthenticated.value = stored === ADMIN_EMAIL
}

function submitAdminLogin() {
  adminLoginError.value = ''
  const email = adminEmailInput.value.trim()
  if (!email) {
    adminLoginError.value = 'Voer een e-mailadres in.'
    return
  }
  if (email !== ADMIN_EMAIL) {
    adminLoginError.value = 'Geen toegang. Alleen beheerders hebben toegang.'
    return
  }
  localStorage.setItem('admin_email', email)
  isAdminAuthenticated.value = true
  hasFetchedOnce.value = true
  loadUsers()
}

onMounted(() => {
  checkAdminAuth()
  if (!isAdminAuthenticated.value) return
  console.log('AdminPage mounted. Checking prerequisites...')
  console.log('Using API URL:', API_URL)
  const adminEmail = localStorage.getItem('admin_email')
  console.log('Current User State (admin_email):', adminEmail ?? null)
  if (!adminEmail) {
    console.warn('Geen user gevonden, fetch overgeslagen')
    return
  }
  hasFetchedOnce.value = true
  loadUsers()
  teamsStore.fetchTeams().catch((err) => {
    console.error('Failed to fetch teams on mount:', err)
  })
})

// Zodra admin_email beschikbaar is en we nog geen data hebben, alsnog fetchen (bv. na late auth)
watchEffect(() => {
  const adminEmail = localStorage.getItem('admin_email')
  if (adminEmail && !hasFetchedOnce.value && users.value.length === 0 && !loading.value) {
    console.log('Admin email nu beschikbaar, fetch gestart')
    hasFetchedOnce.value = true
    loadUsers()
  }
})
</script>

<style scoped lang="scss">
// Admin design tokens: zie src/css/_admin.scss
@use '../../css/admin' as admin;

.admin-page {
  background: admin.$admin-bg;
  min-height: 100vh;
  padding: admin.$admin-page-padding;
}

.admin-container {
  max-width: 1400px;
  margin: 0 auto;
}

.admin-login-card {
  max-width: 420px;
  margin: 0 auto;
  background: admin.$admin-card-bg !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.admin-title {
  font-family: admin.$admin-font-display;
  font-weight: 900;
  font-style: italic;
  color: admin.$admin-gold;
  font-size: 2rem;
  margin: 0;
  letter-spacing: 2px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.alerts-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.alert-card {
  color: #e5e5e5 !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.alert-card.missed-card { border-left: 3px solid admin.$admin-accent-orange; }
.alert-card.critical-card { border-left: 3px solid admin.$admin-accent-error; }

.alert-title {
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
}

.alert-count {
  font-size: 1.5rem;
  font-weight: 900;
  color: admin.$admin-gold;
  font-family: admin.$admin-font-mono !important;
  margin-bottom: 8px;
}

.alert-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.alert-name-btn {
  color: rgba(255, 255, 255, 0.9) !important;
  text-transform: none;
}

.trends-panel .card-label {
  color: rgba(255, 255, 255, 0.8);
}

.trends-panel .apex-wrap {
  min-height: 280px;
}

.insights-admin-panel {
  padding: 0;
}
.insights-admin-panel .apex-wrap {
  min-height: 260px;
}

.notes-panel .notes-textarea :deep(.q-field__control) {
  min-height: 200px;
}

.cycle-manager .q-badge {
  font-size: 0.75rem;
}

.stat-card {
  color: #e5e5e5 !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.stat-card :deep(.q-card__section) {
  color: #e5e5e5 !important;
}
.stat-value {
  font-size: 2.5rem;
  font-weight: 900;
  color: admin.$admin-gold;
  font-family: admin.$admin-font-mono !important;
}
.stat-label {
  font-size: 0.9rem;
  color: admin.$admin-text-muted;
  margin-top: 8px;
  font-family: admin.$admin-font-body;
}
.users-card {
  color: #e5e5e5 !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.users-card :deep(.q-card__section) {
  color: #e5e5e5 !important;
  background: transparent !important;
}
.users-card :deep(.text-h6) {
  color: #e5e5e5 !important;
}

.teams-card {
  margin-top: 24px;
  background: admin.$admin-card-bg !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.teams-header {
  display: flex;
  flex-direction: column;
}

.teams-title {
  font-family: admin.$admin-font-display;
  font-size: 0.9rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: admin.$admin-gold;
}

.teams-subtitle {
  margin-top: 4px;
  font-size: 0.75rem;
  color: admin.$admin-text-muted;
}

.new-team-btn {
  border-radius: 2px;
  border-width: 1px;
  border-color: admin.$admin-gold;
  font-family: admin.$admin-font-mono !important;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.teams-table :deep(.q-table thead tr th) {
  background: rgba(255, 255, 255, 0.04) !important;
  color: rgba(255, 255, 255, 0.9) !important;
  font-weight: 600;
  font-family: admin.$admin-font-mono !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.teams-table :deep(.q-table tbody tr) {
  background: rgba(255, 255, 255, 0.02) !important;
}

.teams-table :deep(.q-table tbody tr:hover) {
  background: rgba(255, 255, 255, 0.05) !important;
}

.teams-table :deep(.q-table tbody td) {
  color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
  font-family: admin.$admin-font-mono !important;
}

.team-code {
  font-family: admin.$admin-font-mono !important;
}

.user-dialog-card {
  background: admin.$admin-bg !important;
  min-width: 90vw;
  color: #e5e5e5 !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}
.user-dialog-card :deep(.q-card__section) {
  background: admin.$admin-bg !important;
  color: #e5e5e5 !important;
}
.user-dialog-card :deep(.text-h6) {
  color: #e5e5e5 !important;
}
.user-dialog-card :deep(.text-caption) {
  color: admin.$admin-text-muted !important;
}

.user-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 16px;
}

.history-entry {
  background: rgba(18, 18, 18, 0.5);
  padding: 12px;
  border-radius: 2px;
  margin-top: 8px;
  color: #e5e5e5;
}

.admin-table :deep(.q-table__top) {
  background: transparent !important;
}

.admin-table :deep(.q-table thead tr th) {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255, 255, 255, 0.9) !important;
  font-weight: 600;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.admin-table :deep(.q-table tbody tr) {
  background: rgba(255, 255, 255, 0.02) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.admin-table :deep(.q-table tbody tr:hover) {
  background: rgba(255, 255, 255, 0.05) !important;
}

.admin-table :deep(.q-table tbody td) {
  color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.import-section {
  padding: 16px 0;
  color: rgba(255, 255, 255, 0.9);
}

.import-section :deep(.text-h6) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.import-section :deep(.text-caption) {
  color: rgba(255, 255, 255, 0.6) !important;
}

.import-table-container {
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  background: admin.$admin-card-bg;
}

.import-table :deep(.q-table thead tr th) {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255, 255, 255, 0.9) !important;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.import-table :deep(.q-table tbody tr) {
  background: rgba(255, 255, 255, 0.02) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.import-table :deep(.q-table tbody tr:hover) {
  background: rgba(255, 255, 255, 0.05) !important;
}

.import-table :deep(.q-table tbody td) {
  color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.import-table :deep(.q-input) {
  max-width: 120px;
}

.import-table :deep(.q-input .q-field__label) {
  color: rgba(255, 255, 255, 0.7) !important;
}

.import-table :deep(.q-input .q-field__native) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.import-table :deep(.q-input .q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.import-table :deep(.q-input--focused .q-field__outline) {
  border-color: #fbbf24 !important;
}

/* Q-Tabs styling */
.user-dialog-card :deep(.q-tabs) {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-tabs__content) {
  background: transparent !important;
}

.user-dialog-card :deep(.q-tabs__arrow) {
  color: rgba(255, 255, 255, 0.7) !important;
}

.user-dialog-card :deep(.q-tab) {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.6) !important;
  text-transform: none !important;
  font-weight: 500 !important;
}

.user-dialog-card :deep(.q-tab:hover) {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-tab--active) {
  background: transparent !important;
  color: #fbbf24 !important;
  font-weight: 600 !important;
}

.user-dialog-card :deep(.q-tab__indicator) {
  background: #fbbf24 !important;
  height: 2px !important;
}

.user-dialog-card :deep(.q-tab__label) {
  color: inherit !important;
}

/* Q-List styling */
.admin-list {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-list) {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-item) {
  color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
  background: transparent !important;
}

.user-dialog-card :deep(.q-item__label) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-item__label--caption) {
  color: rgba(255, 255, 255, 0.6) !important;
}

.user-dialog-card :deep(.q-separator) {
  background: rgba(255, 255, 255, 0.1) !important;
}

/* Q-Timeline styling */
.user-dialog-card :deep(.q-timeline) {
  color: rgba(255, 255, 255, 0.9);
}

.user-dialog-card :deep(.q-timeline-entry__title) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-timeline-entry__subtitle) {
  color: rgba(255, 255, 255, 0.6) !important;
}

/* Q-Input styling in import */
.import-section :deep(.q-input) {
  color: rgba(255, 255, 255, 0.9);
}

.import-section :deep(.q-input .q-field__label) {
  color: rgba(255, 255, 255, 0.7) !important;
}

.import-section :deep(.q-input .q-field__native) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.import-section :deep(.q-input .q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.import-section :deep(.q-input--focused .q-field__outline) {
  border-color: #fbbf24 !important;
}

/* Q-Banner styling */
.import-section :deep(.q-banner) {
  color: rgba(255, 255, 255, 0.9) !important;
}

/* Q-Chip styling */
.user-dialog-card :deep(.q-chip) {
  background: rgba(212, 175, 55, 0.2) !important;
  color: #fbbf24 !important;
  border: 1px solid rgba(212, 175, 55, 0.3) !important;
}

/* Q-Spinner styling */
.user-dialog-card :deep(.q-spinner) {
  color: #fbbf24 !important;
}

/* Q-Btn styling in dialog */
.user-dialog-card :deep(.q-btn) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-btn--flat) {
  color: rgba(255, 255, 255, 0.7) !important;
}

.user-dialog-card :deep(.q-btn--flat:hover) {
  background: rgba(255, 255, 255, 0.1) !important;
}

/* Import date input specific */
.import-date-input :deep(.q-field__label) {
  color: rgba(255, 255, 255, 0.7) !important;
}

.import-date-input :deep(.q-field__native) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.import-date-input :deep(.q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.import-date-input :deep(.q-field--focused .q-field__outline) {
  border-color: #fbbf24 !important;
}

/* Import number inputs */
.import-number-input :deep(.q-field__native) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.import-number-input :deep(.q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.import-number-input :deep(.q-field--focused .q-field__outline) {
  border-color: #fbbf24 !important;
}

/* Report stats: ACWR kleur (groen 0.8–1.3, oranje daarbuiten) */
.report-stats-table .acwr-value {
  font-weight: 700;
}
.report-stats-table .acwr-green {
  color: admin.$admin-accent-success;
}
.report-stats-table .acwr-orange {
  color: admin.$admin-accent-warning;
}
</style>
