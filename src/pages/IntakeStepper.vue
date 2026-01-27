<template>
  <q-page class="intake-page">
    <div class="intake-container">
      <div class="intake-header">
        <div class="intake-title">PRIMEFORM INTAKE</div>
        <div class="intake-subtitle">Maak je coaching persoonlijk. 5 stappen.</div>
      </div>

      <q-card class="intake-card" flat>
        <q-stepper v-model="step" vertical dark animated class="intake-stepper">
          <!-- Step 1 -->
          <q-step :name="1" title="Safety & Identity" :done="step > 1">
            <div class="field-grid">
              <q-input v-model="form.fullName" outlined dark label="Naam" />
              <q-input v-model="form.email" outlined dark label="E-mail" type="email" />
              <q-input v-model="form.birthDate" outlined dark label="Geboortedatum" type="date" />
            </div>

            <q-checkbox
              v-model="form.disclaimerAccepted"
              dark
              label="Ik begrijp dat PrimeForm geen medische diagnose stelt en geen medisch advies geeft."
              class="q-mt-md"
            />

            <q-select
              v-model="form.redFlags"
              outlined
              dark
              label="Red Flags (selecteer indien van toepassing)"
              :options="redFlagOptions"
              multiple
              use-chips
              class="q-mt-md"
            />

            <q-banner v-if="hasRedFlags" class="bg-negative text-white q-mt-md">
              Stop intake, raadpleeg arts.
            </q-banner>

            <div class="row q-mt-md justify-end">
              <q-btn
                color="primary"
                class="gold-btn"
                label="Volgende"
                :disable="!canProceedStep1"
                @click="nextStep"
                unelevated
              />
            </div>
          </q-step>

          <!-- Step 2 -->
          <q-step :name="2" title="Goals & Vision" :done="step > 2">
            <q-select
              v-model="form.goals"
              outlined
              dark
              label="Hoofddoelen (max 2)"
              :options="goalOptions"
              multiple
              use-chips
              :max-values="2"
            />

            <q-input
              v-model="form.painPoint"
              outlined
              dark
              label="Waar wil je het meest van af?"
              class="q-mt-md"
            />

            <q-input
              v-model="form.successScenario"
              outlined
              dark
              type="textarea"
              autogrow
              label="Wat is er over 12 weken concreet anders?"
              class="q-mt-md"
            />

            <q-input
              v-model="form.injuries"
              outlined
              dark
              label="Klachten of blessures (kort)"
              class="q-mt-md"
            />

            <div class="row q-mt-md justify-between">
              <q-btn flat color="white" label="Terug" @click="prevStep" />
              <q-btn color="primary" class="gold-btn" label="Volgende" :disable="!canProceedStep2" @click="nextStep" unelevated />
            </div>
          </q-step>

          <!-- Step 3 -->
          <q-step :name="3" title="Training & Programming" :done="step > 3">
            <div class="q-mb-md">
              <div class="row justify-between items-center">
                <div class="text-white">Frequentie</div>
                <div class="text-gold">{{ form.trainingFrequency }} dagen/week</div>
              </div>
              <q-slider v-model="form.trainingFrequency" :min="1" :max="7" color="#fbbf24" />
            </div>

            <q-select
              v-model="form.sessionDuration"
              outlined
              dark
              label="Duur per sessie"
              :options="durationOptions"
            />

            <q-select
              v-model="form.programmingType"
              outlined
              dark
              label="Type Programma"
              :options="programmingOptions"
              class="q-mt-md"
            />

            <q-input v-model="form.stravaLink" outlined dark label="Strava-link (optioneel)" class="q-mt-md" />

            <q-select
              v-model="form.wearables"
              outlined
              dark
              label="Wearables"
              :options="wearableOptions"
              multiple
              use-chips
              class="q-mt-md"
            />

            <div class="row q-mt-md justify-between">
              <q-btn flat color="white" label="Terug" @click="prevStep" />
              <q-btn color="primary" class="gold-btn" label="Volgende" :disable="!canProceedStep3" @click="nextStep" unelevated />
            </div>
          </q-step>

          <!-- Step 4 -->
          <q-step :name="4" title="Lifestyle & Recovery" :done="step > 4">
            <q-input v-model.number="form.sleepAvg" outlined dark label="Slaap (gemiddelde uren)" type="number" />

            <div class="q-mt-md">
              <div class="row justify-between items-center">
                <div class="text-white">Stress</div>
                <div class="text-gold">{{ form.stress }}/10</div>
              </div>
              <q-slider v-model="form.stress" :min="1" :max="10" color="#fbbf24" />
            </div>

            <q-select
              v-model="form.recoveryHabits"
              outlined
              dark
              label="Herstelgewoontes"
              :options="recoveryHabitOptions"
              multiple
              use-chips
              class="q-mt-md"
            />

            <div class="row q-mt-md justify-between">
              <q-btn flat color="white" label="Terug" @click="prevStep" />
              <q-btn color="primary" class="gold-btn" label="Volgende" :disable="!canProceedStep4" @click="nextStep" unelevated />
            </div>
          </q-step>

          <!-- Step 5 -->
          <q-step :name="5" title="Fysiologie (The Prime Data)">
            <q-select
              v-model="form.contraception"
              outlined
              dark
              label="Anticonceptie"
              :options="contraceptionOptions"
            />

            <q-input v-model="form.lastPeriod" outlined dark label="Eerste dag laatste bloeding" type="date" class="q-mt-md" />

            <q-input
              v-model.number="form.cycleAvgDuration"
              outlined
              dark
              label="Gemiddelde cyclusduur (dagen)"
              type="number"
              class="q-mt-md"
            />

            <q-select
              v-model="form.symptoms"
              outlined
              dark
              label="Symptomen (max 3)"
              :options="symptomOptions"
              multiple
              use-chips
              :max-values="3"
              class="q-mt-md"
            />

            <q-input
              v-model="form.checkinTime"
              outlined
              dark
              label="Check-in tijd (notificatie)"
              type="time"
              class="q-mt-md"
            />

            <q-banner v-if="saveError" class="bg-negative text-white q-mt-md">
              {{ saveError }}
            </q-banner>

            <div class="row q-mt-md justify-between">
              <q-btn flat color="white" label="Terug" @click="prevStep" />
              <q-btn
                color="primary"
                class="gold-btn"
                label="Voltooien & Opslaan"
                :loading="saving"
                :disable="!canProceedStep5"
                @click="saveProfile"
                unelevated
              />
            </div>
          </q-step>
        </q-stepper>
      </q-card>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { API_URL } from '../config/api.js'

