<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    maximized
    class="pilot-detail-dialog"
    @update:model-value="(v) => $emit('update:modelValue', v)"
  >
    <q-card class="pilot-detail-card" dark flat>
      <q-card-section class="dialog-header row items-center justify-between">
        <div>
          <div class="dialog-title">ATLEET DOSSIER</div>
          <div class="dialog-subtitle">
            {{ pilotName }} • {{ pilotEmail }}
          </div>
        </div>
        <q-btn
          flat
          round
          dense
          icon="close"
          color="grey"
          @click="$emit('update:modelValue', false)"
        />
      </q-card-section>

      <q-tabs
        v-model="activeTab"
        dense
        align="left"
        class="pilot-tabs"
        active-color="primary"
        indicator-color="primary"
      >
        <q-tab name="profile" label="Profiel" />
        <q-tab name="status" label="Status" />
        <q-tab name="injector" label="Geschiedenis / Import" />
      </q-tabs>

      <q-separator dark />

      <q-tab-panels v-model="activeTab" animated class="tab-panels">
        <!-- Tab 1: Profile -->
        <q-tab-panel name="profile" class="q-pa-lg">
          <div class="profile-fields">
            <!-- Account -->
            <div class="section-header">ACCOUNT</div>
            <q-input
              :model-value="pilotName"
              label="Naam"
              outlined
              dark
              readonly
              dense
              class="profile-input"
            />
            <q-input
              :model-value="pilotEmail"
              label="Email"
              outlined
              dark
              readonly
              dense
              type="email"
              class="profile-input"
            />
            <q-select
              :model-value="localTeamId"
              :options="teamOptions"
              emit-value
              map-options
              label="Team"
              outlined
              dark
              dense
              options-dense
              class="profile-input"
              @update:model-value="onTeamChange"
            />
            <q-select
              :model-value="localRole"
              :options="roleOptions"
              emit-value
              map-options
              label="Rol"
              outlined
              dark
              dense
              options-dense
              class="profile-input"
              @update:model-value="onRoleChange"
            />

            <q-separator dark inset class="q-my-md" />

            <!-- Bio-Clock configuratie -->
            <div class="section-header">BIO-CLOCK CONFIGURATIE</div>
            <q-input
              v-model.number="localCycleLength"
              label="Cyclustijd (dagen)"
              type="number"
              outlined
              dark
              dense
              class="profile-input"
            />
            <q-input
              v-model="localLastPeriodDate"
              label="Laatste menstruatie (YYYY-MM-DD)"
              type="date"
              outlined
              dark
              dense
              class="profile-input"
            />
            <q-toggle
              v-model="localOnboardingCompleted"
              color="amber"
              label="Intake voltooid"
              class="profile-toggle"
            />

            <q-separator dark inset class="q-my-md" />

            <!-- Fysieke kenmerken -->
            <div class="section-header">FYSIEKE KENMERKEN</div>
            <q-input
              v-model="localBirthDate"
              label="Geboortedatum"
              type="date"
              outlined
              dark
              dense
              class="profile-input"
            />
            <q-input
              v-model.number="localWeight"
              label="Gewicht (kg)"
              type="number"
              outlined
              dark
              dense
              class="profile-input"
            />
          </div>
          <div class="profile-actions row items-center justify-between q-mt-md">
            <div class="row items-center q-gutter-sm">
              <q-btn
                v-if="profileDirty"
                label="Profiel opslaan"
                color="primary"
                unelevated
                :loading="profileSaving"
                @click="saveProfile"
              />
              <q-btn
                v-if="canImpersonate"
                flat
                color="primary"
                icon="visibility"
                label="BEKIJK DASHBOARD"
                no-caps
                @click="handleImpersonate"
              />
            </div>
            <q-space />
            <q-btn
              outline
              color="negative"
              icon="delete"
              label="Verwijder Atleet"
              no-caps
              @click="confirmDelete = true"
            />
            <q-btn
              outline
              color="orange"
              icon="move_up"
              label="MIGREER DATA"
              no-caps
              class="q-ml-sm"
              @click="openMigrateDialog"
            />
          </div>

          <q-dialog v-model="confirmDelete" persistent>
            <q-card class="confirm-delete-card" dark>
              <q-card-section>
                <div class="text-h6">Atleet verwijderen?</div>
              </q-card-section>
              <q-card-section class="q-pt-none">
                <div class="text-body2">
                  Weet je zeker dat je deze atleet en alle gekoppelde data wilt verwijderen?
                  Deze actie kan niet ongedaan worden gemaakt.
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn flat label="Annuleren" v-close-popup />
                <q-btn
                  color="negative"
                  label="Verwijderen"
                  :loading="deleting"
                  @click="handleDeletePilot"
                />
              </q-card-actions>
            </q-card>
          </q-dialog>

          <!-- Data migration dialog -->
          <q-dialog v-model="migrateDialog" persistent>
            <q-card class="confirm-delete-card" dark>
              <q-card-section>
                <div class="text-h6">Data migreren</div>
              </q-card-section>
              <q-card-section class="q-pt-none">
                <div class="text-body2 q-mb-md">
                  Dit verplaatst alle logs en activiteiten van
                  <strong>{{ pilotName }}</strong>
                  naar
                  <strong>{{ targetPilotName || '—' }}</strong>.
                  Dit kan niet ongedaan worden gemaakt.
                </div>
                <q-select
                  v-model="migrateTargetUid"
                  :options="otherAthleteOptions"
                  emit-value
                  map-options
                  label="Nieuwe account (doel atleet)"
                  outlined
                  dark
                  dense
                  options-dense
                  use-input
                  input-debounce="0"
                  :loading="migrating"
                  popup-content-class="bg-black"
                >
                  <template #option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section>
                        <q-item-label>{{ scope.opt.label }}</q-item-label>
                        <q-item-label v-if="scope.opt.caption" caption>
                          {{ scope.opt.caption }}
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                </q-select>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn flat label="Annuleren" v-close-popup :disable="migrating" />
                <q-btn
                  color="orange"
                  label="Bevestig migratie"
                  :loading="migrating"
                  :disable="!migrateTargetUid || migrating"
                  @click="handleMigrateData"
                />
              </q-card-actions>
            </q-card>
          </q-dialog>
        </q-tab-panel>

        <!-- Tab 2: Recente status -->
        <q-tab-panel name="status" class="q-pa-lg">
          <div class="status-section">
            <div class="status-header">RECENTE STATUS (LAATSTE 7 LOGS)</div>
            <div v-if="historyLoading" class="status-loading">
              Laden...
            </div>
            <div v-else-if="recentLogs.length === 0" class="status-empty">
              Geen logs gevonden voor deze atleet.
            </div>
            <div v-else class="status-table-wrap q-mt-sm">
              <table class="status-table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>HRV</th>
                    <th>RHR</th>
                    <th>Readiness</th>
                    <th>Directive</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="log in recentLogs.slice(0, 7)" :key="log.id">
                    <td>{{ formatLogDate(log) }}</td>
                    <td>{{ formatMetric(log?.metrics?.hrv) }}</td>
                    <td>{{ formatMetric(log?.metrics?.rhr?.current) }}</td>
                    <td>{{ formatMetric(log?.metrics?.readiness) }}</td>
                    <td>
                      <span :class="['status-pill', directiveClass(log)]">
                        {{ (log?.recommendation?.status || '—').toUpperCase() }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </q-tab-panel>

        <!-- Tab 2: Telemetry Injector -->
        <q-tab-panel name="injector" class="q-pa-lg">
          <div class="injector-section">
            <div class="injector-label">PASTE HISTORICAL DATA (Garmin / manual)</div>
            <div class="injector-hint">One line per day: YYYY-MM-DD HRV RHR</div>
            <q-input
              v-model="injectorRaw"
              type="textarea"
              outlined
              dark
              autogrow
              placeholder="2025-01-01  52  58&#10;2025-01-02  48  60&#10;2025-01-03  55  57"
              class="injector-textarea q-mt-sm"
              @update:model-value="parseInjectorInput"
            />
            <div v-if="recognizedEntries.length > 0" class="injector-preview q-mt-md">
              <div class="injector-preview-label">
                RECOGNIZED ENTRIES — Ready to inject {{ recognizedEntries.length }} days
              </div>
              <div class="injector-table-wrap">
                <table class="injector-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>HRV</th>
                      <th>RHR</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in recognizedEntries.slice(0, 20)" :key="i">
                      <td>{{ row.date }}</td>
                      <td>{{ row.hrv }}</td>
                      <td>{{ row.rhr }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-if="recognizedEntries.length > 20" class="injector-more">
                  + {{ recognizedEntries.length - 20 }} more
                </div>
              </div>
            </div>
            <q-btn
              label="INJECT DATA"
              color="primary"
              unelevated
              :loading="injecting"
              :disable="recognizedEntries.length === 0"
              class="inject-btn q-mt-md"
              @click="injectData"
            />
          </div>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Notify } from 'quasar'
import { injectHistory, updateUserProfile, migrateUserData, getUserDetails, getUserHistory } from '../services/adminService'
import { useAdminStore } from '../stores/admin'
import { useAuthStore } from '../stores/auth'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  user: { type: Object, default: null },
  teamOptions: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'updated'])

