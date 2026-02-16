<template>
  <q-page class="admin-page">
    <!-- Auth gate: only role === 'admin' (enforced by router; redirect if not) -->
    <div v-if="!authStore.isAuthReady" class="admin-container q-pa-lg flex flex-center">
      <q-spinner-grid size="48px" color="amber" />
    </div>
    <div v-else-if="!authStore.isAdmin" class="admin-container q-pa-lg">
      <q-card class="admin-login-card" flat dark>
        <q-card-section>
          <div class="text-h6 q-mb-md">Geen toegang</div>
          <p class="text-body2 text-grey q-mb-md">
            Alleen gebruikers met de rol Admin kunnen Mission Control openen.
          </p>
          <q-btn unelevated color="primary" label="Naar dashboard" :to="'/dashboard'" />
        </q-card-section>
      </q-card>
    </div>

    <div v-else class="admin-container">
      <!-- Header -->
      <div class="admin-header">
        <div>
          <div class="admin-title">SUPER ADMIN • MISSION CONTROL</div>
          <div class="admin-subtitle">
            Global Telemetry • Teams • Atleten
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
            <div class="kpi-label">TOTAAL TEAMS</div>
            <div class="kpi-value">{{ adminStore.totalTeams }}</div>
          </q-card-section>
        </q-card>

        <q-card class="kpi-card" flat>
          <q-card-section>
            <div class="kpi-label">ACTIEVE ATLETEN</div>
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
              <span v-else>Niet ingesteld</span>
            </div>
            <div class="kpi-caption" v-if="systemCapacity > 0">
              {{ adminStore.totalUsers }} / {{ systemCapacity }} atleten
            </div>
            <div class="kpi-caption text-grey" v-else>
              Stel teamlimieten in voor load-indicator
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- MASTER LIJST -->
      <q-card class="users-card q-mb-lg" flat>
        <q-card-section>
          <div class="row items-center justify-between q-mb-sm">
            <div>
              <div class="teams-title">MASTER LIJST</div>
              <div class="teams-subtitle">
                Overzicht van alle atleten • zoeken en open Atleet Dossier
              </div>
            </div>
            <q-input
              v-model="masterSearch"
              dense
              outlined
              dark
              class="q-ml-md"
              placeholder="Zoek op naam of e-mail"
            >
              <template #prepend>
                <q-icon name="search" />
              </template>
            </q-input>
          </div>
          <q-table
            :rows="masterRosterRows"
            :columns="masterColumns"
            row-key="id"
            flat
            dark
            dense
            class="admin-table admin-table-master-clickable"
            :loading="adminStore.loading"
            :rows-per-page-options="[10, 25, 50]"
            @row-click="(evt, row) => { if (!evt.target.closest('.q-btn, .q-select')) openAthleteDeepDive(row) }"
          >
            <template #body-cell-actions="props">
              <q-td :props="props" @click.stop>
                <div class="row no-wrap q-gutter-xs justify-end">
                  <q-btn
                    dense
                    flat
                    size="sm"
                    icon="visibility"
                    color="amber-4"
                    @click="handleBekijkAlsAtleet(props.row)"
                  >
                    <q-tooltip>Bekijk als atleet (Shadow Mode)</q-tooltip>
                  </q-btn>
                  <q-btn
                    dense
                    flat
                    size="sm"
                    icon="delete"
                    color="negative"
                    :loading="deletingUserId === (props.row.id ?? props.row.userId)"
                    @click="handleDeleteUser(props.row)"
                  >
                    <q-tooltip>Gebruiker verwijderen (Auth + Firestore)</q-tooltip>
                  </q-btn>
                </div>
              </q-td>
            </template>
            <template #body-cell-directive="props">
              <q-td :props="props">
                <q-tooltip>
                  {{ directiveLabelFor(props.row) }}
                </q-tooltip>
                <span
                  class="directive-dot"
                  :class="directiveDotClass(props.row)"
                  :title="directiveLabelFor(props.row)"
                />
              </q-td>
            </template>
            <template #body-cell-role="props">
              <q-td :props="props" @click.stop="openUserDialog(props.row)">
                <q-chip
                  dense
                  flat
                  :color="roleChipColor(props.row.profile?.role ?? 'user')"
                  class="role-chip text-weight-medium cursor-pointer"
                >
                  {{ roleChipLabel(props.row.profile?.role ?? 'user') }}
                </q-chip>
              </q-td>
            </template>
            <template #no-data>
              <div class="text-grey text-caption q-pa-md">
                Geen atleten gevonden in het systeem.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

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
                ⚠️ ONGEKOPPELDE ATLETEN (ACTIE VEREIST)
              </div>
              <div class="ghost-subtitle">
                Atleten zonder Team-koppeling zijn onzichtbaar in de teamtelemetrie.
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
            class="ghost-table ghost-table-clickable"
            :loading="adminStore.loading"
            :rows-per-page-options="[5, 10, 25]"
            @row-click="(evt, row) => { if (!evt.target.closest('.q-select, .q-btn')) openAtleetDetail(row) }"
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
                  placeholder="Koppel aan team"
                  @update:model-value="(val) => onAssignTeam(props.row.id, val)"
                />
              </q-td>
            </template>

            <template #no-data>
              <div class="text-grey text-caption q-pa-md">
                Alle atleten zijn gekoppeld. Geen ghosts in het systeem.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- Constructor Configuration -->
      <q-card class="teams-card" flat>
        <q-card-section class="row items-center justify-between">
          <div class="teams-header">
            <div class="teams-title">TEAM CONFIGURATIE</div>
            <div class="teams-subtitle">
              Actieve Teams • Coaches • Codes • Bezetting — klik op een teamrij om atleten te zien
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
            v-model:expanded="teamsExpanded"
            :rows="teamsWithOccupancy"
            :columns="teamColumns"
            row-key="id"
            flat
            dark
            :loading="adminStore.loading || teamsLoading"
            :rows-per-page-options="[5, 10, 25]"
            class="teams-table"
            @row-click="handleTeamClick"
          >
            <template #expand="props">
              <div class="team-members-expand q-pa-md">
                <div class="text-caption text-grey q-mb-sm">
                  ATLETEN — klik op een rij om het Atleet Dossier te openen
                </div>
                <q-table
                  :rows="membersForTeam(props.row.id)"
                  :columns="memberColumns"
                  :row-key="(row) => row.id"
                  flat
                  dark
                  dense
                  hide-pagination
                  class="members-table members-table-clickable"
                  @row-click="(evt, row) => { if (!evt.target.closest('.q-btn')) openAtleetDetail(row) }"
                >
                  <template #no-data>
                    <div class="text-caption text-grey q-pa-sm">
                      Nog geen atleten gekoppeld aan dit team.
                    </div>
                  </template>
                </q-table>
              </div>
            </template>
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

            <template #body-cell-actions="props">
              <q-td :props="props" @click.stop>
                <div class="row justify-end q-gutter-xs">
                  <q-btn
                    dense
                    flat
                    size="sm"
                    icon="edit"
                    color="amber-4"
                    @click.stop="handleRenameTeam(props.row)"
                  >
                    <q-tooltip>Teamnaam wijzigen</q-tooltip>
                  </q-btn>
                  <q-btn
                    dense
                    flat
                    size="sm"
                    icon="delete"
                    color="negative"
                    @click.stop="handleDeleteTeam(props.row)"
                  >
                    <q-tooltip>Team verwijderen</q-tooltip>
                  </q-btn>
                </div>
              </q-td>
            </template>

            <template #no-data>
              <div class="text-grey text-caption q-pa-md">
                Nog geen teams geregistreerd. Gebruik de knop
                <span class="text-white">DEPLOY NEW TEAM</span>
                om het eerste team te activeren.
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- Team dialog (nieuw of bewerken: velden + ledenlijst met verwijderen) -->
      <q-dialog v-model="teamDialogOpen" persistent>
        <q-card class="user-dialog-card" dark style="min-width: 360px">
          <q-card-section>
            <div class="text-h6">{{ editingTeam ? 'Team Beheren' : 'Nieuw Team' }}</div>
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
            <div v-if="editingTeam" class="q-mt-md">
              <div class="text-subtitle2 q-mb-xs">Leden in dit team ({{ teamMembersForDialog.length }})</div>
              <q-list bordered separator dense class="rounded-borders bg-grey-9">
                <q-item v-for="member in teamMembersForDialog" :key="member.id">
                  <q-item-section>
                    <q-item-label>{{ member.displayName || member.fullName || member.profile?.fullName || 'Naamloos' }}</q-item-label>
                    <q-item-label caption class="text-grey-5">{{ member.email || member.profile?.email || '—' }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-btn
                      icon="person_remove"
                      flat
                      round
                      dense
                      color="negative"
                      :loading="removingMemberId === member.id"
                      @click="removeMemberFromTeam(member)"
                    >
                      <q-tooltip>Verwijder uit team</q-tooltip>
                    </q-btn>
                  </q-item-section>
                </q-item>
                <div v-if="teamMembersForDialog.length === 0" class="q-pa-md text-grey italic text-center">
                  Nog geen leden in dit team.
                </div>
              </q-list>
            </div>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Annuleren" :disable="teamsLoading" v-close-popup />
            <q-btn
              v-if="!editingTeam"
              label="Bevestigen"
              color="primary"
              :loading="teamsLoading"
              @click="submitTeam"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- User dialog: rol wijzigen -->
      <q-dialog v-model="userDialogOpen" persistent>
        <q-card class="user-dialog-card" dark style="min-width: 360px">
          <q-card-section>
            <div class="text-h6">Rol / Bevoegdheid wijzigen</div>
            <div class="text-caption text-grey q-mt-xs">
              Wijzig de rol van deze gebruiker.
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <q-select
              v-model="editingUserRole"
              :options="roleOptions"
              label="Rol / Bevoegdheid"
              outlined
              dark
              dense
              emit-value
              map-options
              class="q-mb-md admin-input"
            >
              <template v-slot:option="scope">
                <q-item v-bind="scope.itemProps">
                  <q-item-section avatar>
                    <q-icon :name="scope.opt.icon" :color="scope.opt.color" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ scope.opt.label }}</q-item-label>
                    <q-item-label caption class="text-grey">{{ scope.opt.description }}</q-item-label>
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
            <q-input
              :model-value="editingUserDisplayName"
              label="Naam"
              outlined
              dark
              dense
              readonly
              class="q-mb-md admin-input"
            />
            <q-input
              :model-value="editingUserEmail"
              label="E-mail"
              type="email"
              outlined
              dark
              dense
              readonly
              class="admin-input"
            />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Annuleren" :disable="userRoleSaving" v-close-popup />
            <q-btn
              label="Opslaan"
              color="primary"
              :loading="userRoleSaving"
              @click="saveUserRole"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <!-- Atleet detail (Profile + Telemetry Injector) -->
      <AtleetDetailDialog
        v-model="atleetDetailOpen"
        :user="selectedAtleet"
        :team-options="teamOptions"
        @updated="onAtleetDetailUpdated"
      />
    </div>
  </q-page>
