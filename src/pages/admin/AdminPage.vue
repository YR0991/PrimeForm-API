<template>
  <q-page class="admin-page">
    <div class="admin-container">
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
              </q-td>
            </template>
          </q-table>
        </q-card-section>
      </q-card>

      <!-- User Detail Dialog -->
      <q-dialog v-model="userDialogOpen" maximized>
        <q-card class="user-dialog-card" dark>
          <q-card-section class="row items-center q-pb-none">
            <div class="text-h6">Gebruiker Details</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>

          <q-card-section v-if="selectedUser">
            <div class="user-header q-mb-md">
              <div class="text-h6">{{ selectedUser.profile?.fullName || 'Geen naam' }}</div>
              <div class="text-caption text-grey">{{ selectedUser.profile?.email || 'Geen e-mail' }}</div>
            </div>

            <q-tabs v-model="dialogTab" align="left" dark active-color="#D4AF37">
              <q-tab name="intake" label="Intake" />
              <q-tab name="history" label="Historie" />
              <q-tab name="import" label="Import Historie" />
            </q-tabs>

            <q-separator />

            <q-tab-panels v-model="dialogTab" animated>
              <!-- Intake Tab -->
              <q-tab-panel name="intake">
                <div v-if="loadingDetails" class="text-center q-pa-lg">
                  <q-spinner color="primary" size="3em" />
                </div>
                <q-list v-else-if="userDetails" dark separator class="admin-list">
                  <q-item>
                    <q-item-section>
                      <q-item-label>Naam</q-item-label>
                      <q-item-label caption>{{ userDetails.fullName || 'Niet ingevuld' }}</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>E-mail</q-item-label>
                      <q-item-label caption>{{ userDetails.email || 'Niet ingevuld' }}</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Geboortedatum</q-item-label>
                      <q-item-label caption>{{ userDetails.birthDate || 'Niet ingevuld' }}</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Doelen</q-item-label>
                      <q-item-label caption>
                        <q-chip
                          v-for="goal in (userDetails.goals || [])"
                          :key="goal"
                          size="sm"
                          color="primary"
                          class="q-mr-xs q-mt-xs"
                        >
                          {{ goal }}
                        </q-chip>
                        <span v-if="!userDetails.goals || userDetails.goals.length === 0">Geen doelen geselecteerd</span>
                      </q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Training Frequentie</q-item-label>
                      <q-item-label caption>{{ userDetails.trainingFrequency || 'Niet ingevuld' }} dagen/week</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Programma Type</q-item-label>
                      <q-item-label caption>{{ userDetails.programmingType || 'Niet ingevuld' }}</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Gemiddelde Slaap</q-item-label>
                      <q-item-label caption>{{ userDetails.sleepAvg || 'Niet ingevuld' }} uur</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Cyclus Duur</q-item-label>
                      <q-item-label caption>{{ userDetails.cycleData?.avgDuration || 'Niet ingevuld' }} dagen</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Laatste Menstruatie</q-item-label>
                      <q-item-label caption>{{ userDetails.cycleData?.lastPeriod || 'Niet ingevuld' }}</q-item-label>
                    </q-item-section>
                  </q-item>

                  <q-item>
                    <q-item-section>
                      <q-item-label>Anticonceptie</q-item-label>
                      <q-item-label caption>{{ userDetails.cycleData?.contraception || 'Niet ingevuld' }}</q-item-label>
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
                <q-timeline v-else-if="userHistory && userHistory.length > 0" color="#D4AF37" side="right" dark>
                  <q-timeline-entry
                    v-for="(entry, index) in userHistory"
                    :key="index"
                    :title="formatDate(entry.timestamp || entry.date)"
                    :subtitle="`Status: ${entry.recommendation?.status || 'N/A'}`"
                  >
                    <div class="history-entry">
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
                      <div v-if="entry.redFlags?.count > 0" class="q-mt-sm">
                        <q-chip color="negative" size="sm">
                          {{ entry.redFlags.count }} Red Flag(s)
                        </q-chip>
                      </div>
                    </div>
                  </q-timeline-entry>
                </q-timeline>
                <div v-else class="text-center q-pa-lg text-grey">
                  Geen check-in geschiedenis beschikbaar
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
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { fetchAllUsers, getUserDetails, getUserHistory, calculateStats, importHistory } from '../../services/adminService.js'