const router = useRouter()
const adminStore = useAdminStore()
const authStore = useAuthStore()
const activeTab = ref('profile')
const injectorRaw = ref('')
const recognizedEntries = ref([])
const injecting = ref(false)
const localTeamId = ref(null)
const localRole = ref('user')
const profileSaving = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)
const migrateDialog = ref(false)
const migrateTargetUid = ref(null)
const migrating = ref(false)
const localCycleLength = ref(null)
const localLastPeriodDate = ref('')
const localOnboardingCompleted = ref(false)
const localBirthDate = ref('')
const localWeight = ref(null)
const backendProfile = ref(null)
const recentLogs = ref([])
const historyLoading = ref(false)

const LINE_REGEX = /(\d{4}-\d{2}-\d{2})\s+(\d+)\s+(\d+)/

const pilotName = computed(() => {
  const u = props.user
  if (!u) return '—'
  return u.displayName || u.profile?.fullName || u.email || u.profile?.email || '—'
})

const pilotEmail = computed(() => {
  const u = props.user
  if (!u) return '—'
  return u.email || u.profile?.email || '—'
})

const otherAthleteOptions = computed(() => {
  const currentId = props.user?.id
  return (adminStore.users || [])
    .filter((u) => u.id !== currentId)
    .map((u) => ({
      label: u.profile?.fullName || u.displayName || u.email || u.id,
      value: u.id,
      caption: u.email || u.profile?.email || u.id,
    }))
})

