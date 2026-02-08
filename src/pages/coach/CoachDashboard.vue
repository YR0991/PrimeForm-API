<template>
  <q-page class="coach-dashboard elite-page">
    <div class="engineer-container">
      <header class="engineer-header">
        <h1 class="engineer-title">SQUADRON VIEW</h1>
        <q-btn
          flat
          round
          icon="refresh"
          color="white"
          size="sm"
          @click="loadSquad"
          :loading="loading"
        />
      </header>

      <q-card class="squadron-card" flat>
        <q-table
          :rows="squad"
          :columns="columns"
          row-key="id"
          :loading="loading"
          flat
          dark
          class="squadron-table"
          @row-click="onRowClick"
        >
          <template #body-cell-athlete="props">
            <q-td :props="props">
              <div class="athlete-cell">
                <q-avatar size="32px" color="rgba(255,255,255,0.1)" text-color="#9ca3af">
                  {{ getInitials(props.row.name) }}
                </q-avatar>
                <div class="athlete-info">
                  <span class="athlete-name">{{ props.row.name }}</span>
                  <span class="athlete-level" :class="`level-${props.row.level}`">
                    <q-icon :name="getLevelIcon(props.row.level)" size="12px" />
                    {{ props.row.level }}
                  </span>
                </div>
              </div>
            </q-td>
          </template>

          <template #body-cell-cycle="props">
            <q-td :props="props">
              <span class="elite-data">{{ props.row.cyclePhase }} · D{{ props.row.cycleDay }}</span>
            </q-td>
          </template>

          <template #body-cell-acwr="props">
            <q-td :props="props">
              <span
                class="acwr-cell elite-data"
                :class="`acwr-${props.row.acwrStatus}`"
              >
                {{ props.row.acwr?.toFixed(2) }}
              </span>
            </q-td>
          </template>

          <template #body-cell-compliance="props">
            <q-td :props="props">
              <span
                class="compliance-badge"
                :class="props.row.compliance ? 'done' : 'pending'"
              >
                {{ props.row.compliance ? 'Gedaan' : '—' }}
              </span>
            </q-td>
          </template>

          <template #body-cell-lastActivity="props">
            <q-td :props="props">
              <span v-if="props.row.lastActivity" class="elite-data">
                {{ props.row.lastActivity.time }} · {{ props.row.lastActivity.type }}
              </span>
              <span v-else class="elite-data" style="color: #9ca3af">—</span>
            </q-td>
          </template>
        </q-table>
      </q-card>

      <!-- Deep Dive Modal -->
      <q-dialog v-model="deepDiveOpen" position="right" full-height>
        <q-card class="deep-dive-card" flat>
          <q-card-section class="deep-dive-header">
            <div class="deep-dive-title">{{ selectedAthlete?.name }}</div>
            <q-btn flat round icon="close" @click="deepDiveOpen = false" />
          </q-card-section>
          <q-card-section v-if="selectedAthlete" class="deep-dive-body">
            <div class="deep-dive-row">
              <span class="label">Cyclus</span>
              <span class="value elite-data">{{ selectedAthlete.cyclePhase }} · D{{ selectedAthlete.cycleDay }}</span>
            </div>
            <div class="deep-dive-row">
              <span class="label">ACWR</span>
              <span class="value elite-data" :class="`acwr-${selectedAthlete.acwrStatus}`">
                {{ selectedAthlete.acwr?.toFixed(2) }}
              </span>
            </div>
            <div class="deep-dive-row">
              <span class="label">Prime Load 7d</span>
              <span class="value elite-data">{{ selectedAthlete.primeLoad7d }}</span>
            </div>
            <div class="deep-dive-row">
              <span class="label">Readiness</span>
              <span class="value elite-data">{{ selectedAthlete.readiness }}/10</span>
            </div>
            <div class="deep-dive-section-label">ACTIVITEITEN (Strava vs Prime)</div>
            <div
              v-for="(act, i) in selectedAthlete.activities"
              :key="i"
              class="deep-dive-activity"
            >
              <span class="elite-data">{{ act.date }}</span>
              <span>{{ act.type }}</span>
              <span class="elite-data">Raw {{ act.rawLoad }}</span>
              <span class="elite-data" style="color: #fbbf24">Prime {{ act.load }}</span>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getCoachSquad } from '../../services/coachService.js'
