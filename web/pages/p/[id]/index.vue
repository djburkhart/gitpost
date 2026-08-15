<template>
  <main class="page article" v-if="post">
    <p class="kicker">
      <NuxtLink :to="`/u/${post.owner}`">{{ post.owner }}</NuxtLink>
      ·
      <span class="sha">{{ post.shortSha }}</span>
      ·
      {{ post.defaultBranch }}
      <span v-if="post.parentPostId">
        · forked from
        <NuxtLink :to="`/p/${post.parentPostId}`">{{ post.parentPostId.slice(0, 8) }}</NuxtLink>
      </span>
    </p>
    <header class="post-head">
      <h1 class="subject">{{ post.subject }}</h1>
      <div class="log-meta">
        <time :datetime="post.updatedAt">{{ formatFull(post.updatedAt) }}</time>
        <span>{{ post.commitCount }} {{ post.commitCount === 1 ? "commit" : "commits" }}</span>
        <span>{{ post.starCount }} {{ post.starCount === 1 ? "star" : "stars" }}</span>
        <span>{{ post.forkCount }} {{ post.forkCount === 1 ? "fork" : "forks" }}</span>
      </div>
    </header>

    <div class="actions">
      <button class="btn btn-sm" :class="{ 'btn-primary': post.starred }" @click="act('star')">
        Star {{ post.starCount }}
      </button>
      <button class="btn btn-sm" :class="{ 'btn-primary': post.watched }" @click="act('watch')">
        Watch
      </button>
      <button class="btn btn-sm" @click="fork">Fork</button>
      <NuxtLink v-if="mine" :to="`/p/${post.id}/edit`" class="btn btn-sm">Amend</NuxtLink>
      <button v-if="canPR" class="btn btn-sm" @click="openPR">Open pull request</button>
      <button v-if="mine && cherrySha" class="btn btn-sm" @click="doCherry">Cherry-pick {{ cherrySha.slice(0, 7) }}</button>
      <button v-if="user?.isAdmin" class="btn btn-sm btn-danger" type="button" @click="adminDelete">Remove post</button>
    </div>
    <p v-if="notice" class="subtle">{{ notice }}</p>
    <p v-if="error" style="color: var(--del)">{{ error }}</p>

    <div class="tabs" role="tablist">
      <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="tab === t.id" @click="tab = t.id">
        {{ t.label }}
      </button>
    </div>

    <section v-if="tab === 'read'">
      <MarkdownBody :source="post.body" />
      <StoryEmbed v-if="post.story" :story="post.story" />
    </section>

    <section v-else-if="tab === 'history'">
      <p class="muted" style="margin-top: 0">Full edit history. This is a real <span class="mono">git log</span>.</p>
      <div v-for="c in commits" :key="c.sha" class="commit-row">
        <span class="dot" />
        <div>
          <div>{{ c.subject }}</div>
          <div class="log-meta">
            <span>{{ c.author }}</span>
            <time>{{ formatAgo(c.date) }}</time>
            <button class="btn btn-ghost btn-sm" type="button" @click="selectCommit(c.sha)">view blob</button>
            <button v-if="mine" class="btn btn-ghost btn-sm" type="button" @click="cherrySha = c.sha">mark cherry-pick</button>
          </div>
        </div>
        <span class="sha">{{ c.shortSha }}</span>
      </div>
      <article v-if="blob" style="margin-top: 24px">
        <p class="kicker">blob @ {{ selectedSha?.slice(0, 7) }}</p>
        <h2 class="subject">{{ blob.subject }}</h2>
        <MarkdownBody :source="blob.body" />
      </article>
    </section>

    <section v-else-if="tab === 'diff'">
      <div class="row" style="margin-bottom: 16px; flex-wrap: wrap">
        <label class="subtle" style="font-size: 0.8rem">
          from
          <select v-model="fromSha" class="btn btn-sm" style="margin-left: 8px" @change="loadDiff">
            <option v-for="c in commits" :key="'f' + c.sha" :value="c.sha">{{ c.shortSha }} · {{ c.subject.slice(0, 40) }}</option>
          </select>
        </label>
        <label class="subtle" style="font-size: 0.8rem">
          to
          <select v-model="toSha" class="btn btn-sm" style="margin-left: 8px" @change="loadDiff">
            <option v-for="c in commits" :key="'t' + c.sha" :value="c.sha">{{ c.shortSha }} · {{ c.subject.slice(0, 40) }}</option>
          </select>
        </label>
      </div>
      <DiffView :diff="diff" />
    </section>

    <section v-else-if="tab === 'branches'">
      <form v-if="mine" class="row" style="margin-bottom: 16px" @submit.prevent="createBranch">
        <input v-model="newBranch" placeholder="alternative-take" class="btn" style="flex: 1; text-align: left" />
        <button class="btn btn-primary" type="submit">Branch</button>
      </form>
      <ul class="log-list">
        <li v-for="b in branches" :key="b.name" class="commit-row" style="grid-template-columns: 12px 1fr auto">
          <span class="dot" />
          <div>
            <strong>{{ b.name }}</strong>
            <div class="sha">{{ b.sha.slice(0, 7) }}</div>
          </div>
          <button v-if="mine && !b.head" class="btn btn-sm" type="button" @click="checkout(b.name)">check out</button>
        </li>
      </ul>
    </section>

    <section v-else>
      <ul class="log-list">
        <li v-for="pr in prs" :key="pr.id" class="commit-row" style="grid-template-columns: 1fr auto">
          <div>
            <NuxtLink :to="`/pulls/${pr.id}`">#{{ pr.number }} {{ pr.title }}</NuxtLink>
            <div class="log-meta">
              <span>{{ pr.author }}</span>
              <span>{{ pr.status }}</span>
            </div>
          </div>
          <span class="pill">{{ pr.status }}</span>
        </li>
      </ul>
      <p v-if="!prs.length" class="empty">No pull requests on this object.</p>
    </section>
  </main>
  <main v-else class="page">
    <p class="empty">{{ loading ? "Resolving object…" : "Object not found." }}</p>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const { user, ready, refresh } = useAuth();