const targetPilotName = computed(() => {
  if (!migrateTargetUid.value) return ''
  const users = adminStore.users || []
  const u = users.find((user) => user.id === migrateTargetUid.value)
  if (!u) return ''
  return u.profile?.fullName || u.displayName || u.email || u.id
})

const profileDirty = computed(() => {
  const u = props.user
  if (!u) return false
  const p = backendProfile.value || u.profile || {}
  const cycle = p.cycleData || {}

  const origTeam = u.teamId ?? null
  const origRole = p.role ?? 'user'
  const origCycleLength = cycle.avgDuration ?? null
  const origLastPeriod = cycle.lastPeriod || ''
  const origOnboarding =
    (u.onboardingComplete ?? p.onboardingCompleted ?? u.profileComplete) ?? false
  const origBirthDate = p.birthDate || ''
  const origWeight = p.weight != null ? Number(p.weight) : null

  const curCycleLength = localCycleLength.value != null ? Number(localCycleLength.value) : null
  const curWeight = localWeight.value != null ? Number(localWeight.value) : null

  return (
    localTeamId.value !== origTeam ||
    localRole.value !== origRole ||
    curCycleLength !== origCycleLength ||
    (localLastPeriodDate.value || '') !== origLastPeriod ||
    Boolean(localOnboardingCompleted.value) !== Boolean(origOnboarding) ||
    (localBirthDate.value || '') !== origBirthDate ||
    curWeight !== origWeight
  )
})

