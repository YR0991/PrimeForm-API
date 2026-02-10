<template>
  <div class="widget rhr-tile">
    <div class="widget-title">RHR</div>
    <div class="rhr-content mono">
      <div class="rhr-value">{{ rhrDisplay }}</div>
      <div v-if="baselineDelta !== null" class="rhr-badge" :class="badgeClass">
        {{ baselineDelta > 0 ? '+' : '' }}{{ baselineDelta }}
      </div>
    </div>
    <div class="rhr-label">vs 28d baseline</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  rhrCurrent: { type: Number, default: null },
  rhrBaseline28d: { type: Number, default: null },
})

const rhrDisplay = computed(() => {
  const v = props.rhrCurrent
  return v != null && Number.isFinite(v) ? Math.round(v) : '—'
})

const baselineDelta = computed(() => {
  const cur = props.rhrCurrent
  const base = props.rhrBaseline28d
  if (cur == null || !Number.isFinite(cur) || base == null || !Number.isFinite(base)) return null
  return Math.round(cur - base)
})

const badgeClass = computed(() => {
  const d = baselineDelta.value
  if (d == null) return ''
  if (d > 0) return 'rhr-badge-up'
  if (d < 0) return 'rhr-badge-down'
  return 'rhr-badge-neutral'
})
</script>

<style scoped lang="scss">
.rhr-tile {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  padding: 16px 14px;
}

.widget-title {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.8rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(156, 163, 175, 0.9);
  margin-bottom: 10px;
}

.rhr-content {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.rhr-value {
  font-size: 2rem;
  font-weight: 600;
  color: #fbbf24;
}

.rhr-badge {
  font-size: 0.85rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid;
}

.rhr-badge-up {
  color: #ef4444;
  border-color: #ef4444;
}

.rhr-badge-down {
  color: #22c55e;
  border-color: #22c55e;
}

.rhr-badge-neutral {
  color: rgba(156, 163, 175, 0.9);
  border-color: rgba(255, 255, 255, 0.08);
}

.rhr-label {
  margin-top: 6px;
  font-size: 0.7rem;
  color: rgba(156, 163, 175, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
</style>