const post = ref<any>(null);
const loading = ref(true);
const tab = ref("read");
const tabs = [
  { id: "read", label: "Read" },
  { id: "history", label: "History" },
  { id: "diff", label: "Diff" },
  { id: "branches", label: "Branches" },
  { id: "pulls", label: "Pulls" },
];
const commits = ref<any[]>([]);
const branches = ref<any[]>([]);
const prs = ref<any[]>([]);
const diff = ref("");
const fromSha = ref("");
const toSha = ref("");
const blob = ref<any>(null);
const selectedSha = ref("");
const cherrySha = ref("");
const newBranch = ref("");
const notice = ref("");
const error = ref("");

const mine = computed(() => user.value && post.value && user.value.handle === post.value.owner);
const canPR = computed(() => user.value && post.value && post.value.parentPostId && mine.value);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await api<{ post: any }>(`/api/posts/${route.params.id}`);
    post.value = data.post;
    try {
      const [h, b, p] = await Promise.all([
        api<{ commits: any[] }>(`/api/posts/${data.post.id}/history`),
        api<{ branches: any[] }>(`/api/posts/${data.post.id}/branches`),
        api<{ prs: any[] }>(`/api/prs?post=${data.post.id}`),
      ]);
      commits.value = h.commits || [];
      branches.value = b.branches || [];
      prs.value = p.prs || [];
      if (commits.value.length >= 2) {
        toSha.value = commits.value[0].sha;
        fromSha.value = commits.value[commits.value.length - 1].sha;
        await loadDiff();
      } else if (commits.value.length === 1) {
        toSha.value = commits.value[0].sha;
        fromSha.value = commits.value[0].sha;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  } catch (e: any) {
    post.value = null;
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadDiff() {
  if (!post.value || !fromSha.value || !toSha.value) return;
  const data = await api<{ diff: string }>(`/api/posts/${post.value.id}/diff?from=${fromSha.value}&to=${toSha.value}`);
  diff.value = data.diff || "";
}

async function selectCommit(sha: string) {
  selectedSha.value = sha;
  const data = await api(`/api/posts/${post.value.id}/blob?sha=${sha}`);
  blob.value = data;
}

async function act(kind: "star" | "watch") {
  if (!user.value) return navigateTo(`/login?next=/p/${route.params.id}`);
  const data = await api<{ post: any }>(`/api/posts/${post.value.id}/${kind}`, { method: "POST" });
  post.value = data.post;
}

async function fork() {
  if (!user.value) return navigateTo(`/login?next=/p/${route.params.id}`);
  error.value = "";
  try {
    const data = await api<{ post: any }>(`/api/posts/${post.value.id}/fork`, { method: "POST" });
    await navigateTo(`/p/${data.post.id}`);
  } catch (e: any) {
    error.value = e.message;
  }
}

async function openPR() {
  error.value = "";
  try {
    const data = await api<{ pr: any }>("/api/prs", {
      method: "POST",
      body: JSON.stringify({
        sourceId: post.value.id,
        targetId: post.value.parentPostId,
        title: post.value.subject,
        body: "Proposed improvement from my fork.",
      }),
    });
    await navigateTo(`/pulls/${data.pr.id}`);
  } catch (e: any) {
    error.value = e.message;
  }
}

async function createBranch() {
  error.value = "";
  try {
    await api(`/api/posts/${post.value.id}/branches`, {
      method: "POST",
      body: JSON.stringify({ name: newBranch.value }),
    });
    newBranch.value = "";
    const b = await api<{ branches: any[] }>(`/api/posts/${post.value.id}/branches`);
    branches.value = b.branches || [];
  } catch (e: any) {
    error.value = e.message;
  }
}

async function checkout(name: string) {
  const data = await api<{ post: any }>(`/api/posts/${post.value.id}/checkout`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  post.value = data.post;
  notice.value = `Checked out ${name}`;
}

async function doCherry() {
  error.value = "";
  try {
    const data = await api<{ post: any }>(`/api/posts/${post.value.id}/cherry-pick`, {
      method: "POST",
      body: JSON.stringify({ sha: cherrySha.value }),
    });
    post.value = data.post;
    notice.value = `Cherry-picked ${cherrySha.value.slice(0, 7)}`;
    cherrySha.value = "";
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
}

async function adminDelete() {
  if (!confirm("Permanently remove this post?")) return;
  error.value = "";
  try {
    await api(`/api/admin/posts/${post.value.id}`, { method: "DELETE" });
    await navigateTo("/");
  } catch (e: any) {
    error.value = e.message;
  }
}

onMounted(async () => {
  if (!ready.value) await refresh();
  await load();
});

watch(() => route.params.id, () => load());
</script>