const roleOptions = [
  { label: 'User (Atleet)', value: 'user' },
  { label: 'Coach', value: 'coach' },
  { label: 'Admin', value: 'admin' }
]

function hydrateFromProfile(profileOverride) {
  const u = props.user
  const p = profileOverride || u?.profile || {}
  const cycle = p.cycleData || {}

  localTeamId.value = u?.teamId ?? null
  localRole.value = p.role ?? 'user'

  localCycleLength.value = cycle.avgDuration ?? null
  localLastPeriodDate.value = cycle.lastPeriod || ''
  localOnboardingCompleted.value =
    (u?.onboardingComplete ?? p.onboardingCompleted ?? u?.profileComplete) ?? false

  localBirthDate.value = p.birthDate || ''
  localWeight.value = p.weight != null ? Number(p.weight) : null

  injectorRaw.value = ''
  recognizedEntries.value = []
}

watch(
  () => props.user,
  (u) => {
    if (u) {
      hydrateFromProfile(backendProfile.value)
    }
  },
  { immediate: true }
)

watch(
  () => props.modelValue,
  (visible) => {
    if (visible && props.user?.id) {
      loadProfileAndHistory()
    }
  }
)

const canImpersonate = computed(() => authStore.isAdmin)

function parseInjectorInput() {
  const text = injectorRaw.value || ''
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const entries = []
  for (const line of lines) {
    const m = line.match(LINE_REGEX)
    if (m) {
      const date = m[1]
      const hrv = parseInt(m[2], 10)
      const rhr = parseInt(m[3], 10)
      if (!isNaN(hrv) && !isNaN(rhr)) {
        entries.push({ date, hrv, rhr })
      }
    }
  }
  recognizedEntries.value = entries
}

function onTeamChange(teamId) {
  localTeamId.value = teamId
}

function onRoleChange(role) {
  localRole.value = role
}

function openMigrateDialog() {
  migrateTargetUid.value = null
  migrateDialog.value = true
}

async function loadProfileAndHistory() {
  const uid = props.user?.id
  if (!uid) return

  try {
    const [profile, history] = await Promise.all([
      getUserDetails(uid).catch((e) => {
        console.error('Failed to load profile details', e)
        return null
      }),
      (async () => {
        historyLoading.value = true
        try {
          return await getUserHistory(uid)
        } catch (e) {
          console.error('Failed to load history', e)
          return []
        } finally {
          historyLoading.value = false
        }
      })(),
    ])

    if (profile) {
      backendProfile.value = profile
      hydrateFromProfile(profile)
    }
    recentLogs.value = Array.isArray(history) ? history : []
  } catch (e) {
    console.error('loadProfileAndHistory error', e)
  }
}

