<template>
  <q-page class="onboarding-page">
    <div class="onboarding-container">
      <q-card class="onboarding-card" flat>
        <q-card-section>
          <div class="title">ATHLETE ONBOARDING</div>
          <div class="subtitle">
            Sync your squadron, biological clock, and telemetry.
          </div>
        </q-card-section>

        <q-separator dark />

        <q-card-section>
          <q-stepper
            v-model="step"
            vertical
            flat
            animated
            class="onboarding-stepper"
            active-color="amber-400"
            inactive-color="grey-7"
            done-color="amber-400"
          >
            <!-- Step 1: Squadron -->
            <q-step
              :name="1"
              title="The Squadron"
              caption="Connect to your Constructor"
              icon="groups"
              :done="step > 1"
            >
              <div class="q-gb-md">
                <q-input
                  v-model="inviteCode"
                  label="Invite Code"
                  placeholder="TEAM-X9Z"
                  outlined
                  dark
                  class="q-mb-sm"
                  :error="!!inviteError"
                  :error-message="inviteError"
                  @keyup.enter="verifyCode"
                />
                <div class="hint mono-text q-mb-sm">
                  If you joined via a coach link, the code is pre-filled.
                </div>
                <div class="row items-center q-gutter-sm q-mb-sm">
                  <q-btn
                    label="VERIFY CODE"
                    color="primary"
                    outline
                    class="mono-btn"
                    :loading="verifyingCode"
                    @click="verifyCode"
                  />
                  <div v-if="verifiedTeamName" class="verified-label mono-text">
                    Linked to: {{ verifiedTeamName }}
                  </div>
                </div>
                <div class="hint mono-text">
                  You can skip this step if you don't have a squadron yet.
                </div>
              </div>

              <q-stepper-navigation>
                <q-btn
                  color="primary"
                  label="Next"
                  class="mono-btn"
                  @click="step = 2"
                />
              </q-stepper-navigation>
            </q-step>

            <!-- Step 2: Bio-Calibration -->
            <q-step
              :name="2"
              title="Bio-Calibration"
              caption="Critical for Phase-Based Load Calculation."
              icon="favorite"
              :done="step > 2"
            >
              <div class="q-mb-lg">
                <div class="field-label">Last Period Start</div>
                <q-date
                  v-model="lastPeriodDate"
                  color="amber-400"
                  text-color="white"
                  dark
                  minimal
                  flat
                  class="q-mb-md date-field"
                />

                <div class="field-label">Average Cycle Length</div>
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
                    {{ cycleLength }} days
                  </div>
                </div>

                <q-input
                  v-model.number="birthYear"
                  type="number"
                  label="Year of birth (optional)"
                  outlined
                  dark
                  class="q-mb-md"
                />

                <div class="hint mono-text">
                  Critical for Phase-Based Load Calculation.
                </div>
              </div>

              <q-stepper-navigation>
                <q-btn
                  flat
                  label="Back"
                  color="grey-5"
                  class="q-mr-sm mono-btn"
                  @click="step = 1"
                />
                <q-btn
                  color="primary"
                  label="SAVE & CONTINUE"
                  class="mono-btn"
                  :loading="submittingBio"
                  @click="onSaveBio"
                />
              </q-stepper-navigation>
            </q-step>

            <!-- Step 3: Strava Telemetry -->
            <q-step
              :name="3"
              title="Strava Telemetry"
              caption="Optional, but recommended"
              icon="timeline"
              :done="false"
            >
              <div class="q-mb-lg">
                <div class="field-label">Connect your training telemetry</div>
                <div class="hint mono-text q-mb-md">
                  Redirects you to Strava to authorize PrimeForm with your training data.
                </div>

                <q-btn
                  label="CONNECT STRAVA"
                  class="mono-btn strava-btn q-mb-md"
                  @click="onConnectStrava"
                />

                <div class="hint mono-text q-mb-sm">
                  Don't use Strava? You can skip this step and log sessions manually.
                </div>
                <q-btn
                  flat
                  color="grey-5"
                  class="mono-btn skip-link"
                  @click="onSkipStrava"
                >
                  Skip Strava for now
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
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Notify } from 'quasar'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const step = ref(1)

// Step 1
const inviteCode = ref('')
const inviteError = ref('')
const verifyingCode = ref(false)
const verifiedTeamName = ref('')
const verifiedTeamId = ref(null)

// Step 2
const lastPeriodDate = ref('')
const cycleLength = ref(28)
const birthYear = ref(null)

// Step 3
const submittingBio = ref(false)

onMounted(() => {
  // Autofill team invite from URL (?invite=...)
  const inviteFromQuery = (route.query.invite || '').toString().trim()
  if (inviteFromQuery) {
    inviteCode.value = inviteFromQuery
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

    Notify.create({
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
  try {
    await authStore.submitBioData({
      teamId: verifiedTeamId.value,
      date: lastPeriodDate.value || null,
      length: cycleLength.value,
    })

    Notify.create({
      type: 'positive',
      message: 'Bio-calibration saved.',
    })

    step.value = 3
  } catch (err) {
    console.error('onSaveBio failed', err)
    Notify.create({
      type: 'negative',
      message: err?.message || 'Opslaan van bio-calibration mislukt.',
    })
  } finally {
    submittingBio.value = false
  }
}

const onConnectStrava = () => {
  if (!authStore.user?.uid) {
    Notify.create({
      type: 'negative',
      message: 'Geen geldige gebruiker. Log opnieuw in.',
    })
    router.push('/login')
    return
  }

  const userId = encodeURIComponent(authStore.user.uid)
  window.location.href = `https://primeform-backend.onrender.com/auth/strava?userId=${userId}`
}

const onSkipStrava = async () => {
  try {
    await authStore.completeOnboarding()
    Notify.create({
      type: 'positive',
      message: 'Onboarding voltooid zonder Strava.',
    })
    router.push('/dashboard')
  } catch (err) {
    console.error('onSkipStrava failed', err)
    Notify.create({
      type: 'negative',
      message: err?.message || 'Onboarding afronden mislukt.',
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

.cycle-length-label {
  font-size: 0.8rem;
  color: rgba(249, 250, 251, 0.9);
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

