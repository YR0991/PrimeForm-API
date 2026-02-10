<template>
  <div class="widget hrv-chart-tile">
    <div class="widget-title">HRV TREND</div>
    <div class="hrv-chart-wrap">
      <Line v-if="chartData.labels.length" :data="chartData" :options="chartOptions" />
      <div v-else class="hrv-chart-empty mono">No HRV history yet.</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { Line } from 'vue-chartjs'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Title, Tooltip, Legend, Filler)

const props = defineProps({
  historyLogs: { type: Array, default: () => [] },
})

const last14 = computed(() => {
  const list = (props.historyLogs || []).slice(-14)
  return list
})

const chartData = computed(() => {
  const list = last14.value
  if (!list.length) return { labels: [], datasets: [] }
  const labels = list.map((h) => {
    const d = h.date
    if (!d) return ''
    return d.slice(5)
  })
  const currentHrv = list.map((h) => (h.hrv != null && Number.isFinite(h.hrv) ? h.hrv : null))
  const ghostHrv = list.map((h) => (h.previousCycleHrv != null && Number.isFinite(h.previousCycleHrv) ? h.previousCycleHrv : null))
  return {
    labels,
    datasets: [
      {
        label: 'HRV',
        data: currentHrv,
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251, 191, 36, 0.1)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#fbbf24',
        spanGaps: true
      },
      {
        label: 'Previous cycle',
        data: ghostHrv,
        borderColor: 'rgba(156, 163, 175, 0.8)',
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        pointBackgroundColor: 'rgba(156, 163, 175, 0.8)',
        spanGaps: true
      }
    ]
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top',
      labels: {
        color: 'rgba(255,255,255,0.8)',
        font: { size: 10 },
        usePointStyle: true
      }
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: 'rgba(255,255,255,0.7)', maxTicksLimit: 8 }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: 'rgba(255,255,255,0.7)' }
    }
  }
}))
</script>

<style scoped lang="scss">
.hrv-chart-tile {
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

.hrv-chart-wrap {
  height: 220px;
  position: relative;
}

.hrv-chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(156, 163, 175, 0.8);
  font-size: 0.85rem;
}
</style>