async function saveProfile() {
  const uid = props.user?.id
  if (!uid) return
  profileSaving.value = true
  try {
    const u = props.user
    const p = backendProfile.value || u?.profile || {}
    const cycle = p.cycleData || {}

    if (localTeamId.value !== (u?.teamId ?? null)) {
      await adminStore.assignUserToTeam(uid, localTeamId.value)
    }

    const profilePatch = {}

    if (localRole.value !== (p.role ?? 'user')) {
      profilePatch.role = localRole.value
    }

    const cyclePatch = {}
    const curCycleLength = localCycleLength.value != null ? Number(localCycleLength.value) : null
    if (curCycleLength !== (cycle.avgDuration ?? null)) {
      cyclePatch.avgDuration = curCycleLength
    }
    if ((localLastPeriodDate.value || '') !== (cycle.lastPeriod || '')) {
      cyclePatch.lastPeriod = localLastPeriodDate.value || null
    }
    if (Object.keys(cyclePatch).length > 0) {
      profilePatch.cycleData = cyclePatch
    }

    const origOnboarding =
      (u?.onboardingComplete ?? p.onboardingCompleted ?? u?.profileComplete) ?? false
    if (Boolean(localOnboardingCompleted.value) !== Boolean(origOnboarding)) {
      profilePatch.onboardingCompleted = Boolean(localOnboardingCompleted.value)
    }

    const origBirthDate = p.birthDate || ''
    if ((localBirthDate.value || '') !== origBirthDate) {
      profilePatch.birthDate = localBirthDate.value || null
    }

    const origWeight = p.weight != null ? Number(p.weight) : null
    const curWeight = localWeight.value != null ? Number(localWeight.value) : null
    if (curWeight !== origWeight) {
      profilePatch.weight = curWeight
    }

    if (Object.keys(profilePatch).length > 0) {
      await updateUserProfile(uid, profilePatch)
      backendProfile.value = {
        ...(backendProfile.value || p),
        ...profilePatch,
        cycleData: {
          ...(p.cycleData || {}),
          ...(profilePatch.cycleData || {}),
        },
      }
    }
    Notify.create({ type: 'positive', message: 'Profiel opgeslagen.' })
    emit('updated')
  } catch (e) {
    Notify.create({ type: 'negative', message: e?.message || 'Failed to save profile' })
  } finally {
    profileSaving.value = false
  }
}

async function injectData() {
  const uid = props.user?.id
  if (!uid || recognizedEntries.value.length === 0) return
  injecting.value = true
  try {
    const payload = recognizedEntries.value.map((e) => ({
      date: e.date,
      hrv: Number(e.hrv),
      rhr: Number(e.rhr)
    }))
    const result = await injectHistory(uid, payload)
    Notify.create({
      type: 'positive',
      message: `Geïnjecteerd: ${result.injected} dag(en) aan telemetry.`
    })
    emit('updated')
    emit('update:modelValue', false)
  } catch (e) {
    Notify.create({
      type: 'negative',
      message: e?.message || 'Inject failed'
    })
  } finally {
    injecting.value = false
  }
}

async function handleDeletePilot() {
  const uid = props.user?.id
  if (!uid) return
  deleting.value = true
  try {
    await adminStore.deleteUser(uid)
    Notify.create({
      type: 'positive',
      message: 'Atleet verwijderd.',
    })
    confirmDelete.value = false
    emit('updated')
    emit('update:modelValue', false)
  } catch (e) {
    console.error('Failed to delete pilot', e)
    Notify.create({
      type: 'negative',
      message: e?.message || 'Verwijderen mislukt.',
    })
  } finally {
    deleting.value = false
  }
}

async function handleMigrateData() {
  const sourceId = props.user?.id
  const targetId = migrateTargetUid.value
  if (!sourceId || !targetId || sourceId === targetId) {
    Notify.create({
      type: 'negative',
      message: 'Ongeldige bron- of doelatleet geselecteerd.',
    })
    return
  }

  migrating.value = true
  try {
    const result = await migrateUserData(sourceId, targetId)
    const logsMoved = result?.logsMoved ?? 0
    const activitiesMoved = result?.activitiesMoved ?? 0
    Notify.create({
      type: 'positive',
      message: `Data gemigreerd. Logs: ${logsMoved}, activiteiten: ${activitiesMoved}.`,
    })
    migrateDialog.value = false
    emit('updated')
  } catch (e) {
    console.error('Failed to migrate data', e)
    Notify.create({
      type: 'negative',
      message: e?.message || 'Data migratie mislukt.',
    })
  } finally {
    migrating.value = false
  }
}

