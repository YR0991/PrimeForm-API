<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="premium-header">
      <q-toolbar>
        <q-toolbar-title class="premium-title">
          PRIMEFORM
        </q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <q-footer v-if="showFooter" class="premium-footer" elevated>
      <q-tabs
        v-model="activeTab"
        dense
        align="justify"
        active-color="#D4AF37"
        indicator-color="#D4AF37"
        class="footer-tabs"
        no-caps
      >
        <q-route-tab to="/dashboard" name="dashboard" icon="today" label="Vandaag" />
        <q-route-tab to="/insights" name="insights" icon="bar_chart" label="Inzichten" />
        <q-route-tab to="/settings" name="settings" icon="person" label="Profiel" />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const showFooter = computed(() => {
  const p = route.path
  return p !== '/intake' && !p.startsWith('/admin')
})

const activeTab = computed({
  get() {
    if (route.path.startsWith('/insights')) return 'insights'
    if (route.path.startsWith('/settings')) return 'settings'
    return 'dashboard'
  },
  set() {}
})
</script>

<style scoped>
.premium-header {
  background: #000000;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.premium-title {
  text-align: center;
  font-family: 'Montserrat', sans-serif;
  font-weight: 900;
  font-style: italic;
  color: #D4AF37;
  letter-spacing: 3px;
  font-size: 1.5rem;
}

.premium-footer {
  background: #000000;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.footer-tabs {
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
}

.footer-tabs :deep(.q-tab) {
  color: rgba(255, 255, 255, 0.6);
}

.footer-tabs :deep(.q-tab--active) {
  color: #D4AF37;
}
</style>
