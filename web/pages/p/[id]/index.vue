<template>
  <main class="page article" v-if="post">
    <p class="kicker">
      <NuxtLink :to="`/u/${post.owner}`">{{ post.owner }}</NuxtLink>
      ·
      <span class="sha">{{ post.shortSha }}</span>
      ·
      {{ post.defaultBranch }}
      <span v-if="post.parentPostId">
        ·
        <span class="pill">{{ intentLabel(post.forkIntent) || "fork" }}</span>
        of
        <NuxtLink :to="`/p/${post.parentPostId}`">{{ post.parentPostId.slice(0, 8) }}</NuxtLink>
      </span>
    </p>
    <header class="post-head">
      <h1 class="subject">{{ post.subject }}</h1>
      <p v-if="post.forkIntentNote" class="muted" style="margin-top: -8px">{{ post.forkIntentNote }}</p>
      <div class="log-meta">
        <time :datetime="post.updatedAt">{{ formatFull(post.updatedAt) }}</time>
        <span>{{ post.commitCount }} {{ post.commitCount === 1 ? "commit" : "commits" }}</span>
        <span>{{ post.starCount }} {{ post.starCount === 1 ? "star" : "stars" }}</span>
        <span>{{ post.forkCount }} {{ post.forkCount === 1 ? "fork" : "forks" }}</span>
      </div>
      <div v-if="post.topics?.length" class="topic-row">
        <NuxtLink v-for="t in post.topics" :key="t" :to="`/explore?q=remote:${t}`" class="pill">remote:{{ t }}</NuxtLink>
        <button v-if="user && !followingAll" class="btn btn-ghost btn-sm" type="button" @click="followTopics">Track remotes</button>
      </div>
    </header>

    <div class="actions">
      <button class="btn btn-sm" :class="{ 'btn-primary': post.starred }" @click="act('star')">
        Star {{ post.starCount }}
      </button>
      <button class="btn btn-sm" :class="{ 'btn-primary': post.watched }" @click="act('watch')">
        Watch
      </button>
      <button class="btn btn-sm" @click="startFork">Fork</button>
      <NuxtLink v-if="mine" :to="`/p/${post.id}/edit`" class="btn btn-sm">Amend</NuxtLink>
      <button v-if="canPR" class="btn btn-sm" @click="openPR">Open pull request</button>
      <button v-if="canPropose" class="btn btn-sm" :class="{ 'btn-primary': proposeMode }" type="button" @click="togglePropose">
        {{ proposeMode ? "Done proposing" : "Propose a change" }}
      </button>
      <button v-if="mine && cherrySha" class="btn btn-sm" @click="doCherry">Cherry-pick {{ cherrySha.slice(0, 7) }}</button>
      <button v-if="user?.isAdmin" class="btn btn-sm btn-danger" type="button" @click="adminDelete">Remove post</button>
    </div>

    <div class="tabs" role="tablist">
      <button v-for="t in visibleTabs" :key="t.id" role="tab" :aria-selected="tab === t.id" @click="tab = t.id">
        {{ t.label }}
      </button>
    </div>

    <section v-if="tab === 'read'">
      <template v-if="proposeMode">
        <p class="muted" style="margin-top: 0">Pick the paragraph you disagree with.</p>
        <article v-for="para in paragraphs" :key="para.index" class="para-block">
          <MarkdownBody :source="para.text" />
          <button class="btn btn-sm" type="button" @click="proposePara(para)">Disagree</button>
        </article>
        <p v-if="!paragraphs.length" class="empty">No paragraphs to propose against yet.</p>
      </template>
      <template v-else>
        <TakeCarousel :takes="forks" :parent-id="post.parentPostId" />
        <p class="subtle blame-hint">Hover a paragraph for blame. Select a sentence to cherry-pick it.</p>
        <div class="read-body" @mouseup="onSelect" @keyup="onSelect">
          <BlameBody :post-id="post.id" :fallback="post.body" />
        </div>
        <StoryEmbed v-if="post.story" :story="post.story" />
      </template>
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
      <DiffView :diff="diff" :empty-label="diffEmpty" />
    </section>

    <section v-else-if="tab === 'diverge'">
      <div class="diverge-head">
        <div>
          <p class="kicker">{{ diverge?.intentLabel || intentLabel(post.forkIntent) || "fork" }}</p>
          <p class="muted" style="margin: 0 0 12px">
            Compared with
            <NuxtLink v-if="diverge" :to="`/p/${diverge.parentId}`">{{ diverge.parentSubject }}</NuxtLink>
          </p>
        </div>
        <div class="seg">
          <button type="button" :class="{ active: against === 'parent' }" @click="setAgainst('parent')">parent now</button>
          <button type="button" :class="{ active: against === 'base' }" @click="setAgainst('base')">at fork</button>
        </div>
      </div>
      <p v-if="diverge?.intentNote" class="muted">{{ diverge.intentNote }}</p>
      <DiffView :diff="diverge?.diff || ''" empty-label="This take still matches the parent." />
    </section>

    <section v-else-if="tab === 'discuss'">
      <DiscussThread :post-id="post.id" :mine="!!mine" />
    </section>

    <section v-else-if="tab === 'takes'">
      <p class="muted" style="margin-top: 0">Other branches of this idea. Each fork carries an intent.</p>
      <ul class="log-list">
        <li v-for="f in forks" :key="f.id" class="log-item">
          <div class="log-meta">
            <NuxtLink :to="`/u/${f.owner}`">{{ f.owner }}</NuxtLink>
            <span class="pill">{{ intentLabel(f.forkIntent) || "fork" }}</span>
            <NuxtLink :to="`/p/${f.id}`" class="sha">{{ f.shortSha }}</NuxtLink>
          </div>
          <h2 class="subject">
            <NuxtLink :to="`/p/${f.id}`">{{ f.subject }}</NuxtLink>
          </h2>
          <p v-if="f.forkIntentNote" class="muted" style="margin: 0">{{ f.forkIntentNote }}</p>
        </li>
      </ul>
      <p v-if="!forks.length" class="empty">No takes yet. Fork this object to start one.</p>
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
              <span v-if="pr.kind === 'paragraph'" class="pill">paragraph</span>
            </div>
          </div>
          <span class="pill">{{ pr.status }}</span>
        </li>
      </ul>
      <p v-if="!prs.length" class="empty">No pull requests on this object.</p>
    </section>

    <ForkSheet v-if="showFork" :post-id="post.id" @close="showFork = false" @forked="onForked" />
    <CherryPickSheet
      v-if="excerpt"
      :source-id="post.id"
      :source-owner="post.owner"
      :source-sha="post.shortSha"
      :excerpt="excerpt"
      @close="excerpt = ''"
      @picked="onPicked"
    />
    <ParagraphPropose
      v-if="proposal"
      :post-id="post.id"
      :index="proposal.index"
      :original="proposal.text"
      @close="proposal = null"
      @opened="onProposed"
    />
  </main>
  <main v-else class="page">
    <p class="empty">{{ loading ? "Resolving object…" : "Object not found." }}</p>
  </main>
