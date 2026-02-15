<template>
  <div class="debug-timeline">
    <div class="timeline-toolbar row items-center q-gutter-sm q-mb-md">
      <span class="timeline-label">LAATSTE {{ days }} DAGEN</span>
      <q-btn
        dense
        flat
        size="sm"
        :label="filterRestRecover ? 'REST/RECOVER' : 'All'"
        :color="filterRestRecover ? 'primary' : 'grey'"
        class="filter-chip"
        @click="filterRestRecover = !filterRestRecover"
      />
      <q-btn
        dense
        flat
        size="sm"
        :label="filterNeedsCheckin ? 'Needs check-in' : 'All'"
        :color="filterNeedsCheckin ? 'primary' : 'grey'"
        class="filter-chip"
        @click="filterNeedsCheckin = !filterNeedsCheckin"
      />
      <q-btn
        dense
        flat
        size="sm"
        :label="filterFlagsLow ? 'Flags LOW' : 'All'"
        :color="filterFlagsLow ? 'primary' : 'grey'"
        class="filter-chip"
        @click="filterFlagsLow = !filterFlagsLow"
      />
    </div>

    <q-inner-loading :showing="loading" color="#fbbf24">
      <q-spinner-grid size="40px" color="#fbbf24" />
    </q-inner-loading>

    <div v-if="error" class="timeline-error text-negative q-pa-md">
      {{ error }}
    </div>

    <div v-else-if="filteredDays.length === 0" class="timeline-empty text-grey-7 q-pa-md">
      Geen dagen om weer te geven.
    </div>

    <div v-else class="timeline-list">
      <div
        v-for="row in filteredDays"
        :key="row.date"
        class="timeline-row"
        :class="{ expanded: expandedDate === row.date }"
      >
        <div
          class="timeline-row-main row items-center no-wrap"
          @click="toggleExpand(row.date)"
        >
          <span class="col date-cell mono-text">{{ row.date }}</span>
          <span class="col tag-cell" :class="tagClass(row.output?.tag)">{{ row.output?.tag ?? '—' }}</span>
          <span class="col instruction-cell text-grey-7">{{ row.output?.instructionClass ?? '—' }}</span>
          <span class="col mono-text">{{ formatReadiness(row.inputs?.readiness) }}</span>
          <span class="col mono-text">{{ formatRedFlags(row.derived?.redFlags?.count) }}</span>
          <span class="col mono-text">{{ row.derived?.acwrBand ?? '—' }}</span>
          <span class="col text-grey-7">{{ row.derived?.cycle?.confidence ?? '—' }}</span>
          <span class="col needs-cell">
            <span v-if="row.sourceSummary?.hasCheckin === true" class="has-checkin-badge">CHECK-IN</span>
            <span v-else-if="row.meta?.needsCheckin" class="needs-badge">NEEDS CHECK-IN</span>
            <span v-else class="text-grey-7">—</span>
          </span>
          <q-icon :name="expandedDate === row.date ? 'expand_less' : 'expand_more'" size="sm" class="col-auto" />
        </div>
        <div v-show="expandedDate === row.date" class="timeline-row-detail q-pa-sm">
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">sourceSummary</span>
              <span class="mono-text">checkin: {{ row.sourceSummary?.hasCheckin }}, import: {{ row.sourceSummary?.hasImport }}, strava: {{ row.sourceSummary?.hasStrava }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">redFlagDetails</span>
              <span class="mono-text">{{ (row.derived?.redFlags?.details || []).join('; ') || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">reasons</span>
              <span class="mono-text">{{ (row.output?.reasons || []).join('; ') || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">flagsConfidence</span>
              <span class="mono-text">{{ row.meta?.flagsConfidence ?? '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">engine</span>
              <span class="mono-text">kb {{ row.meta?.kbVersion ?? '—' }} · engine {{ row.meta?.engineVersion ?? '—' }}</span>
            </div>
            <div v-if="(row.derived?.acwrContributors7d || []).length" class="detail-item contributors-section">
              <span class="detail-label">ACWR contributors (top 5)</span>
              <table class="contributors-table mono-text">
                <thead>
                  <tr>
                    <th>date</th>
                    <th>type</th>
                    <th>load</th>
                    <th>source</th>
                    <th>id</th>
                    <th v-if="isAdmin" class="col-action" />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="act in row.derived.acwrContributors7d" :key="act.id || act.date + String(act.load)">
                    <td>{{ act.date }}</td>
                    <td>{{ act.type || '—' }}</td>
                    <td>{{ formatLoad(act.load) }}</td>
                    <td>{{ act.source ?? '—' }}</td>
                    <td class="id-cell">{{ act.id || '—' }}</td>
                    <td v-if="isAdmin" class="col-action">
                      <q-btn
                        v-if="act.source === 'manual' && act.id"
                        flat
                        dense
                        size="sm"
                        color="negative"
                        label="Delete"
                        :loading="deletingId === act.id"
                        @click.stop="onDeleteActivity(act.id)"
                      />
                      <span v-else class="text-grey-7">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="(row.derived?.activities7d || []).length" class="detail-item activities7d-section">
              <span class="detail-label">Activities (7d ACWR)</span>
              <table class="activities7d-table mono-text">
                <thead>
                  <tr>
                    <th>date</th>
                    <th>type</th>
                    <th>load</th>
                    <th>source</th>
                    <th>id</th>
                    <th v-if="isAdmin" class="col-action" />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="act in row.derived.activities7d" :key="act.id || act.date + act.type">
                    <td>{{ act.date }}</td>
                    <td>{{ act.type || '—' }}</td>
                    <td>{{ formatLoad(act.load) }}</td>
                    <td>{{ act.source ?? '—' }}</td>
                    <td class="id-cell">{{ act.id || '—' }}</td>
                    <td v-if="isAdmin" class="col-action">
                      <q-btn
                        v-if="act.source === 'manual' && act.id"
                        flat
                        dense
                        size="sm"
                        color="negative"
                        label="Delete"
                        :loading="deletingId === act.id"
                        @click.stop="onDeleteActivity(act.id)"
                      />
                      <span v-else class="text-grey-7">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { getDebugHistory, deleteActivity, deleteUserActivity } from '../services/adminService'

const props = defineProps({
  uid: { type: String, default: '' },
  days: { type: Number, default: 14 },
  isAdmin: { type: Boolean, default: false }
})

const loading = ref(false)
const error = ref(null)
const timelineData = ref({ profile: null, days: [] })
const expandedDate = ref(null)
const filterRestRecover = ref(false)
const filterNeedsCheckin = ref(false)
const filterFlagsLow = ref(false)
const deletingId = ref(null)

const filteredDays = computed(() => {
  let list = timelineData.value.days || []
  if (filterRestRecover.value) {
    list = list.filter((d) => d.output?.tag === 'REST' || d.output?.tag === 'RECOVER')
  }
  if (filterNeedsCheckin.value) {
    list = list.filter((d) => d.meta?.needsCheckin === true)
  }
  if (filterFlagsLow.value) {
    list = list.filter((d) => d.meta?.flagsConfidence === 'LOW')
  }
  return list
})

function tagClass(tag) {
  if (tag === 'PUSH') return 'tag-push'
  if (tag === 'MAINTAIN') return 'tag-maintain'
  if (tag === 'RECOVER' || tag === 'REST') return 'tag-recover'
  return ''
}

function formatReadiness(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return String(v)
}

function formatRedFlags(v) {
  if (v == null) return '—'
  return String(v)
}

function formatLoad(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return String(Math.round(Number(v) * 10) / 10)
}

async function onDeleteActivity(activityId) {
  if (!activityId) return
  if (props.isAdmin && !props.uid) return
  deletingId.value = activityId
  try {
    if (props.isAdmin) {
      await deleteUserActivity(props.uid, activityId)
    } else {
      await deleteActivity(activityId)
    }
    await load()
  } catch (e) {
    const status = e.response?.status
    if (status === 409) error.value = 'Activiteit hoort niet bij deze atleet'
    else if (status === 403) error.value = 'Geen toegang (admin only)'
    else error.value = e.message || 'Verwijderen mislukt.'
  } finally {
    deletingId.value = null
  }
}

function toggleExpand(date) {
  expandedDate.value = expandedDate.value === date ? null : date
}

async function load() {
  if (!props.uid) {
    timelineData.value = { profile: null, days: [] }
    return
  }
  loading.value = true
  error.value = null
  try {
    timelineData.value = await getDebugHistory(props.uid, props.days)
  } catch (e) {
    error.value = e.response?.status === 403 ? 'Geen toegang (admin only)' : (e.message || 'Kon timeline niet laden.')
  } finally {
    loading.value = false
  }
}

watch([() => props.uid, () => props.days], () => load(), { immediate: true })
</script>

<style scoped lang="scss">
.debug-timeline {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  padding: 12px;
  min-height: 120px;
}

.timeline-label {
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9ca3af;
}

.filter-chip {
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.timeline-error,
.timeline-empty {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
}

.timeline-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline-row {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.02);
}

.timeline-row-main {
  padding: 8px 10px;
  cursor: pointer;
  font-size: 0.8rem;
  min-height: 36px;
}

.timeline-row-main .col {
  flex: 0 0 auto;
  margin-right: 12px;
}

.date-cell { width: 100px; }
.tag-cell { width: 72px; font-weight: 600; }
.instruction-cell { width: 120px; }
.needs-cell { width: 72px; }

.tag-push { color: #22c55e; }
.tag-maintain { color: #fbbf24; }
.tag-recover { color: #ef4444; }

.has-checkin-badge {
  font-size: 0.65rem;
  font-weight: 700;
  color: #22c55e;
  letter-spacing: 0.05em;
}
.needs-badge {
  font-size: 0.65rem;
  font-weight: 700;
  color: #ef4444;
  letter-spacing: 0.05em;
}

.timeline-row-detail {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
  font-size: 0.75rem;
}

.detail-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-label {
  color: #9ca3af;
  margin-right: 8px;
  text-transform: uppercase;
  font-size: 0.65rem;
  letter-spacing: 0.05em;
}

.contributors-section {
  margin-top: 8px;
}
.contributors-table {
  width: 100%;
  font-size: 0.75rem;
  border-collapse: collapse;
  margin-top: 4px;
}
.contributors-table th,
.contributors-table td {
  padding: 4px 8px;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.contributors-table th {
  color: #9ca3af;
  text-transform: uppercase;
  font-size: 0.65rem;
}
.activities7d-section {
  margin-top: 10px;
}
.activities7d-table {
  width: 100%;
  font-size: 0.75rem;
  border-collapse: collapse;
  margin-top: 4px;
}
.activities7d-table th,
.activities7d-table td {
  padding: 4px 8px;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.activities7d-table th {
  color: #9ca3af;
  text-transform: uppercase;
  font-size: 0.65rem;
}
.id-cell {
  word-break: break-all;
  max-width: 120px;
}
.col-action {
  width: 80px;
}

.mono-text {
  font-family: 'JetBrains Mono', monospace;
}
</style>