async function handleImpersonate() {
  if (!props.user?.id) return
  console.log('Button clicked for user:', props.user.id)

  // 1. Set the state in the store
  authStore.startImpersonation(props.user)

  // 2. Close the dialog manually
  emit('update:modelValue', false)

  // 3. Force navigation from the component (more reliable)
  try {
    await router.push('/dashboard')
  } catch (e) {
    console.error('Navigation to /dashboard failed', e)
  }
}

function formatLogDate(log) {
  if (!log) return '—'
  if (typeof log.date === 'string' && log.date.length >= 10) {
    return log.date.slice(0, 10)
  }
  if (typeof log.timestamp === 'string' && log.timestamp.length >= 10) {
    return log.timestamp.slice(0, 10)
  }
  return '—'
}

function formatMetric(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Math.round(Number(value))
}

function directiveClass(log) {
  const status = (log?.recommendation?.status || '').toUpperCase()
  if (status === 'PUSH') return 'status-pill-push'
  if (status === 'REST' || status === 'RECOVER') return 'status-pill-rest'
  return 'status-pill-neutral'
}
</script>

<style scoped lang="scss">
.pilot-detail-dialog :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.85);
}

.pilot-detail-card {
  background: #050505 !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  max-width: 640px;
  margin: auto;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 16px 20px;
}

.dialog-title {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #fbbf24;
}

.dialog-subtitle {
  font-size: 0.8rem;
  color: rgba(156, 163, 175, 0.95);
  margin-top: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.pilot-tabs {
  padding: 0 20px;
  min-height: 40px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.pilot-tabs :deep(.q-tab) {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.75rem;
  font-weight: 600;
}

.tab-panels {
  flex: 1;
  overflow: auto;
  background: #050505;
}

.profile-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
}

.profile-actions {
  max-width: 400px;
}

.section-header {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #fbbf24;
  font-weight: 700;
  margin-bottom: 6px;
}

.profile-toggle {
  margin-top: 4px;
}

.profile-input :deep(.q-field__control) {
  color: rgba(255, 255, 255, 0.9);
}

.profile-input :deep(.q-field__outline) {
  border-color: rgba(255, 255, 255, 0.15);
}

.injector-section {
  max-width: 560px;
}

.injector-label {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #fbbf24;
  font-weight: 700;
}

.injector-hint {
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
  margin-top: 4px;
}

.injector-textarea {
  min-height: 160px;
}

.injector-textarea :deep(.q-field__control) {
  color: rgba(255, 255, 255, 0.9);
}

.injector-textarea :deep(.q-field__native) {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.85rem;
}

.injector-preview-label {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(156, 163, 175, 0.95);
  margin-bottom: 8px;
}

.injector-table-wrap {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.injector-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.8rem;
}

.injector-table th {
  text-align: left;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.injector-table td {
  padding: 8px 12px;
  color: rgba(255, 255, 255, 0.9);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.injector-table tbody tr:last-child td {
  border-bottom: none;
}

.injector-more {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.inject-btn {
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-weight: 700;
}

.confirm-delete-card {
  background: #050505 !important;
  border-radius: 2px !important;
  border: 1px solid rgba(239, 68, 68, 0.6) !important;
  box-shadow: none !important;
}

.status-section {
  max-width: 560px;
}

.status-header {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #fbbf24;
  font-weight: 700;
}

.status-loading,
.status-empty {
  margin-top: 8px;
  font-size: 0.8rem;
  color: rgba(156, 163, 175, 0.9);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.status-table-wrap {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.status-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.8rem;
}

.status-table th {
  text-align: left;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.status-table td {
  padding: 6px 10px;
  color: rgba(255, 255, 255, 0.9);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.status-table tbody tr:last-child td {
  border-bottom: none;
}

.status-pill {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.status-pill-push {
  color: #22c55e;
  border-color: #22c55e;
}

.status-pill-rest {
  color: #ef4444;
  border-color: #ef4444;
}

.status-pill-neutral {
  color: #9ca3af;
  border-color: rgba(255, 255, 255, 0.16);
}
</style>
