<template>
  <main class="page wide-page">
    <p class="kicker">git log --graph --decorate --all</p>
    <h1 class="subject" style="font-size: var(--text-2xl)">A living repo history</h1>
    <p class="muted" style="max-width: 52ch">
      Popular objects, forks, and merges as a commit graph — not a flat timeline.
      Track a topic like a remote and fetch it into your log.
    </p>

    <div class="explore-toolbar">
      <div class="field" style="flex: 1; margin: 0">
        <label for="q">Search or remote:topic</label>
        <input id="q" v-model="q" placeholder="remote:ai-safety, rebase, cookie…" @input="onType" />
      </div>
    </div>

    <section class="remotes-bar">
      <p class="kicker" style="margin-bottom: 8px">remotes</p>
      <div class="topic-field">
        <button
          v-for="t in topics"
          :key="t.topic"
          type="button"
          class="pill"
          :class="{ active: topic === t.topic }"
          @click="selectTopic(t.topic)"
        >
          remote:{{ t.topic }}
          <span class="subtle">{{ t.count }}</span>
        </button>
        <template v-if="user">
          <span v-for="r in remotes" :key="'f' + r" class="pill topic-pill">
            tracking {{ r }}
            <button type="button" class="topic-x" @click="unfollow(r)">×</button>
          </span>
          <input
            v-model="remoteDraft"
            class="topic-input"
            placeholder="git remote add …"
            @keydown.enter.prevent="follow"
          />
        </template>
      </div>
    </section>

    <section v-if="trending.length" class="trending">
      <div class="feed-head">
        <h2>trending SHAs</h2>
        <span class="subtle mono">this week · forks · PRs · cherry-picks</span>
      </div>
      <ol class="trend-list">
        <li v-for="(t, i) in trending" :key="t.id">
          <span class="trend-rank">{{ String(i + 1).padStart(2, "0") }}</span>
          <div>
            <NuxtLink :to="`/p/${t.id}`" class="sha">{{ t.shortSha }}</NuxtLink>
            <NuxtLink :to="`/p/${t.id}`" class="trend-sub">{{ t.subject }}</NuxtLink>
            <div class="log-stats">
              <span v-if="t.forks">{{ t.forks }} forks</span>
              <span v-if="t.prs">{{ t.prs }} PRs</span>
              <span v-if="t.cherries">{{ t.cherries }} cherry-picks</span>
              <span v-if="t.merges">{{ t.merges }} merges</span>
            </div>
          </div>
        </li>
      </ol>
    </section>

    <section>
      <div class="feed-head">
        <h2>{{ topic ? "remote / " + topic : "HEAD" }}</h2>
        <span class="subtle mono">{{ graphNodes.length }} object{{ graphNodes.length === 1 ? "" : "s" }}</span>
      </div>
      <CommitGraph :nodes="graphNodes" />
    </section>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const { user, ready, refresh } = useAuth();
const q = ref("");
const topic = ref("");
const topics = ref<{ topic: string; count: number }[]>([]);
const remotes = ref<string[]>([]);
const trending = ref<any[]>([]);
const graphNodes = ref<any[]>([]);
const remoteDraft = ref("");
const flash = useFlash();
let t: ReturnType<typeof setTimeout> | null = null;

async function loadGraph() {
  const data = await api<{ nodes: any[] }>("/api/graph");
  let nodes = data.nodes || [];
  const needle = q.value.trim().toLowerCase();
  if (topic.value) {
    nodes = nodes.filter((n) => (n.topics || []).includes(topic.value));
  }
  if (needle && !needle.startsWith("remote:")) {
    nodes = nodes.filter(
      (n) =>
        `${n.subject} ${n.owner} ${(n.topics || []).join(" ")}`.toLowerCase().includes(needle),
    );
  }
  graphNodes.value = nodes;
}

async function load() {
  try {
    const [g, tr, tp] = await Promise.all([
      api<{ nodes: any[] }>("/api/graph"),
      api<{ trending: any[] }>("/api/trending"),
      api<{ topics: { topic: string; count: number }[] }>("/api/topics"),
    ]);
    graphNodes.value = g.nodes || [];
    trending.value = tr.trending || [];
    topics.value = tp.topics || [];
    if (user.value) {
      const r = await api<{ remotes: string[] }>("/api/remotes");
      remotes.value = r.remotes || [];
    }
    await loadGraph();
  } catch (e: any) {
    flash.error(e);
  }
}

function onType() {
  const v = q.value.trim();
  if (v.toLowerCase().startsWith("remote:")) {
    topic.value = v.slice(7).toLowerCase().replace(/[^a-z0-9-]/g, "");
  }
  if (t) clearTimeout(t);
  t = setTimeout(loadGraph, 160);
}

function selectTopic(name: string) {
  topic.value = topic.value === name ? "" : name;
  q.value = topic.value ? `remote:${topic.value}` : "";
  loadGraph();
}

async function follow() {
  const name = remoteDraft.value.trim();
  if (!name) return;
  try {
    const data = await api<{ remotes: string[] }>("/api/remotes", {
      method: "POST",
      body: JSON.stringify({ topic: name }),
    });
    remotes.value = data.remotes || [];
    remoteDraft.value = "";
    topic.value = remotes.value[remotes.value.length - 1] || topic.value;
    q.value = topic.value ? `remote:${topic.value}` : q.value;
    await loadGraph();
  } catch (e: any) {
    flash.error(e);
  }
}

async function unfollow(name: string) {
  const data = await api<{ remotes: string[] }>(`/api/remotes/${encodeURIComponent(name)}`, { method: "DELETE" });
  remotes.value = data.remotes || [];
  if (topic.value === name) {
    topic.value = "";
    q.value = "";
    await loadGraph();
  }
}

onMounted(async () => {
  if (!ready.value) await refresh();
  const initial = String(route.query.q || "");
  if (initial) {
    q.value = initial;
    if (initial.toLowerCase().startsWith("remote:")) {
      topic.value = initial.slice(7).toLowerCase().replace(/[^a-z0-9-]/g, "");
    }
  }
  await load();
});
</script>