</template>

<script setup lang="ts">
import { intentLabel } from "~/utils/intents";

const route = useRoute();
const { user, ready, refresh } = useAuth();
const post = ref<any>(null);
const loading = ref(true);
const tab = ref("read");
const tabs = [
  { id: "read", label: "Read" },
  { id: "history", label: "History" },
  { id: "diff", label: "Diff" },
  { id: "diverge", label: "Diverge" },
  { id: "discuss", label: "Discuss" },
  { id: "takes", label: "Takes" },
  { id: "branches", label: "Branches" },
  { id: "pulls", label: "Pulls" },
];
const commits = ref<any[]>([]);
const branches = ref<any[]>([]);
const prs = ref<any[]>([]);
const forks = ref<any[]>([]);
const paragraphs = ref<{ index: number; text: string }[]>([]);
const diverge = ref<any>(null);
const against = ref<"parent" | "base">("parent");
const diff = ref("");
const fromSha = ref("");
const toSha = ref("");
const blob = ref<any>(null);
const selectedSha = ref("");
const cherrySha = ref("");
const newBranch = ref("");
const flash = useFlash();
const showFork = ref(false);
const proposeMode = ref(false);
const proposal = ref<{ index: number; text: string } | null>(null);
const remotes = ref<string[]>([]);
const excerpt = ref("");

const followingAll = computed(() => {
  const topics: string[] = post.value?.topics || [];
  return topics.length > 0 && topics.every((t) => remotes.value.includes(t));
});

const visibleTabs = computed(() =>
  tabs.filter((t) => (t.id === "diverge" ? !!post.value?.parentPostId : true)),
);

const diffEmpty = computed(() => {
  if (commits.value.length < 2) return "This object has only one commit — nothing to compare yet.";
  if (fromSha.value && toSha.value && fromSha.value === toSha.value) {
    return "These two revisions are the same. Choose different commits to compare.";
  }
  return "No textual changes between these revisions.";
});

const mine = computed(() => user.value && post.value && user.value.handle === post.value.owner);
const canPR = computed(() => user.value && post.value && post.value.parentPostId && mine.value);
const canPropose = computed(() => user.value && post.value && !mine.value);

async function load() {
  loading.value = true;
  try {
    const data = await api<{ post: any }>(`/api/posts/${route.params.id}`);
    post.value = data.post;
    try {
      const [h, b, p, f] = await Promise.all([
        api<{ commits: any[] }>(`/api/posts/${data.post.id}/history`),
        api<{ branches: any[] }>(`/api/posts/${data.post.id}/branches`),
        api<{ prs: any[] }>(`/api/prs?post=${data.post.id}`),
        api<{ forks: any[] }>(`/api/posts/${data.post.id}/forks`),
      ]);
      commits.value = h.commits || [];
      branches.value = b.branches || [];
      prs.value = p.prs || [];
      forks.value = f.forks || [];
      if (commits.value.length >= 2) {
        toSha.value = commits.value[0].sha;
        fromSha.value = commits.value[commits.value.length - 1].sha;
        await loadDiff();
      } else if (commits.value.length === 1) {
        toSha.value = commits.value[0].sha;
        fromSha.value = commits.value[0].sha;
      }
      if (data.post.parentPostId) await loadDiverge();
    } catch (e: any) {
      flash.error(e);
    }
  } catch (e: any) {
    post.value = null;
    flash.error(e);
  } finally {
    loading.value = false;
  }
}