</template>

<script setup>
import { ref as vueRef, computed as vueComputed, onMounted as onMountedHook, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Notify, copyToClipboard, useQuasar } from 'quasar'
import { useAuthStore } from '../../stores/auth'
import { useTeamsStore } from '../../stores/teams'
import { useAdminStore } from '../../stores/admin'
import { useDashboardStore } from '../../stores/dashboard'
import { useSquadronStore } from '../../stores/squadron'
import AtleetDetailDialog from '../../components/AtleetDetailDialog.vue'
import { updateUserProfile } from '../../services/adminService'

const router = useRouter()
const authStore = useAuthStore()
const adminStore = useAdminStore()
const dashboardStore = useDashboardStore()
const $q = useQuasar()

// Team creation (reuse existing logic)
const teamsStore = useTeamsStore()
const teamDialogOpen = vueRef(false)
const editingTeam = vueRef(null)
const removingMemberId = vueRef(null)
const teamForm = vueRef({
  name: '',
  coachEmail: '',
  memberLimit: 10,
})

const roleOptions = [
  { label: 'Atleet', value: 'user', description: 'Standaard gebruiker', icon: 'directions_run', color: 'positive' },
  { label: 'Coach', value: 'coach', description: 'Kan team data inzien', icon: 'sports_score', color: 'warning' },
  { label: 'Admin', value: 'admin', description: 'Volledige toegang', icon: 'security', color: 'negative' },
]

