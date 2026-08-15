<template>
  <span
    class="verified"
    :class="{ ok: verified, broken: !verified }"
    :title="verified ? 'First-parent history is intact. No force-push equivalent.' : reason || 'History could not be verified.'"
  >
    <span class="verified-mark" aria-hidden="true">{{ verified ? "●" : "○" }}</span>
    {{ verified ? "verified history" : "history rewritten" }}
  </span>
</template>

<script setup lang="ts">
defineProps<{ verified?: boolean; reason?: string }>();
</script>
