<template>
  <main class="page">
    <p class="kicker">explore</p>
    <h1 class="subject" style="font-size: var(--text-2xl)">Search the log</h1>
    <div class="field">
      <label for="q">Query</label>
      <input id="q" v-model="q" placeholder="rebase, cookie, alias…" @input="onType" />
    </div>
    <ol class="log-list">
      <PostRow v-for="p in posts" :key="p.id" :post="p" />
    </ol>
    <p v-if="!posts.length" class="empty">No objects match.</p>
  </main>
</template>

<script setup lang="ts">
const q = ref("");
const posts = ref<any[]>([]);
let t: ReturnType<typeof setTimeout> | null = null;

async function load() {
  const data = await api<{ posts: any[] }>(`/api/feed?q=${encodeURIComponent(q.value)}`);
  posts.value = data.posts || [];
}

function onType() {
  if (t) clearTimeout(t);
  t = setTimeout(load, 180);
}

onMounted(load);
</script>
