<template>
  <q-page class="loading-page flex flex-center">
    <div class="loading-text">Account laden...</div>
  </q-page>
</template>

<script setup>
</script>

<style scoped lang="scss">
.loading-page {
  background: #050505;
  min-height: 100vh;
}
.loading-text {
  font-family: 'Inter', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: #9ca3af;
  font-size: 0.875rem;
}
</style>
