<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    class="week-report-dialog"
    @update:model-value="(v) => $emit('update:modelValue', v)"
  >
    <q-card class="week-report-card" flat dark>
      <q-card-section class="week-report-header">
        <div class="week-report-title">WEEKRAPPORT</div>
        <q-btn flat round icon="close" color="grey" @click="$emit('update:modelValue', false)" />
      </q-card-section>

      <q-card-section v-if="loading" class="week-report-loading">
        <q-spinner-orbit color="#fbbf24" size="48px" />
        <p class="loading-text">Analyseren van data & cyclus...</p>
      </q-card-section>

      <q-card-section v-else-if="reportMessage || reportStats" class="week-report-body">
        <q-input
          v-if="reportStats"
          v-model="reportStats"
          type="textarea"
          outlined
          dark
          autogrow
          dense
          class="stats-input q-mb-sm"
          label="Stats"
          hide-bottom-space
        />
        <q-input
          v-model="reportMessage"
          type="textarea"
          outlined
          dark
          autogrow
          dense
          class="message-input"
          label="Rapport"
          hide-bottom-space
        />
      </q-card-section>

      <q-card-section v-else class="week-report-body">
        <p class="no-data">Geen rapport beschikbaar.</p>
      </q-card-section>

      <q-card-actions class="week-report-actions">
        <q-btn
          flat
          icon="refresh"
          label="Regenerate"
          color="amber"
          @click="regenerate"
        />
        <q-btn
          flat
          icon="content_copy"
          label="Kopieer"
          color="amber"
          @click="doCopy"
        />
        <q-space />
        <q-btn flat label="Sluiten" color="grey" @click="$emit('update:modelValue', false)" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Notify, copyToClipboard } from 'quasar'
import { fetchWeekReport } from '../../services/coachService'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  athleteId: { type: String, default: '' },
})

defineEmits(['update:modelValue'])

const loading = ref(false)
const reportMessage = ref('')
const reportStats = ref('')

async function loadReport() {
  if (!props.athleteId) return

  loading.value = true
  reportMessage.value = ''
  reportStats.value = ''

  try {
    const result = await fetchWeekReport(props.athleteId)
    reportStats.value = result.stats || ''
    reportMessage.value = result.message || ''
  } catch (err) {
    console.error('Week report failed:', err)
    Notify.create({
      type: 'negative',
      message: err?.message || 'Weekrapport ophalen mislukt.',
    })
  } finally {
    loading.value = false
  }
}

async function regenerate() {
  await loadReport()
}

/**
 * Format markdown for WhatsApp: *bold*, headers as *Kop:*, listjes met witregels.
 * De weergave in het dialoog blijft gewoon Markdown.
 */
function formatForWhatsApp(markdownText) {
  if (!markdownText || typeof markdownText !== 'string') return ''
  let s = markdownText.trim()
  // Headers (### ## #) aan begin van regel → *Kop:*
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '*$1:*')
  // Dubbele sterretjes **tekst** → enkele *tekst* (WhatsApp vet)
  s = s.replace(/\*\*([^*]+)\*\*/g, '*$1*')
  // Lijstjes: witregel vóór en na een blok met - punt
  const lines = s.split('\n')
  const out = []
  let prevWasList = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isListLine = /^\s*-\s+/.test(line)
    if (isListLine) {
      if (!prevWasList && out.length > 0) out.push('')
      out.push(line)
      prevWasList = true
    } else {
      if (prevWasList) out.push('')
      out.push(line)
      prevWasList = false
    }
  }
  return out.join('\n')
}

function doCopy() {
  const raw = [reportStats.value, reportMessage.value].filter(Boolean).join('\n\n')
  if (!raw) {
    Notify.create({ type: 'warning', message: 'Geen inhoud om te kopiëren.' })
    return
  }
  const text = formatForWhatsApp(raw)
  copyToClipboard(text)
    .then(() => {
      Notify.create({
        type: 'positive',
        message: 'Gekopieerd voor WhatsApp!',
      })
    })
    .catch(() => {
      Notify.create({
        type: 'negative',
        message: 'Kopiëren mislukt.',
      })
    })
}

watch(
  () => [props.modelValue, props.athleteId],
  ([open, id]) => {
    if (open && id) {
      if (!reportMessage.value) loadReport()
    }
    if (!open) {
      reportMessage.value = ''
      reportStats.value = ''
    }
  },
  { immediate: true }
)
</script>

<style scoped lang="scss">
@use '../../css/quasar.variables' as q;

.week-report-dialog :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.7);
}

.week-report-card {
  background: q.$prime-black !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: q.$radius-sm;
  min-width: 420px;
  max-width: 560px;
}

.week-report-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 16px 20px;
}

.week-report-title {
  font-family: q.$typography-font-family;
  font-weight: 700;
  font-size: 1rem;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.week-report-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 20px;
}

.loading-text {
  font-family: q.$typography-font-family;
  font-size: 0.875rem;
  color: q.$prime-gray;
  margin: 0;
}

.week-report-body {
  padding: 20px;
}

.stats-input :deep(.q-field__control),
.message-input :deep(.q-field__control) {
  background: rgba(255, 255, 255, 0.03) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.stats-input :deep(textarea),
.message-input :deep(textarea) {
  font-family: q.$mono-font;
  font-size: 0.85rem;
  color: #ffffff;
}

.message-input :deep(textarea) {
  font-family: q.$typography-font-family;
  min-height: 200px;
}

.no-data {
  font-size: 0.875rem;
  color: q.$prime-gray;
  margin: 0;
}

.week-report-actions {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px 20px;
}
</style>
