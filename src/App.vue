<template>
  <div class="app-root">
    <div v-if="!isAuthReady" class="app-boot-screen">
      <div class="boot-logo">PRIMEFORM // TELEMETRY</div>
      <div class="boot-subtitle">Engine warm-up… authenticatie initialiseren</div>
      <q-spinner color="#fbbf24" size="42px" class="boot-spinner" />
    </div>
    <router-view v-else />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useAuthStore } from './stores/auth'

const authStore = useAuthStore()
const isAuthReady = computed(() => authStore.isAuthReady)

onMounted(() => {
  authStore.init()
})
</script>

<style scoped>
.app-root {
  min-height: 100vh;
  background: #050505;
}

.app-boot-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #050505;
  color: #f9fafb;
  padding: 24px;
  text-align: center;
}

.boot-logo {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  font-weight: 900;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  font-size: 0.9rem;
  color: #fbbf24;
  margin-bottom: 8px;
}

.boot-subtitle {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.75rem;
  color: rgba(156, 163, 175, 0.9);
  margin-bottom: 18px;
}

.boot-spinner {
  margin-top: 4px;
}
</style>