const userDialogOpen = vueRef(false)
const editingUser = vueRef(null)
const editingUserRole = vueRef('user')
const userRoleSaving = vueRef(false)

const editingUserDisplayName = vueComputed(() => {
  const u = editingUser.value
  if (!u) return '—'
  return u.displayName || u.fullName || u.profile?.fullName || '—'
})

const editingUserEmail = vueComputed(() => {
  const u = editingUser.value
  if (!u) return '—'
  return u.email || u.profile?.email || '—'
})

function openUserDialog(row) {
  if (!row?.id) return
  editingUser.value = row
  editingUserRole.value = row.profile?.role ?? 'user'
  userDialogOpen.value = true
}

async function saveUserRole() {
  const u = editingUser.value
  if (!u?.id) return
  userRoleSaving.value = true
  try {
    await updateUserProfile(u.id, { role: editingUserRole.value })
    if (u.profile) u.profile.role = editingUserRole.value
    else u.profile = { role: editingUserRole.value }
    Notify.create({ type: 'positive', message: 'Rol opgeslagen.' })
    userDialogOpen.value = false
  } catch (e) {
    Notify.create({ type: 'negative', message: e?.message || 'Rol opslaan mislukt.' })
  } finally {
    userRoleSaving.value = false
  }
}

const teamsLoading = vueComputed(() => teamsStore.loading)

