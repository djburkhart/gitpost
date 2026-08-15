<template>
  <main class="page article" v-if="pr">
    <p class="kicker">
      pull request #{{ pr.number }} · {{ pr.status }}
      <span v-if="pr.kind === 'paragraph'" class="pill">paragraph</span>
      <span v-if="pr.draft" class="pill">draft</span>
    </p>
    <h1 class="subject">{{ pr.title }}</h1>
    <p class="log-meta">
      <NuxtLink :to="`/u/${pr.author}`">{{ pr.author }}</NuxtLink>
      <template v-if="pr.kind === 'paragraph'">
        wants to change a paragraph in
        <NuxtLink :to="`/p/${pr.targetPostId}`">{{ pr.targetPostId.slice(0, 8) }}</NuxtLink>
      </template>
      <template v-else>
        wants to merge
        <NuxtLink :to="`/p/${pr.sourcePostId}`">{{ pr.sourcePostId.slice(0, 8) }}</NuxtLink>
        into
        <NuxtLink :to="`/p/${pr.targetPostId}`">{{ pr.targetPostId.slice(0, 8) }}</NuxtLink>
      </template>
    </p>

    <section v-if="pr.kind === 'paragraph'" class="para-review">
      <div v-if="pr.rationale" class="card" style="margin-bottom: 20px">
        <p class="kicker">why they disagree</p>
        <MarkdownBody :source="pr.rationale" />
      </div>
      <div class="para-compare">
        <div>
          <p class="kicker">current</p>
          <div class="para-box">{{ pr.original }}</div>
        </div>
        <div>
          <p class="kicker">proposed</p>
          <div class="para-box proposed">{{ pr.proposed }}</div>
        </div>
      </div>
    </section>
    <template v-else>
      <MarkdownBody v-if="pr.body" :source="pr.body" />
      <h2 class="kicker">diff</h2>
      <DiffView :diff="diff" />
    </template>

    <section v-if="pr.status === 'conflict'" class="conflict-box">
      <p class="kicker">idea conflict</p>
      <p class="muted">Two claims cannot be merged silently. Resolve the markers into one piece of prose.</p>
      <textarea v-model="resolved" class="para-edit conflict-edit" rows="16" />
      <button v-if="canMerge" class="btn btn-primary" type="button" @click="resolve">Commit resolution</button>
    </section>

    <section class="review-box">
      <p class="kicker">review requests</p>
      <ul class="log-list">
        <li v-for="r in pr.reviewers || []" :key="r.handle" class="commit-row" style="grid-template-columns: 1fr auto">
          <div>
            <NuxtLink :to="`/u/${r.handle}`">@{{ r.handle }}</NuxtLink>
            <div class="log-meta">
              <span class="pill">{{ r.status }}</span>
              <span v-if="r.note">{{ r.note }}</span>
            </div>
          </div>
          <div v-if="user?.handle === r.handle && r.status === 'requested'" class="row">
            <button class="btn btn-sm btn-primary" type="button" @click="review('approved')">Approve</button>
            <button class="btn btn-sm" type="button" @click="review('changes')">Request changes</button>
          </div>
        </li>
      </ul>
      <p v-if="!(pr.reviewers || []).length" class="empty">No formal reviews requested.</p>
      <form v-if="canRequest" class="row" @submit.prevent="requestReview">
        <input v-model="reviewer" class="btn" style="flex: 1; text-align: left" placeholder="@user" />
        <button class="btn btn-primary" type="submit">Request review</button>
      </form>
    </section>

    <div class="actions" v-if="pr.status === 'open'">
      <button v-if="canMerge" class="btn btn-primary" type="button" @click="merge" :disabled="!reviewsOk">
        {{ pr.kind === "paragraph" ? "Accept paragraph" : "Merge" }}
      </button>
      <button v-if="canClose" class="btn" type="button" @click="closePR">
        {{ pr.kind === "paragraph" ? "Reject" : "Close" }}
      </button>
    </div>
    <p v-if="pr.mergedSha" class="subtle">Merged as <span class="sha">{{ pr.mergedSha.slice(0, 7) }}</span></p>
    <p v-if="pr.reviewNote" class="muted">Review note: {{ pr.reviewNote }}</p>

    <section class="pr-comments" v-if="pr.status === 'open' || (pr.comments && pr.comments.length)">
      <p class="kicker">discussion</p>
      <div v-for="(c, i) in pr.comments || []" :key="i" class="comment">
        <div class="log-meta">
          <NuxtLink :to="`/u/${c.author}`">{{ c.author }}</NuxtLink>
          <time>{{ formatAgo(c.createdAt) }}</time>
        </div>
        <p>{{ c.body }}</p>
      </div>
      <form v-if="canComment" class="comment-form" @submit.prevent="sendComment">
        <textarea v-model="comment" rows="3" class="para-edit" placeholder="Reply to this proposal." />
        <button class="btn btn-sm" type="submit" :disabled="!comment.trim()">Comment</button>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const { user, ready, refresh } = useAuth();