import { getAthleteDeepDive } from '../../services/userService.js'

const loading = ref(false)
const squad = ref([])
const deepDiveOpen = ref(false)
const selectedAthlete = ref(null)

const columns = [
  { name: 'athlete', label: 'ATLEET', field: 'name', align: 'left' },
  { name: 'cycle', label: 'CYCUS', field: 'cyclePhase', align: 'left' },
  { name: 'acwr', label: 'ACWR', field: 'acwr', align: 'center', sortable: true },
  { name: 'compliance', label: 'CHECK-IN', field: 'compliance', align: 'center' },
  { name: 'lastActivity', label: 'LAATSTE ACTIVITEIT', field: 'lastActivity', align: 'left' },
]

const getInitials = (name) =>
  name?.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || '?'

const getLevelIcon = (level) => {
  if (level === 'elite') return 'emoji_events'
  if (level === 'active') return 'directions_run'
  return 'person'
}

const loadSquad = async () => {
  loading.value = true
  try {
    squad.value = await getCoachSquad()
  } catch (e) {
    console.error('Squad load failed:', e)
  } finally {
    loading.value = false
  }
}

const onRowClick = async (_evt, row) => {
  selectedAthlete.value = null
  deepDiveOpen.value = true
  try {
    selectedAthlete.value = await getAthleteDeepDive(row.id)
  } catch (e) {
    console.error('Deep dive failed:', e)
  }
}

onMounted(() => loadSquad())
</script>

<style scoped lang="scss">
@use '../../css/quasar.variables' as q;

.coach-dashboard {
  background: q.$prime-black;
  min-height: 100vh;
  padding: 24px;
}

.engineer-container {
  max-width: 1100px;
  margin: 0 auto;
}

.engineer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.engineer-title {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1.25rem;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin: 0;
}

.squadron-card {
  background: q.$prime-surface !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: q.$radius-sm !important;
  box-shadow: none !important;
}

.squadron-table :deep(.q-table__top) {
  background: transparent;
}

.squadron-table :deep(thead tr th) {
  background: rgba(255, 255, 255, 0.04) !important;
  color: q.$prime-gray !important;
  font-family: q.$typography-font-family !important;
  font-size: 0.7rem !important;
  text-transform: uppercase !important;
  letter-spacing: 0.1em !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
}

.squadron-table :deep(tbody tr) {
  cursor: pointer;
}

.squadron-table :deep(tbody tr:hover) {
  background: rgba(255, 255, 255, 0.04) !important;
}

.athlete-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.athlete-name {
  font-family: q.$typography-font-family;
  font-weight: 500;
  color: #ffffff;
  display: block;
}

.athlete-level {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: q.$prime-gray;
}

.athlete-level.level-elite {
  color: q.$prime-gold;
}

.acwr-cell.acwr-spike {
  color: q.$status-recover;
}

.acwr-cell.acwr-undertraining {
  color: q.$status-maintain;
}

.acwr-cell.acwr-sweet {
  color: q.$status-push;
}

.compliance-badge {
  display: inline-block;
  border: 1px solid;
  padding: 2px 8px;
  font-size: 0.65rem;
  font-weight: 700;
  font-family: q.$mono-font;
  text-transform: uppercase;
  border-radius: 2px;
}

.compliance-badge.done {
  color: q.$status-push;
  border-color: q.$status-push;
  background: rgba(34, 197, 94, 0.1);
}

.compliance-badge.pending {
  color: q.$prime-gray;
  border-color: rgba(255, 255, 255, 0.2);
}

.deep-dive-card {
  background: q.$prime-black !important;
  border-left: 1px solid rgba(255, 255, 255, 0.08) !important;
  min-width: 360px;
  max-width: 420px;
}

.deep-dive-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 20px;
}

.deep-dive-title {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1rem;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.deep-dive-body {
  padding: 20px;
}

.deep-dive-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.deep-dive-row .label {
  font-family: q.$typography-font-family;
  font-size: 0.7rem;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.deep-dive-row .value {
  font-family: q.$mono-font;
  font-size: 0.9rem;
  color: #ffffff;
}

.deep-dive-section-label {
  font-family: q.$typography-font-family;
  font-size: 0.65rem;
  font-weight: 700;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 20px 0 12px 0;
}

.deep-dive-activity {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 0.8rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
</style>
