<template>
  <q-page class="onboarding-page">
    <div class="onboarding-container">
      <q-card class="onboarding-card" flat>
        <q-card-section>
          <div class="title">ATLEET ONBOARDING</div>
          <div class="subtitle">
            Koppel je squadron, biologische klok en telemetrie.
          </div>
        </q-card-section>

        <q-separator dark />

        <q-card-section>
          <q-stepper
            ref="stepper"
            v-model="step"
            vertical
            flat
            animated
            class="onboarding-stepper"
            active-color="amber-400"
            inactive-color="grey-7"
            done-color="amber-400"
          >
            <!-- Step 1: SQUADRON -->
            <q-step
              :name="1"
              title="SQUADRON"
              caption="Koppel aan je Constructor"
              icon="groups"
              :done="step > 1"
            >
              <div class="q-gb-md">
                <q-input
                  v-model="inviteCode"
                  label="Uitnodigingscode"
                  placeholder="TEAM-X9Z"
                  outlined
                  dark
                  class="q-mb-sm onboarding-input"
                  :error="!!inviteError"
                  :error-message="inviteError"
                  @keyup.enter="verifyCode"
                />
                <div class="hint mono-text q-mb-sm">
                  Als je via een coachlink bent gekomen, staat de code al ingevuld.
                </div>
                <div class="row items-center q-gutter-sm q-mb-sm">
                  <q-btn
                    label="Code Valideren"
                    color="primary"
                    outline
                    class="mono-btn"
                    :loading="verifyingCode"
                    @click="verifyCode"
                  />
                  <div v-if="verifiedTeamName" class="verified-label mono-text">
                    Gekoppeld aan: {{ verifiedTeamName }}
                  </div>
                </div>
                <div class="hint mono-text">
                  Je kunt deze stap overslaan als je nog geen squadron hebt.
                </div>
              </div>

              <q-stepper-navigation>
                <q-btn
                  color="primary"
                  label="Volgende"
                  class="mono-btn"
                  @click="step = 2"
                />
              </q-stepper-navigation>
            </q-step>

            <!-- Step 2: Biologische Kalibratie -->
            <q-step
              :name="2"
              title="Biologische Kalibratie"
              caption="Nodig voor fase-gebaseerde loadberekening."
              icon="favorite"
              :done="step > 2"
            >
              <div class="q-mb-lg">
                <div class="field-label">Eerste dag van laatste menstruatie</div>
                <q-date
                  v-model="lastPeriodDate"
                  color="amber-400"
                  text-color="white"
                  dark
                  minimal
                  flat
                  class="q-mb-md date-field"
                  :locale="dateLocale"
                  :options="optionsPastOnly"
                  @update:model-value="onDateSelected"
                />
                <div v-if="lastPeriodDate" class="mono-text date-value-display">
                  Gekozen: {{ formatDisplayDate(lastPeriodDate) }}
                </div>

                <div class="field-label">Cyclusduur</div>
                <div class="row items-center q-gutter-sm q-mb-xs">
                  <q-slider
                    v-model="cycleLength"
                    :min="21"
                    :max="35"
                    color="amber-400"
                    label
                    label-always
                    dark
                    class="col"
                  />
                  <div class="mono-text cycle-length-label">
                    {{ cycleLength }} dagen
                  </div>
                </div>

                <q-input
                  v-model.number="birthYear"
                  type="number"
                  label="Geboortejaar (optioneel)"
                  outlined
                  dark
                  class="q-mb-md onboarding-input"
                  placeholder="1990"
                />

                <div class="hint mono-text">
                  Nodig voor fase-gebaseerde loadberekening.
                </div>
              </div>

              <q-stepper-navigation>
                <q-btn
                  flat
                  label="Terug"
                  color="grey-5"
                  class="q-mr-sm mono-btn"
                  @click="step = 1"
                />
                <q-btn
                  color="primary"
                  :label="submittingBio ? 'Laden...' : 'Opslaan & doorgaan'"
                  class="mono-btn"
                  :disable="!hasValidDate || submittingBio"
                  :loading="submittingBio"
                  @click="onSaveBio"
                />
                <div v-if="bioSaveError" class="text-negative q-mt-sm" style="font-size: 0.8rem;">
                  {{ bioSaveError }}
                </div>
              </q-stepper-navigation>
            </q-step>

            <!-- Step 3: Strava -->
            <q-step
              :name="3"
              title="Strava Telemetrie"
              caption="Optioneel, wel aanbevolen"
              icon="timeline"
              :done="false"
            >
              <div class="q-mb-lg">
                <div class="field-label">Koppel je trainingstelemetrie</div>
                <div class="hint mono-text q-mb-md">
                  Je wordt doorgestuurd naar Strava om PrimeForm toegang te geven tot je trainingsdata.
                </div>

                <q-btn
                  label="Koppel Strava"
                  class="mono-btn strava-btn q-mb-md"
                  @click="onConnectStrava"
                />

                <div class="hint mono-text q-mb-sm">
                  Geen Strava? Je kunt deze stap overslaan en sessies handmatig invoeren.
                </div>
                <q-btn
                  flat
                  color="grey-5"
                  class="mono-btn skip-link"
                  @click="onSkipStrava"
                >
                  Nu overslaan
                </q-btn>
              </div>
            </q-step>
          </q-stepper>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useAuthStore } from '../../stores/auth'
