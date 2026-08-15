<template>
  <main class="page">
    <p class="kicker">pull requests</p>
    <h1 class="subject" style="font-size: var(--text-2xl)">Proposed merges</h1>
    <ul class="log-list">
      <li v-for="pr in prs" :key="pr.id" class="log-item">
        <div class="log-meta">
          <span class="pill">{{ pr.status }}</span>
          <NuxtLink :to="`/u/${pr.author}`">{{ pr.author }}</NuxtLink>
          <time>{{ formatAgo(pr.createdAt) }}</time>
        </div>
        <h2 class="subject">
          <NuxtLink :to="`/pulls/${pr.id}`">#{{ pr.number }} {{ pr.title }}</NuxtLink>
        </h2>
        <div class="log-stats">
          <span>{{ pr.sourcePostId.slice(0, 8) }} → {{ pr.targetPostId.slice(0, 8) }}</span>
        </div>
      </li>
    </ul>
    <p v-if="!prs.length" class="empty">No open or closed pulls yet.</p>
  </main>
</template>

<script setup lang="ts">
const prs = ref<any[]>([]);
onMounted(async () => {
  const data = await api<{ prs: any[] }>("/api/prs");
  prs.value = data.prs || [];
});
</script>
