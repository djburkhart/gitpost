<template>
  <main class="page article" v-if="pr">
    <p class="kicker">pull request #{{ pr.number }} · {{ pr.status }}</p>
    <h1 class="subject">{{ pr.title }}</h1>
    <p class="log-meta">
      <NuxtLink :to="`/u/${pr.author}`">{{ pr.author }}</NuxtLink>
      wants to merge
      <NuxtLink :to="`/p/${pr.sourcePostId}`">{{ pr.sourcePostId.slice(0, 8) }}</NuxtLink>
      into
      <NuxtLink :to="`/p/${pr.targetPostId}`">{{ pr.targetPostId.slice(0, 8) }}</NuxtLink>
    </p>
    <MarkdownBody v-if="pr.body" :source="pr.body" />
    <h2 class="kicker">diff</h2>
    <DiffView :diff="diff" />
    <div class="actions" v-if="pr.status === 'open'">
      <button v-if="canMerge" class="btn btn-primary" type="button" @click="merge">Merge</button>
      <button v-if="canClose" class="btn" type="button" @click="closePR">Close</button>
    </div>
    <p v-if="pr.mergedSha" class="subtle">Merged as <span class="sha">{{ pr.mergedSha.slice(0, 7) }}</span></p>
    <p v-if="error" style="color: var(--del)">{{ error }}</p>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const { user, ready, refresh } = useAuth();
const pr = ref<any>(null);
const target = ref<any>(null);
const diff = ref("");
const error = ref("");

const canMerge = computed(() => user.value && target.value && user.value.handle === target.value.owner);
const canClose = computed(
  () => user.value && pr.value && (user.value.handle === pr.value.author || canMerge.value),
);

async function load() {
  const data = await api<{ pr: any; diff: string; target: any }>(`/api/prs/${route.params.id}`);
  pr.value = data.pr;
  diff.value = data.diff || "";
  target.value = data.target;
}

async function merge() {
  error.value = "";
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/merge`, { method: "POST" });
    pr.value = data.pr;
  } catch (e: any) {
    error.value = e.message;
  }
}

async function closePR() {
  error.value = "";
  try {
    const data = await api<{ pr: any }>(`/api/prs/${pr.value.id}/close`, { method: "POST" });
    pr.value = data.pr;
  } catch (e: any) {
    error.value = e.message;
  }
}

onMounted(async () => {
  if (!ready.value) await refresh();
  await load();
});
</script>
