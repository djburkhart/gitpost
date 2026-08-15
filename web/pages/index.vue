<template>
  <main class="page">
    <section class="hero">
      <p class="kicker">git log of the developer community</p>
      <h1>Post like you commit.</h1>
      <p>
        Every post is a real Git object — subject, body, SHA, history, forks, and pull requests.
        Writing with the same tools you already trust for code.
      </p>
    </section>
    <div class="grid-2">
      <section>
        <ol class="log-list">
          <PostRow v-for="p in posts" :key="p.id" :post="p" />
        </ol>
        <p v-if="!loading && !posts.length" class="empty">The log is empty. Be the first commit.</p>
        <p v-if="loading" class="empty">Reading the object store…</p>
      </section>
      <aside class="card">
        <p class="kicker">How it maps</p>
        <ul class="muted" style="margin: 0; padding-left: 1.1em; font-size: 0.95rem">
          <li>Star a post you may return to</li>
          <li>Watch to follow new commits</li>
          <li>Fork to take your own tip</li>
          <li>Open a PR to improve someone else’s paragraph</li>
          <li>Cherry-pick a single idea into your tree</li>
        </ul>
        <p class="subtle" style="margin: 16px 0 0; font-size: 0.8rem; font-family: var(--font-mono)">
          Demo accounts: ada / linus / maya / guest — password <em>demo</em>
        </p>
      </aside>
    </div>
  </main>
</template>

<script setup lang="ts">
const posts = ref<any[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const data = await api<{ posts: any[] }>("/api/feed");
    posts.value = data.posts || [];
  } finally {
    loading.value = false;
  }
});
</script>