const resetTeamForm = () => {
  teamForm.value = {
    name: '',
    coachEmail: '',
    memberLimit: 10,
  }
}

const openTeamDialog = () => {
  editingTeam.value = null
  resetTeamForm()
  teamDialogOpen.value = true
}

const handleTeamClick = (evt, row) => {
  if (!row?.id) return
  editingTeam.value = row
  teamForm.value = {
    name: row.name || '',
    coachEmail: row.coachEmail ?? '',
    memberLimit: row.memberLimit ?? 10,
  }
  teamDialogOpen.value = true
}

const teamMembersForDialog = vueComputed(() => {
  const team = editingTeam.value
  if (!team?.id) return []
  return (adminStore.users || []).filter((u) => u.teamId === team.id)
})

const removeMemberFromTeam = async (member) => {
  if (!member?.id) return
  removingMemberId.value = member.id
  try {
    await adminStore.assignUserToTeam(member.id, null)
    Notify.create({
      type: 'positive',
      message: 'Lid uit team verwijderd.',
    })
    await adminStore.fetchAllData()
  } catch (err) {
    console.error('Remove member from team failed', err)
    Notify.create({
      type: 'negative',
      message: err?.message || 'Verwijderen mislukt.',
    })
  } finally {
    removingMemberId.value = null
  }
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
const orphanedUsers = vueComputed(() => adminStore.orphanedUsers || [])

// MASTER ROSTER (global user list)
const masterSearch = vueRef('')

const allUsers = vueComputed(() => adminStore.users || [])

const teamNameFor = (teamId) => {
  if (!teamId) return 'Geen'
  const teams = adminStore.teams || []
  const team = teams.find((t) => t.id === teamId)
  return team?.name || 'Geen'
}

const masterRosterRows = vueComputed(() => {
  const term = masterSearch.value.trim().toLowerCase()
  if (!term) return allUsers.value

  return allUsers.value.filter((u) => {
    const name =
      (u.displayName || u.profile?.fullName || '').toString().toLowerCase()
    const email = (u.email || u.profile?.email || '').toString().toLowerCase()
    return name.includes(term) || email.includes(term)
  })
})

const masterColumns = [
  {
    name: 'directive',
    label: '',
    field: () => '',
    align: 'center',
    sortable: false,
    style: 'width: 28px',
  },
  {
    name: 'name',
    label: 'Naam',
    field: (row) => row.displayName || row.profile?.fullName || '—',
    align: 'left',
    sortable: true,
  },
  {
    name: 'email',
    label: 'Email',
    field: (row) => row.email || row.profile?.email || '—',
    align: 'left',
    sortable: true,
  },
  {
    name: 'team',
    label: 'Huidig Team',
    field: (row) => teamNameFor(row.teamId),
    align: 'left',
    sortable: true,
  },
  {
    name: 'role',
    label: 'Rol',
    field: (row) => row.profile?.role || 'user',
    align: 'left',
    sortable: true,
  },
  {
    name: 'actions',
    label: '',
    field: () => '',
    align: 'right',
    sortable: false,
    style: 'width: 88px',
  },
]

function directiveFromAcwr(acwr) {
  const v = Number(acwr)
  if (!Number.isFinite(v)) return null
  if (v > 1.5) return 'REST'
  if (v > 1.3) return 'RECOVER'
  if (v >= 0.8 && v <= 1.3) return 'PUSH'
  return 'MAINTAIN'
}

const directiveLabelFor = (row) => {
  const d = row.directive ?? directiveFromAcwr(row.metrics?.acwr ?? row.acwr)
  return d ? String(d) : 'Klik voor details'
}

const directiveDotClass = (row) => {
  const d = (row.directive ?? directiveFromAcwr(row.metrics?.acwr ?? row.acwr) ?? '').toString().toUpperCase()
  if (d === 'PUSH') return 'directive-dot-push'
  if (d === 'REST' || d === 'RECOVER') return 'directive-dot-rest'
  if (d === 'MAINTAIN') return 'directive-dot-maintain'
  return 'directive-dot-neutral'
}

const roleChipLabel = (role) => {
  if (role === 'admin') return 'Admin'
  if (role === 'coach') return 'Coach'
  return 'Atleet'
}

const roleChipColor = (role) => {
  if (role === 'admin') return 'negative'
  if (role === 'coach') return 'warning'
  return 'positive'
}

const squadronStore = useSquadronStore()

async function openAthleteDeepDive(user) {
  const id = user?.id ?? user?.userId
  if (!id) return
  try {
    await squadronStore.fetchAtleetDeepDive(id)
  } catch (err) {
    console.error('Failed to load athlete deep dive', err)
    Notify.create({
      type: 'negative',
      message: err?.message || 'Kon atleetdetails niet laden.',
    })
  }
}

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

// Atleet detail dialog (Telemetry Injector + Profile)
const atleetDetailOpen = vueRef(false)
const selectedAtleet = vueRef(null)
const openAtleetDetail = (user) => {
  selectedAtleet.value = user
  atleetDetailOpen.value = true
}
const onAtleetDetailUpdated = () => {
  adminStore.fetchAllData()
}

// Local select state for assignments
const userAssignments = vueRef({})

const teamOptions = vueComputed(() => [
  { label: 'Geen team', value: null },
  ...(adminStore.teams || []).map((team) => ({
    label: team.name || 'Unnamed Squad',
    value: team.id,
  })),
])

const onAssignTeam = async (userId, teamId) => {
  if (!userId) return
  try {
    await adminStore.assignUserToTeam(userId, teamId ?? null)
    Notify.create({
      type: 'positive',
      message: teamId ? 'Atleet gekoppeld aan team.' : 'Atleet losgekoppeld van team.',
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
const teamsWithOccupancy = vueComputed(() => {
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

// Expandable teams: which team rows are expanded (show members)
const teamsExpanded = vueRef([])

const membersForTeam = (teamId) => {
  const users = adminStore.users || []
  return users.filter((u) => u.teamId === teamId)
}

const memberColumns = [
  {
    name: 'name',
    label: 'Name',
    field: (row) => row.displayName || row.profile?.fullName || '—',
    align: 'left',
    sortable: true,
  },
  {
    name: 'email',
    label: 'Email',
    field: (row) => row.email || row.profile?.email || '—',
    align: 'left',
    sortable: true,
  },
]

const teamColumns = [
  {
    name: 'expand',
    label: '',
    field: () => '',
    align: 'left',
    sortable: false,
    expand: true,
  },
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
  {
    name: 'actions',
    label: 'Acties',
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

const handleRenameTeam = (team) => {
  if (!team?.id) return
  $q.dialog({
    title: 'Team hernoemen',
    message: 'Voer de nieuwe naam in voor dit team:',
    prompt: {
      model: team.name || '',
      type: 'text',
    },
    cancel: true,
    persistent: true,
  }).onOk(async (val) => {
    const newName = (val || '').trim()
    if (!newName || newName === team.name) return
    try {
      await adminStore.renameTeam(team.id, newName)
      Notify.create({
        type: 'positive',
        message: 'Teamnaam bijgewerkt.',
      })
      await adminStore.fetchAllData()
    } catch (err) {
      console.error('Failed to rename team', err)
      Notify.create({
        type: 'negative',
        message: err?.message || 'Teamnaam wijzigen mislukt.',
      })
    }
  })
}

const handleDeleteTeam = (team) => {
  if (!team?.id) return
  $q.dialog({
    title: 'Team verwijderen',
    message:
      'Weet je het zeker? De atleten in dit team worden ongekoppeld (Ghosts) maar niet verwijderd.',
    ok: {
      label: 'Verwijderen',
      color: 'negative',
    },
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    try {
      await adminStore.deleteTeam(team.id)
      Notify.create({
        type: 'positive',
        message: 'Team verwijderd. Atleten zijn nu ongekoppeld.',
      })
      await adminStore.fetchAllData()
    } catch (err) {
      console.error('Failed to delete team', err)
      Notify.create({
        type: 'negative',
        message: err?.message || 'Team verwijderen mislukt.',
      })
    }
  })
}

const deletingUserId = vueRef(null)
const handleBekijkAlsAtleet = async (user) => {
  if (!user?.id && !user?.userId) return
  authStore.startImpersonation(user)
  await router.push('/dashboard')
  dashboardStore.fetchUserDashboard().catch(() => {})
}

const handleDeleteUser = (user) => {
  const uid = user?.id ?? user?.userId
  if (!uid) return
  const name = user?.displayName || user?.profile?.fullName || user?.email || uid
  $q.dialog({
    title: 'Gebruiker verwijderen',
    message: `Weet je het zeker? Alle Firestore-data (profiel, dailyLogs, activiteiten) en het Auth-account van "${String(name).slice(0, 50)}${String(name).length > 50 ? '…' : ''}" worden permanent verwijderd.`,
    ok: {
      label: 'Verwijderen',
      color: 'negative',
    },
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    deletingUserId.value = uid
    try {
      await adminStore.deleteUser(uid)
      Notify.create({
        type: 'positive',
        message: 'Gebruiker verwijderd (Auth + Firestore).',
      })
      await adminStore.fetchAllData()
    } catch (err) {
      console.error('Failed to delete user', err)
      Notify.create({
        type: 'negative',
        message: err?.message || 'Gebruiker verwijderen mislukt.',
      })
    } finally {
      deletingUserId.value = null
    }
  })
}

// KPIs
const systemCapacity = vueComputed(() => adminStore.systemCapacity || 0)
const systemLoadPercent = vueComputed(() => {
  if (!systemCapacity.value) return 0
  return (adminStore.totalUsers / systemCapacity.value) * 100
})

// Redirect non-admins (router also guards /admin; this handles late-load or direct mount)
watch(
  () => authStore.isAuthReady && !authStore.isAdmin,
  (shouldRedirect) => {
    if (shouldRedirect) router.replace('/dashboard')
  },
  { immediate: true }
)

onMountedHook(() => {
  if (authStore.isAdmin) {
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

.ghost-table-clickable :deep(.q-table tbody tr) {
  cursor: pointer;
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

.team-members-expand {
  background: rgba(255, 255, 255, 0.02);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.members-table-clickable :deep(.q-table tbody tr) {
  cursor: pointer;
}

.members-table :deep(.q-table thead tr th) {
  background: rgba(255, 255, 255, 0.04) !important;
  color: rgba(255, 255, 255, 0.85) !important;
  font-size: 0.7rem;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.members-table :deep(.q-table tbody td) {
  color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.06) !important;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
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

.admin-table-master-clickable :deep(.q-table tbody tr) {
  cursor: pointer;
}

.directive-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.directive-dot-push { background: #22c55e; }
.directive-dot-maintain { background: #fbbf24; }
.directive-dot-rest { background: #ef4444; }
.directive-dot-neutral { background: rgba(255, 255, 255, 0.25); }

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