const loading = ref(false)
const users = ref([])
const stats = ref({
  totalMembers: 0,
  newThisWeek: 0,
  checkinsToday: 0
})

const userDialogOpen = ref(false)
const selectedUser = ref(null)
const userDetails = ref(null)
const userHistory = ref([])
const loadingDetails = ref(false)
const loadingHistory = ref(false)
const dialogTab = ref('intake')

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
      const date = row.createdAt?.toDate ? row.createdAt.toDate() : new Date(row.createdAt)
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

const loadUsers = async () => {
  loading.value = true
  try {
    const allUsers = await fetchAllUsers()
    users.value = allUsers
    stats.value = calculateStats(allUsers)
  } catch (error) {
    console.error('Failed to load users:', error)
    users.value = []
  } finally {
    loading.value = false
  }
}

const openUserDialog = async (user) => {
  selectedUser.value = user
  userDialogOpen.value = true
  dialogTab.value = 'intake'
  userDetails.value = null
  userHistory.value = []

  // Load user details
  loadingDetails.value = true
  try {
    userDetails.value = await getUserDetails(user.id || user.userId)
  } catch (error) {
    console.error('Failed to load user details:', error)
  } finally {
    loadingDetails.value = false
  }

  // Load user history
  await loadUserHistory(user.id || user.userId)
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

// Watch for dialog tab changes to reset import when switching away
watch(dialogTab, (newTab) => {
  if (newTab !== 'import') {
    resetImport()
  }
})

onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@1,900&family=Inter:wght@300;400;600&display=swap');

.admin-page {
  background: #000000;
  min-height: 100vh;
  padding: 24px;
}

.admin-container {
  max-width: 1400px;
  margin: 0 auto;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.admin-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  color: #D4AF37;
  font-size: 2rem;
  margin: 0;
  letter-spacing: 2px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stat-card {
  background: rgba(18, 18, 18, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.stat-card :deep(.q-card__section) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 900;
  color: #D4AF37;
  font-family: 'Montserrat', sans-serif;
}

.stat-label {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 8px;
  font-family: 'Inter', sans-serif;
}

.users-card {
  background: rgba(18, 18, 18, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.users-card :deep(.q-card__section) {
  color: rgba(255, 255, 255, 0.9) !important;
  background: transparent !important;
}

.users-card :deep(.text-h6) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card {
  background: #000000 !important;
  min-width: 90vw;
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.q-card__section) {
  background: #000000 !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.text-h6) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.user-dialog-card :deep(.text-caption) {
  color: rgba(255, 255, 255, 0.6) !important;
}

.user-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 16px;
}

.history-entry {
  background: rgba(18, 18, 18, 0.5);
  padding: 12px;
  border-radius: 4px;
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.9);
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
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background: rgba(18, 18, 18, 0.5);
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
  border-color: #D4AF37 !important;
}

/* Q-Tabs styling */
.user-dialog-card :deep(.q-tabs) {
  background: transparent;
}

.user-dialog-card :deep(.q-tab) {
  color: rgba(255, 255, 255, 0.6) !important;
}

.user-dialog-card :deep(.q-tab--active) {
  color: #D4AF37 !important;
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
  border-color: #D4AF37 !important;
}

/* Q-Banner styling */
.import-section :deep(.q-banner) {
  color: rgba(255, 255, 255, 0.9) !important;
}

/* Q-Chip styling */
.user-dialog-card :deep(.q-chip) {
  background: rgba(212, 175, 55, 0.2) !important;
  color: #D4AF37 !important;
  border: 1px solid rgba(212, 175, 55, 0.3) !important;
}

/* Q-Spinner styling */
.user-dialog-card :deep(.q-spinner) {
  color: #D4AF37 !important;
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
  border-color: #D4AF37 !important;
}

/* Import number inputs */
.import-number-input :deep(.q-field__native) {
  color: rgba(255, 255, 255, 0.9) !important;
}

.import-number-input :deep(.q-field__outline) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.import-number-input :deep(.q-field--focused .q-field__outline) {
  border-color: #D4AF37 !important;
}
</style>