import { API_URL } from '../../config/api.js'

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const authStore = useAuthStore()

const step = ref(1)
const stepper = ref(null)

// Step 1
const inviteCode = ref('')
const inviteError = ref('')
const verifyingCode = ref(false)
const verifiedTeamName = ref('')
const verifiedTeamId = ref(null)

// Step 2 — use string in YYYY/MM/DD for q-date; max selectable = today (dynamic, never hardcode year)
function optionsPastOnly(date) {
  const todayIso = new Date().toISOString().split('T')[0]
  const normalized = (date || '').toString().replace(/\//g, '-')
  return normalized <= todayIso
}

const lastPeriodDate = ref('')
const cycleLength = ref(28)
const birthYear = ref(null)

// Step 3
const submittingBio = ref(false)
const bioSaveError = ref('')

// Dutch locale for q-date (month/day names)
const dateLocale = {
  months: 'Januari_Februari_Maart_April_Mei_Juni_Juli_Augustus_September_Oktober_November_December'.split('_'),
  monthsShort: 'Jan_Feb_Mrt_Apr_Mei_Jun_Jul_Aug_Sep_Okt_Nov_Dec'.split('_'),
  days: 'Zondag_Maandag_Dinsdag_Woensdag_Donderdag_Vrijdag_Zaterdag'.split('_'),
  daysShort: 'Zo_Ma_Di_Wo_Do_Vr_Za'.split('_'),
  firstDayOfWeek: 1,
}

const hasValidDate = computed(() => {
  const v = (lastPeriodDate.value || '').toString().trim()
  return /^\d{4}\/\d{2}\/\d{2}$/.test(v)
})

function formatDisplayDate(isoOrQuasarDate) {
  const str = (isoOrQuasarDate || '').toString().trim()
  if (!str) return '—'
  const normalized = str.includes('/') ? str.replace(/\//g, '-') : str
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return str
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function onDateSelected(value) {
  if (value && typeof value === 'string') {
    lastPeriodDate.value = value
  }
}

onMounted(() => {
  const inviteFromQuery = (route.query.invite || '').toString().trim()
  if (inviteFromQuery) {
    inviteCode.value = inviteFromQuery
  }

  // Pre-fill from auth store so returning users see existing data (avoid re-asking Squadron / Bio)
  if (authStore.teamId) {
    verifiedTeamId.value = authStore.teamId
    verifiedTeamName.value = 'Huidig team gekoppeld'
  }
  const p = authStore.profile || {}
  if (p.lastPeriodDate || p.lastPeriod) {
    const raw = (p.lastPeriodDate || p.lastPeriod || '').toString().trim()
    lastPeriodDate.value = raw.includes('-') ? raw.replace(/-/g, '/') : raw
  }
  if (p.cycleLength != null && p.cycleLength > 0) {
    cycleLength.value = Number(p.cycleLength)
  }
})

const verifyCode = async () => {
  inviteError.value = ''
  verifiedTeamName.value = ''
  verifiedTeamId.value = null

  const raw = (inviteCode.value || '').trim()
  if (!raw) {
    inviteError.value = 'Voer een invite code in of sla deze stap over.'
    return
  }

  verifyingCode.value = true
  try {
    const team = await authStore.verifyInviteCode(raw)
    verifiedTeamId.value = team.id
    verifiedTeamName.value = team.name || 'Unnamed Team'

    $q.notify({
      type: 'positive',
      message: 'Teamcode gevalideerd.',
    })

    // Auto-advance to next step on success
    step.value = 2
  } catch (err) {
    console.error('verifyCode failed', err)
    inviteError.value = err?.message || 'Validatie van teamcode mislukt.'
  } finally {
    verifyingCode.value = false
  }
}

const onSaveBio = async () => {
  submittingBio.value = true
  bioSaveError.value = ''

  // Validatie check: print alle velden vlak voor de save
  const state = {
    lastPeriodDate: lastPeriodDate.value,
    cycleLength: cycleLength.value,
    birthYear: birthYear.value,
    verifiedTeamId: verifiedTeamId.value,
    verifiedTeamName: verifiedTeamName.value,
  }
  console.log('[Onboarding] Velden voor opslaan:', JSON.stringify(state, null, 2))

  try {
    const dateRaw = lastPeriodDate.value
    const dateStr =
      dateRaw != null && dateRaw !== ''
        ? String(dateRaw).trim().replace(/\//g, '-')
        : null

    await authStore.submitBioData({
      teamId: verifiedTeamId.value,
      date: dateStr,
      length: cycleLength.value,
    })

    $q.notify({
      type: 'positive',
      message: 'Biologische kalibratie opgeslagen.',
    })

    if (stepper.value && typeof stepper.value.next === 'function') {
      stepper.value.next()
    } else {
      step.value = 3
    }
  } catch (error) {
    console.error('onSaveBio failed', error)
    const msg =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      (error && typeof error.message === 'string' ? error.message : 'Opslaan van biologische kalibratie mislukt.')
    bioSaveError.value = msg
    $q.notify({
      type: 'negative',
      message: msg,
    })
  } finally {
    submittingBio.value = false
  }
}

const onConnectStrava = () => {
  if (!authStore.user?.uid) {
    $q.notify({
      type: 'negative',
      message: 'Geen geldige gebruiker. Log opnieuw in.',
    })
    router.push('/login')
    return
  }

  const userId = encodeURIComponent(authStore.user.uid)
  window.location.href = `${API_URL}/auth/strava/connect?userId=${userId}`
}

const onSkipStrava = async () => {
  try {
    await authStore.completeOnboarding()
    $q.notify({
      type: 'positive',
      message: 'Onboarding voltooid zonder Strava.',
    })
    router.push('/dashboard')
  } catch (err) {
    console.error('onSkipStrava failed', err)
    const msg = err && typeof err.message === 'string' ? err.message : 'Onboarding afronden mislukt.'
    $q.notify({
      type: 'negative',
      message: msg,
    })
  }
}
</script>

<style scoped lang="scss">
.onboarding-page {
  background: #050505;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.onboarding-container {
  width: 100%;
  max-width: 640px;
}

.onboarding-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: none !important;
}

.title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 900;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  font-size: 0.95rem;
  color: #fbbf24;
}

.subtitle {
  margin-top: 6px;
  font-size: 0.78rem;
  color: rgba(156, 163, 175, 0.9);
}

.onboarding-stepper {
  background: transparent;
}

.onboarding-stepper :deep(.q-step__title) {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.95);
}

.onboarding-stepper :deep(.q-step__caption) {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: rgba(156, 163, 175, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.field-label {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.7rem;
  color: rgba(209, 213, 219, 0.95);
  margin-bottom: 4px;
}

.mono-text {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.mono-btn {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.date-field {
  border-radius: 2px;
  border: 1px solid rgba(148, 163, 184, 0.5);
}

.date-value-display {
  font-size: 0.75rem;
  color: #fbbf24;
  margin-top: 4px;
  margin-bottom: 12px;
}

.cycle-length-label {
  font-size: 0.8rem;
  color: rgba(249, 250, 251, 0.9);
  min-width: 4rem;
}

.onboarding-input :deep(.q-field__control) {
  border-radius: 2px;
}

.onboarding-input :deep(input),
.onboarding-input :deep(.q-field__native) {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.hint {
  font-size: 0.72rem;
  color: rgba(148, 163, 184, 0.9);
}

.verified-label {
  font-size: 0.72rem;
  color: #22c55e;
}

.summary-block {
  border: 1px solid rgba(55, 65, 81, 0.8);
  border-radius: 2px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: rgba(15, 23, 42, 0.7);
}

.summary-title {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: rgba(229, 231, 235, 0.95);
  margin-bottom: 4px;
}

.summary-line {
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.95);
}

.summary-value {
  color: rgba(249, 250, 251, 0.96);
  margin-left: 4px;
}

.strava-btn {
  width: 100%;
  justify-content: center;
  background-color: #fc4c02 !important;
  color: #ffffff !important;
}

.skip-link {
  padding-left: 0;
}
</style>

