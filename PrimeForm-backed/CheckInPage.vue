<template>
  <q-page class="bg-grey-1 q-pa-md">
    <div class="text-h4 text-weight-bold text-primary q-mb-md">PrimeForm</div>
    
    <q-card class="q-pa-md shadow-2 my-card">
      <div class="text-subtitle1 q-mb-sm">Hoe voel je je vandaag?</div>
      
      <div class="q-mb-lg">
        <div class="row justify-between"><span>Readiness</span> <span>{{ readiness }}/10</span></div>
        <q-slider v-model="readiness" :min="1" :max="10" color="primary" />
      </div>

      <div class="q-mb-lg">
        <div class="row justify-between"><span>Slaap (uren)</span> <span>{{ sleep }}u</span></div>
        <q-slider v-model="sleep" :min="3" :max="12" :step="0.5" color="secondary" />
      </div>

      <q-btn 
        label="Check-in & Bereken Plan" 
        color="primary" 
        class="full-width q-py-sm" 
        rounded 
        @click="getAdvice"
        :loading="loading"
      />
    </q-card>

    <q-slide-transition>
      <div v-if="adviceData" class="q-mt-lg">
        <q-card :class="getStatusClass" class="text-white shadow-5">
          <q-card-section>
            <div class="text-h6">Status: {{ adviceData.status }}</div>
            <div class="q-mt-sm italic">"{{ adviceData.aiMessage }}"</div>
            <div v-if="adviceData.cycleInfo" class="q-mt-sm text-caption">
              Cyclusfase: {{ adviceData.cycleInfo.phase }} (dag {{ adviceData.cycleInfo.currentCycleDay }})
            </div>
            <div v-if="adviceData.metrics.redFlags > 0" class="q-mt-sm">
              <q-chip color="red" text-color="white" size="sm">
                {{ adviceData.metrics.redFlags }} Red Flag{{ adviceData.metrics.redFlags > 1 ? 's' : '' }}
              </q-chip>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </q-slide-transition>

    <q-banner v-if="error" class="bg-negative text-white q-mt-md">
      {{ error }}
    </q-banner>
  </q-page>
</template>

<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'

const readiness = ref(7)
const sleep = ref(8)
const loading = ref(false)
const adviceData = ref(null)
const error = ref(null)

const getAdvice = async () => {
  loading.value = true
  error.value = null
  try {
    const response = await axios.post('http://localhost:3000/api/daily-advice', {
      readiness: readiness.value,
      sleep: sleep.value,
      lastPeriodDate: '2026-01-10', // Hardcoded voor nu
      hrv: 50, 
      hrvBaseline: 55,      // Hardcoded voor nu
      rhr: 60, 
      rhrBaseline: 60,      // Hardcoded voor nu
    })
    adviceData.value = response.data.data
  } catch (err) {
    console.error('Error fetching advice:', err)
    error.value = err.response?.data?.error || 'Er is een fout opgetreden bij het ophalen van advies.'
  } finally {
    loading.value = false
  }
}

const getStatusClass = computed(() => {
  if (!adviceData.value) return ''
  const status = adviceData.value.status
  if (status === 'REST') return 'bg-red-7'
  if (status === 'RECOVER') return 'bg-orange-7'
  if (status === 'PUSH') return 'bg-green-7'
  return 'bg-blue-7'
})
</script>

<style scoped>
.my-card { border-radius: 15px; }
.italic { font-style: italic; }
</style>
