<template>
  <div class="flash-stack" aria-live="polite">
    <article v-for="item in items" :key="item.id" class="flash" :class="item.kind" role="status">
      <span class="flash-kind">{{ item.kind === "ok" ? "ok" : item.kind === "info" ? "log" : "err" }}</span>
      <div>
        <strong>{{ item.title }}</strong>
        <p v-if="item.detail">{{ item.detail }}</p>
      </div>
      <button class="flash-close" type="button" :aria-label="'Dismiss ' + item.title" @click="dismiss(item.id)">
        ×
      </button>
    </article>
  </div>
</template>

<script setup lang="ts">
const { items, dismiss } = useFlash();
</script>