async function loadDiff() {
  if (!post.value || !fromSha.value || !toSha.value) return;
  if (fromSha.value === toSha.value) {
    diff.value = "";
    return;
  }
  const data = await api<{ diff: string }>(`/api/posts/${post.value.id}/diff?from=${fromSha.value}&to=${toSha.value}`);
  diff.value = data.diff || "";
}

async function loadDiverge() {
  if (!post.value?.parentPostId) return;
  diverge.value = await api(`/api/posts/${post.value.id}/diverge?against=${against.value}`);
}

async function setAgainst(next: "parent" | "base") {
  against.value = next;
  await loadDiverge();
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

function startFork() {
  if (!user.value) return navigateTo(`/login?next=/p/${route.params.id}`);
  showFork.value = true;
}

function onForked(id: string) {
  showFork.value = false;
  navigateTo(`/p/${id}/edit`);
}

function onSelect() {
  if (!user.value) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const text = sel.toString().replace(/\s+\n/g, "\n").trim();
  if (text.length < 8 || text.length > 8000) return;
  const root = document.querySelector(".read-body");
  if (!root || !sel.anchorNode || !root.contains(sel.anchorNode)) return;
  excerpt.value = text;
}

function onPicked(id: string) {
  excerpt.value = "";
  navigateTo(`/p/${id}`);
}

async function togglePropose() {
  if (!user.value) return navigateTo(`/login?next=/p/${route.params.id}`);
  proposeMode.value = !proposeMode.value;
  tab.value = "read";
  if (proposeMode.value && !paragraphs.value.length) {
    const data = await api<{ paragraphs: { index: number; text: string }[] }>(`/api/posts/${post.value.id}/paragraphs`);
    paragraphs.value = data.paragraphs || [];
  }
}

function proposePara(para: { index: number; text: string }) {
  proposal.value = para;
}

function onProposed(id: string) {
  proposal.value = null;
  proposeMode.value = false;
  navigateTo(`/pulls/${id}`);
}

async function openPR() {
  try {
    const data = await api<{ pr: any }>("/api/prs", {
      method: "POST",
      body: JSON.stringify({
        sourceId: post.value.id,
        targetId: post.value.parentPostId,
        title: post.value.subject,
        body: post.value.forkIntentNote || `Proposed ${intentLabel(post.value.forkIntent) || "improvement"} from my fork.`,
      }),
    });
    await navigateTo(`/pulls/${data.pr.id}`);
  } catch (e: any) {
    flash.error(e);
  }
}

async function createBranch() {
  try {
    await api(`/api/posts/${post.value.id}/branches`, {
      method: "POST",
      body: JSON.stringify({ name: newBranch.value }),
    });
    newBranch.value = "";
    const b = await api<{ branches: any[] }>(`/api/posts/${post.value.id}/branches`);
    branches.value = b.branches || [];
  } catch (e: any) {
    flash.error(e);
  }
}

async function checkout(name: string) {
  const data = await api<{ post: any }>(`/api/posts/${post.value.id}/checkout`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  post.value = data.post;
  flash.ok(`Checked out ${name}`);
}

async function doCherry() {
  try {
    const data = await api<{ post: any }>(`/api/posts/${post.value.id}/cherry-pick`, {
      method: "POST",
      body: JSON.stringify({ sha: cherrySha.value }),
    });
    post.value = data.post;
    flash.ok(`Cherry-picked ${cherrySha.value.slice(0, 7)}`);
    cherrySha.value = "";
    await load();
  } catch (e: any) {
    flash.error(e);
  }
}

async function adminDelete() {
  if (!confirm("Permanently remove this post?")) return;
  try {
    await api(`/api/admin/posts/${post.value.id}`, { method: "DELETE" });
    await navigateTo("/");
  } catch (e: any) {
    flash.error(e);
  }
}

onMounted(async () => {
  if (!ready.value) await refresh();
  if (user.value) {
    try {
      const r = await api<{ remotes: string[] }>("/api/remotes");
      remotes.value = r.remotes || [];
    } catch {
      remotes.value = [];
    }
  }
  await load();
});

async function followTopics() {
  if (!user.value) return navigateTo(`/login?next=/p/${route.params.id}`);
  for (const t of post.value.topics || []) {
    try {
      const data = await api<{ remotes: string[] }>("/api/remotes", {
        method: "POST",
        body: JSON.stringify({ topic: t }),
      });
      remotes.value = data.remotes || [];
    } catch (e: any) {
      flash.error(e);
    }
  }
  flash.ok("Tracking remotes");
}

watch(() => route.params.id, () => load());
watch(tab, async (id) => {
  if (id === "diverge" && !diverge.value) await loadDiverge();
});
</script>
