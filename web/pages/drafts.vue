<template>
  <main class="page article">
    <p class="kicker">working tree</p>
    <h1 class="subject" style="margin-top: 0">Private drafts</h1>
    <p class="muted">Uncommitted thoughts. Nobody else can see these until you commit.</p>
    <div class="row" style="margin-bottom: 16px">
      <NuxtLink to="/compose" class="btn btn-primary btn-sm">New draft</NuxtLink>
    </div>
    <ul class="log-list">
      <li v-for="d in drafts" :key="d.id" class="invite-row">
        <div>
          <NuxtLink :to="`/compose?draft=${d.id}`">{{ d.subject || "(no subject)" }}</NuxtLink>
          <div class="log-meta">
            <time>{{ formatAgo(d.updatedAt) }}</time>
            <span>{{ (d.body || "").length }} chars</span>
          </div>
        </div>
        <div class="row">
          <button class="btn btn-sm" type="button" :disabled="!d.subject" @click="commit(d)">Commit</button>
          <button class="btn btn-sm btn-danger" type="button" @click="drop(d.id)">Discard</button>
        </div>
      </li>
    </ul>
    <p v-if="!drafts.length" class="empty">Working tree clean.</p>
  </main>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const flash = useFlash();
const drafts = ref<any[]>([]);

onMounted(async () => {
  if (!ready.value) await refresh();
  if (!user.value) return navigateTo("/login?next=/drafts");
  await load();
});

async function load() {
  const data = await api<{ drafts: any[] }>("/api/drafts");
  drafts.value = data.drafts || [];
}

async function commit(d: any) {
  try {
    const data = await api<{ post: any }>(`/api/drafts/${d.id}/commit`, { method: "POST" });
    await navigateTo(`/p/${data.post.id}`);
  } catch (e: any) {
    flash.error(e);
  }
}

async function drop(id: string) {
  await api(`/api/drafts/${id}`, { method: "DELETE" });
  await load();
}
</script>
