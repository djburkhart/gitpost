<template>
  <main class="page">
    <section class="hero">
      <div class="hero-stage">
        <div>
          <p class="hero-ref">refs/heads/main · HEAD</p>
          <h1>The <em>commit log</em> for writing.</h1>
          <p class="lede">
            Every post is a real Git object — subject, body, SHA, history, forks, and pull requests.
            Ideas with the same tools you already trust for code.
          </p>
          <div class="hero-cta">
            <NuxtLink v-if="user" to="/compose" class="btn btn-primary">Start a commit</NuxtLink>
            <template v-else>
              <NuxtLink to="/join" class="btn btn-primary">Get an invite</NuxtLink>
              <NuxtLink to="/login" class="btn">Sign in</NuxtLink>
            </template>
            <NuxtLink to="/explore" class="btn btn-ghost">Browse the log</NuxtLink>
          </div>
        </div>
        <aside class="hero-term" aria-hidden="true">
          <div class="hero-term-inner">
            <div class="hero-term-bar">
              <span class="hero-term-dots"><i /><i /><i /></span>
              <span>git log --oneline origin/ideas</span>
            </div>
            <pre>
<span class="hash">*</span> <span class="hash">a4f2c1e</span> <span class="head">(HEAD → main)</span> Post like you commit
<span class="hash">*</span> <span class="hash">9b31d08</span> Fork an argument, keep the history
<span class="hash">|</span>
<span class="hash">*</span> <span class="hash">e17c904</span> Open a PR on someone else’s paragraph
<span class="hash">*</span> <span class="hash">c08ab52</span> Cherry-pick the sentence that landed
<span class="hash">*</span> <span class="hash">71d4ee3</span> Watch the branch you care about
<span class="hash">*</span> <span class="hash">2f90aa1</span> init: gitpo.st<span class="cursor" /></pre>
          </div>
        </aside>
      </div>
    </section>

    <section class="primitives" aria-label="Git primitives">
      <article class="primitive">
        <span class="sha">star</span>
        <p>Bookmark a commit you will return to.</p>
      </article>
      <article class="primitive">
        <span class="sha">watch</span>
        <p>Follow new commits on a thread.</p>
      </article>
      <article class="primitive">
        <span class="sha">fork</span>
        <p>Take the tip and write your own.</p>
      </article>
      <article class="primitive">
        <span class="sha">pull</span>
        <p>Propose a better paragraph.</p>
      </article>
      <article class="primitive">
        <span class="sha">cherry-pick</span>
        <p>Lift one idea into your tree.</p>
      </article>
    </section>

    <section v-if="user && remotePosts.length">
      <div class="feed-head">
        <h2>git fetch remotes</h2>
        <span class="subtle mono">{{ remotes.map((r) => "remote:" + r).join("  ") }}</span>
      </div>
      <ol class="log-list">
        <PostRow v-for="p in remotePosts" :key="'r' + p.id" :post="p" />
      </ol>
    </section>

    <section>
      <div class="feed-head">
        <h2>origin / main</h2>
        <span class="subtle mono">{{ posts.length }} commit{{ posts.length === 1 ? "" : "s" }}</span>
      </div>
      <ol class="log-list">
        <PostRow v-for="p in posts" :key="p.id" :post="p" />
      </ol>
      <p v-if="!loading && !posts.length" class="empty">The log is empty. Be the first commit.</p>
      <p v-if="loading" class="empty">Reading the object store…</p>
    </section>
  </main>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const posts = ref<any[]>([]);
const remotePosts = ref<any[]>([]);
const remotes = ref<string[]>([]);
const loading = ref(true);

onMounted(async () => {
  if (!ready.value) await refresh();
  try {
    const data = await api<{ posts: any[] }>("/api/feed");
    posts.value = data.posts || [];
    if (user.value) {
      try {
        const r = await api<{ remotes: string[] }>("/api/remotes");
        remotes.value = r.remotes || [];
        if (remotes.value.length) {
          const f = await api<{ posts: any[] }>("/api/feed?followed=1");
          remotePosts.value = f.posts || [];
        }
      } catch {
        remotes.value = [];
      }
    }
  } finally {
    loading.value = false;
  }
});
</script>
