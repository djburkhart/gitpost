<template>
  <section v-if="takes.length" class="take-carousel" aria-label="Other branches of this idea">
    <div class="feed-head">
      <h2>other branches of this idea</h2>
      <span class="subtle mono">{{ takes.length }} take{{ takes.length === 1 ? "" : "s" }}</span>
    </div>
    <div class="take-strip" role="list">
      <NuxtLink v-for="t in takes" :key="t.id" :to="`/p/${t.id}`" class="take-card" role="listitem">
        <span class="pill">{{ intentLabel(t.forkIntent) || (t.id === parentId ? "origin" : "take") }}</span>
        <strong>{{ t.subject }}</strong>
        <div class="log-meta">
          <span>{{ t.owner }}</span>
          <span class="sha">{{ t.shortSha }}</span>
          <span>{{ t.starCount }} ★</span>
        </div>
      </NuxtLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import { intentLabel } from "~/utils/intents";

defineProps<{ takes: any[]; parentId?: string }>();
</script>
