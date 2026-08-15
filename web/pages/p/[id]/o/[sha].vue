<template>
  <main class="page article" v-if="post">
    <p class="kicker">
      immutable object
      ·
      <span class="sha">{{ post.shortSha }}</span>
      ·
      <VerifiedBadge :verified="!!post.verified" :reason="proof?.reason" />
    </p>
    <div v-if="post.historical" class="hist-banner">
      Viewing a sealed revision. The live tip is
      <NuxtLink :to="`/p/${post.id}`">{{ post.id.slice(0, 8) }}</NuxtLink>
      at a newer SHA.
    </div>
    <header class="post-head">
      <h1 class="subject">{{ post.subject }}</h1>
      <p class="log-meta">
        <NuxtLink :to="`/u/${post.owner}`">{{ post.owner }}</NuxtLink>
        <span>object {{ post.at?.slice(0, 12) }}</span>
        <button class="btn btn-ghost btn-sm" type="button" @click="copy">Copy permalink</button>
      </p>
    </header>
    <MarkdownBody :source="post.body" />
    <div class="actions">
      <NuxtLink :to="`/p/${post.id}`" class="btn btn-sm">Live tip</NuxtLink>
      <NuxtLink :to="`/p/${post.id}#history`" class="btn btn-sm">History</NuxtLink>
    </div>
  </main>
  <main v-else class="page">
    <p class="empty">{{ loading ? "Resolving object…" : "Object not found." }}</p>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const post = ref<any>(null);
const proof = ref<any>(null);
const loading = ref(true);
const flash = useFlash();

onMounted(async () => {
  loading.value = true;
  try {
    const data = await api<{ post: any; history: any }>(`/api/posts/${route.params.id}?at=${route.params.sha}`);
    post.value = data.post;
    proof.value = data.history;
  } catch {
    try {
      const data = await api<{ post: any; history: any }>(`/api/objects/${route.params.sha}`);
      post.value = data.post;
      proof.value = data.history;
    } catch {
      post.value = null;
    }
  } finally {
    loading.value = false;
  }
});

async function copy() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    flash.ok("Permalink copied");
  } catch {
    flash.info("Permalink", window.location.href);
  }
}
</script>
