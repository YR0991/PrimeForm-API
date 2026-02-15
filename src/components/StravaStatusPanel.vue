<template>
  <div class="strava-status-panel sidebar-block">
    <div class="block-title">STRAVA</div>
    <q-inner-loading :showing="loading" color="#fbbf24" size="24px" />
    <div v-if="error" class="block-content text-negative mono-text">{{ error }}</div>
    <div v-else class="block-content">
      <div class="strava-row row items-center q-gutter-xs">
        <span class="label">Verbonden:</span>
        <span :class="['mono-text', status.connected ? 'text-positive' : 'text-grey-7']">
          {{ status.connected ? 'Ja' : 'Nee' }}
        </span>
        <span v-if="status.connected && status.connectedAt" class="mono-text text-grey-7">
          ({{ formatDate(status.connectedAt) }})
        </span>
      </div>
      <template v-if="status.connected">
        <div v-if="status.lastSuccessAt != null" class="strava-row q-mt-xs">
          <span class="label">Laatste sync:</span>
          <span class="mono-text">{{ formatDate(status.lastSuccessAt) }}</span>
          <span v-if="status.inserted != null" class="mono-text text-grey-7">
            — {{ status.fetched ?? 0 }} opgehaald, {{ status.inserted ?? 0 }} opgeslagen, {{ status.skipped ?? 0 }} overgeslagen
          </span>
        </div>
        <div v-if="status.lastError" class="strava-row q-mt-xs text-negative mono-text">
          Fout: {{ status.lastError }}
        </div>
        <div v-if="isAdmin" class="q-mt-sm">
          <q-btn
            dense
            flat
            no-caps
            size="sm"
            color="amber"
            icon="sync"
            label="Force sync"
            :loading="syncing"
            class="force-sync-btn"
            @click="onForceSync"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { getStravaStatus, syncUserStravaNow } from '../services/adminService'

const props = defineProps({
  uid: { type: String, default: '' },
  isAdmin: { type: Boolean, default: false }
})

const emit = defineEmits(['synced'])

const loading = ref(false)
const syncing = ref(false)
const error = ref(null)
const status = ref({
  connected: false,
  connectedAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastAttemptAt: null,
  newestStoredActivityDate: null,
  fetched: null,
  inserted: null,
  skipped: null
})

function formatDate(v) {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function load() {
  if (!props.uid) {
    status.value = { connected: false, connectedAt: null, lastSuccessAt: null, lastError: null, lastAttemptAt: null, newestStoredActivityDate: null, fetched: null, inserted: null, skipped: null }
    return
  }
  loading.value = true
  error.value = null
  try {
    const data = await getStravaStatus(props.uid)
    status.value = {
      connected: !!data.connected,
      connectedAt: data.connectedAt ?? null,
      lastSuccessAt: data.lastSuccessAt ?? null,
      lastError: data.lastError ?? null,
      lastAttemptAt: data.lastAttemptAt ?? null,
      newestStoredActivityDate: data.newestStoredActivityDate ?? null,
      fetched: data.fetched ?? null,
      inserted: data.inserted ?? null,
      skipped: data.skipped ?? null
    }
  } catch (e) {
    error.value = e.response?.data?.error || e.message || 'Kon status niet laden'
    status.value = { connected: false, connectedAt: null, lastSuccessAt: null, lastError: null, lastAttemptAt: null, newestStoredActivityDate: null, fetched: null, inserted: null, skipped: null }
  } finally {
    loading.value = false
  }
}

async function onForceSync() {
  if (!props.uid || !props.isAdmin) return
  syncing.value = true
  error.value = null
  try {
    await syncUserStravaNow(props.uid)
    await load()
    emit('synced')
  } catch (e) {
    error.value = e.response?.data?.error || e.message || 'Sync mislukt'
  } finally {
    syncing.value = false
  }
}

watch(() => props.uid, load, { immediate: true })
</script>

<style scoped lang="scss">
.strava-status-panel {
  .label {
    color: #9ca3af;
    font-size: 0.85rem;
  }
  .strava-row {
    font-size: 0.875rem;
  }
  .force-sync-btn {
    font-weight: 600;
  }
}
</style>
