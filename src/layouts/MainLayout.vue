<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="premium-header">
      <q-toolbar>
        <router-link to="/dashboard" class="premium-title-link">
          <q-toolbar-title class="premium-title">
            PRIMEFORM
          </q-toolbar-title>
        </router-link>
        <q-space />
        <router-link to="/coach" class="header-link">Coach</router-link>
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
        active-color="#fbbf24"
        indicator-color="#fbbf24"
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

<style scoped lang="scss">
@use '../css/quasar.variables' as q;

.premium-header {
  background: q.$prime-black !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.premium-title-link {
  text-decoration: none;
}

.premium-title {
  text-align: center;
  font-family: q.$head-font;
  font-weight: 900;
  font-style: italic;
  color: q.$prime-gold;
  letter-spacing: 3px;
  font-size: 1.5rem;
}

.premium-footer {
  background: q.$prime-black !important;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.footer-tabs {
  background: transparent;
  color: q.$prime-gray;
}

.footer-tabs :deep(.q-tab) {
  color: rgba(255, 255, 255, 0.6);
}

.footer-tabs :deep(.q-tab--active) {
  color: q.$prime-gold;
}

.header-link {
  font-family: q.$typography-font-family;
  font-size: 0.75rem;
  font-weight: 600;
  color: q.$prime-gray;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  text-decoration: none;
}

.header-link:hover {
  color: q.$prime-gold;
}
</style>