const router = useRouter()

const getOrCreateUserId = () => {
  const key = 'primeform_user_id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const newId = `pf_${Date.now()}`
  localStorage.setItem(key, newId)
  return newId
}

const userId = ref('')
const step = ref(1)
const saving = ref(false)
const saveError = ref('')

const form = ref({
  // Step 1
  fullName: '',
  email: '',
  birthDate: '',
  disclaimerAccepted: false,
  redFlags: [],

  // Step 2
  goals: [],
  painPoint: '',
  successScenario: '',
  injuries: '',

  // Step 3
  trainingFrequency: 4,
  sessionDuration: '60 min',
  programmingType: 'Box/Gym Programming',
  stravaLink: '',
  wearables: [],

  // Step 4
  sleepAvg: 7,
  stress: 5,
  recoveryHabits: [],

  // Step 5
  contraception: 'Geen',
  lastPeriod: '',
  cycleAvgDuration: 28,
  symptoms: [],
  checkinTime: '08:00'
})

onMounted(async () => {
  userId.value = getOrCreateUserId()

  // Preload existing profile if present
  try {
    const resp = await axios.get(`${API_URL}/api/profile`, {
      params: { userId: userId.value }
    })
    const profile = resp.data?.data?.profile
    if (profile) {
      form.value = {
        ...form.value,
        ...profile,
        // keep defaults for missing keys
        cycleAvgDuration: profile?.cycleData?.avgDuration ?? form.value.cycleAvgDuration,
        lastPeriod: profile?.cycleData?.lastPeriod ?? form.value.lastPeriod,
        contraception: profile?.cycleData?.contraception ?? form.value.contraception
      }
    }
  } catch (e) {
    // non-fatal
    console.error('Profile preload failed:', e)
  }
})

const redFlagOptions = [
  'Onverklaarbaar gewichtsverlies',
  'Nachtelijke pijn',
  'Onverklaarbare bloedingen',
  'Flauwvallen / duizeligheid',
  'Onverklaarbare benauwdheid',
  'Aanhoudende pijn op de borst'
]

const goalOptions = ['Kracht', 'Conditie', 'Afvallen', 'Skills', 'Gezondheid']
const durationOptions = ['30 min', '60 min', '90+ min']
const programmingOptions = ['Box/Gym Programming', 'Eigen schema', 'PrimeForm Only']
const wearableOptions = ['Oura', 'Whoop', 'Garmin', 'Apple Watch', 'Polar', 'Fitbit', 'Geen']
const recoveryHabitOptions = ['Koud douchen', 'Wandelen', 'Meditatie', 'Sauna', 'Mobiliteit', 'Ademwerk']
const contraceptionOptions = ['Hormonaal', 'Spiraal', 'Geen', 'Anders']
const symptomOptions = ['Krampen', 'Vermoeidheid', 'Brain fog', 'Hoofdpijn', 'Opgeblazen gevoel', 'Prikkelbaarheid']

const hasRedFlags = computed(() => Array.isArray(form.value.redFlags) && form.value.redFlags.length > 0)