const pr = ref<any>(null);
const target = ref<any>(null);
const diff = ref("");
const comment = ref("");
const reviewer = ref("");
const resolved = ref("");
const flash = useFlash();

const canMerge = computed(() => user.value && target.value && (target.value.canPush || user.value.handle === target.value.owner));
const canClose = computed(
  () => user.value && pr.value && (user.value.handle === pr.value.author || canMerge.value),
);
const canComment = computed(() => canClose.value && (pr.value?.status === "open" || pr.value?.status === "conflict"));
const canRequest = computed(() => canClose.value && pr.value?.status === "open");
const reviewsOk = computed(() => {
  const list = pr.value?.reviewers || [];
  if (!list.length) return !pr.value?.draft;
  return list.every((r: any) => r.status === "approved");
});

async function load() {
  const data = await api<{ pr: any; diff: string; target: any }>(`/api/prs/${route.params.id}`);
  pr.value = data.pr;
  diff.value = data.diff || "";
  target.value = data.target;
  if (data.pr.conflictBody) resolved.value = data.pr.conflictBody;
}

async function merge() {
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/merge`, { method: "POST" });
    pr.value = data.pr;
    if (pr.value.status === "conflict") {
      resolved.value = pr.value.conflictBody || "";
      flash.info("Idea conflict", "Resolve the markers — this will not overwrite silently.");
    } else {
      flash.ok(pr.value.kind === "paragraph" ? "Paragraph accepted" : "Merged");
    }
  } catch (e: any) {
    flash.error(e);
  }
}

async function closePR() {
  const note = pr.value.kind === "paragraph" ? prompt("Optional note for the author") || "" : "";
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/close`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    pr.value = data.pr;
    flash.ok(pr.value.kind === "paragraph" ? "Proposal rejected" : "Closed");
  } catch (e: any) {
    flash.error(e);
  }
}

async function requestReview() {
  const handle = reviewer.value.replace(/^@/, "").trim();
  if (!handle) return;
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/reviewers`, {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
    pr.value = data.pr;
    reviewer.value = "";
    flash.ok(`Review requested from @${handle}`);
  } catch (e: any) {
    flash.error(e);
  }
}

async function review(status: string) {
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/review`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    pr.value = data.pr;
    flash.ok(status === "approved" ? "Approved" : "Changes requested");
  } catch (e: any) {
    flash.error(e);
  }
}

async function resolve() {
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ body: resolved.value }),
    });
    pr.value = data.pr;
    flash.ok("Conflict resolved");
  } catch (e: any) {
    flash.error(e);
  }
}

async function sendComment() {
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: comment.value }),
    });
    pr.value = data.pr;
    comment.value = "";
  } catch (e: any) {
    flash.error(e);
  }
}

onMounted(async () => {
  if (!ready.value) await refresh();
  await load();
});
</script>
