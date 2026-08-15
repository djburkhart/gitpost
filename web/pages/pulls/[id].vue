<template>
  <main class="page article" v-if="pr">
    <p class="kicker">
      pull request #{{ pr.number }} · {{ pr.status }}
      <span v-if="pr.kind === 'paragraph'" class="pill">paragraph</span>
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

    <div class="actions" v-if="pr.status === 'open'">
      <button v-if="canMerge" class="btn btn-primary" type="button" @click="merge">
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
const flash = useFlash();

const canMerge = computed(() => user.value && target.value && user.value.handle === target.value.owner);
const canClose = computed(
  () => user.value && pr.value && (user.value.handle === pr.value.author || canMerge.value),
);
const canComment = computed(() => canClose.value && pr.value?.status === "open");

async function load() {
  const data = await api<{ pr: any; diff: string; target: any }>(`/api/prs/${route.params.id}`);
  pr.value = data.pr;
  diff.value = data.diff || "";
  target.value = data.target;
}

async function merge() {
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/merge`, { method: "POST" });
    pr.value = data.pr;
    flash.ok(pr.value.kind === "paragraph" ? "Paragraph accepted" : "Merged");
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