const canProceedStep1 = computed(() => {
  // TEMP DEBUG LOGGING – helpt zien wat er nog niet "ok" is
  const nameOk = form.value.fullName.trim().length >= 2
  const emailOk = form.value.email.includes('@')
  // Sta zowel YYYY-MM-DD als YYYY/MM/DD toe, zodat locale date pickers geen probleem geven
  const birthOk = /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(form.value.birthDate)
  const disclaimerOk = form.value.disclaimerAccepted === true
  const redFlagsOk = !hasRedFlags.value

  console.log('[Intake Step 1 validity]', {
    fullName: form.value.fullName,
    email: form.value.email,
    birthDate: form.value.birthDate,
    disclaimerAccepted: form.value.disclaimerAccepted,
    redFlags: form.value.redFlags,
    nameOk,
    emailOk,
    birthOk,
    disclaimerOk,
    redFlagsOk,
    canProceed: nameOk && emailOk && birthOk && disclaimerOk && redFlagsOk
  })

  if (!redFlagsOk) return false
  return nameOk && emailOk && birthOk && disclaimerOk
})

const canProceedStep2 = computed(() => {
  return Array.isArray(form.value.goals) && form.value.goals.length > 0 && form.value.goals.length <= 2
})

const canProceedStep3 = computed(() => {
  return !!form.value.programmingType && !!form.value.sessionDuration && form.value.trainingFrequency >= 1
})

const canProceedStep4 = computed(() => {
  return Number(form.value.sleepAvg) > 0 && Number(form.value.stress) >= 1
})

const canProceedStep5 = computed(() => {
  const lastPeriodOk = /^\d{4}-\d{2}-\d{2}$/.test(form.value.lastPeriod)
  const avgOk = Number(form.value.cycleAvgDuration) >= 21
  return !!form.value.contraception && lastPeriodOk && avgOk
})

const nextStep = () => {
  step.value = Math.min(5, step.value + 1)
}
const prevStep = () => {
  step.value = Math.max(1, step.value - 1)
}

const saveProfile = async () => {
  saving.value = true
  saveError.value = ''
  try {
    const profilePatch = {
      fullName: form.value.fullName,
      email: form.value.email,
      birthDate: form.value.birthDate,
      disclaimerAccepted: form.value.disclaimerAccepted,
      redFlags: form.value.redFlags,

      goals: form.value.goals,
      painPoint: form.value.painPoint,
      successScenario: form.value.successScenario,
      injuries: form.value.injuries,

      trainingFrequency: form.value.trainingFrequency,
      sessionDuration: form.value.sessionDuration,
      programmingType: form.value.programmingType,
      stravaLink: form.value.stravaLink,
      wearables: form.value.wearables,

      sleepAvg: form.value.sleepAvg,
      stress: form.value.stress,
      recoveryHabits: form.value.recoveryHabits,

      symptoms: form.value.symptoms,
      checkinTime: form.value.checkinTime,

      cycleData: {
        lastPeriod: form.value.lastPeriod,
        avgDuration: Number(form.value.cycleAvgDuration),
        contraception: form.value.contraception
      }
    }

    await axios.put(`${API_URL}/api/profile`, {
      userId: userId.value,
      profilePatch
    })

    // After intake completion, go to dashboard
    router.push('/')
  } catch (e) {
    console.error('Profile save failed:', e)
    saveError.value = e.response?.data?.error || 'Opslaan mislukt. Probeer opnieuw.'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@1,900&family=Inter:wght@300;400;600&display=swap');

.intake-page {
  background: #000000;
  min-height: 100vh;
  padding: 24px 16px;
}

.intake-container {
  max-width: 680px;
  margin: 0 auto;
}

.intake-header {
  text-align: center;
  margin-bottom: 16px;
}

.intake-title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  letter-spacing: 1px;
  color: #fbbf24;
  font-size: 1.6rem;
}

.intake-subtitle {
  font-family: 'Inter', sans-serif;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 6px;
}

.intake-card {
  background: rgba(18, 18, 18, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  overflow: hidden;
}

.intake-stepper :deep(.q-stepper__tab) {
  color: rgba(255, 255, 255, 0.85);
}

.intake-stepper :deep(.q-stepper__tab--active) {
  color: #fbbf24;
}

.intake-stepper :deep(.q-stepper__tab--done) {
  color: rgba(251, 191, 36, 0.85);
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.text-gold {
  color: #fbbf24;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
}

.gold-btn {
  background: #fbbf24 !important;
  color: #000000 !important;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  letter-spacing: 0.5px;
}

@media (min-width: 720px) {
  .field-grid {
    grid-template-columns: 1fr 1fr;
  }
  .field-grid :deep(.q-field):nth-child(3) {
    grid-column: span 2;
  }
}
</style>

