<template>
  <main class="page article">
    <p class="kicker">ship log</p>
    <h1 class="subject" style="margin-top: 0">Changelog suggestions</h1>
    <p class="muted">Watch a GitHub repo. When it tags a release, we draft the product post so writing stays tied to shipping.</p>

    <form class="row" style="margin: 16px 0 12px; flex-wrap: wrap" @submit.prevent="addWatch">
      <input v-model="repo" class="subject-input" style="flex: 1; min-width: 200px" placeholder="owner/repo or github.com/owner/repo" />
      <button class="btn btn-primary" type="submit" :disabled="!repo.trim() || busy">Watch</button>
    </form>
    <form class="row" style="margin: 0 0 28px; flex-wrap: wrap" @submit.prevent="fromURL">
      <input v-model="releaseUrl" class="subject-input" style="flex: 1; min-width: 200px" placeholder="or paste a release URL" />
      <button class="btn" type="submit" :disabled="!releaseUrl.trim() || busy">Suggest</button>
    </form>

    <section v-if="watches.length" style="margin-bottom: 32px">
      <p class="kicker">watching</p>
      <ul class="log-list">
        <li v-for="w in watches" :key="w.id" class="invite-row">
          <div>
            <a :href="`https://github.com/${w.repo}`" target="_blank" rel="noreferrer">{{ w.repo }}</a>
            <div class="log-meta">
              <span v-if="w.lastTag">last {{ w.lastTag }}</span>
              <span v-else>no release seen yet</span>
            </div>
          </div>
          <button class="btn btn-sm" type="button" @click="drop(w.repo)">Unwatch</button>
        </li>
      </ul>
    </section>

    <section>
      <p class="kicker">suggested posts</p>
      <ul class="log-list">
        <li v-for="h in hints" :key="h.id" class="invite-row">
          <div>
            <div>{{ h.name }} <span class="sha">{{ h.tag }}</span></div>
            <div class="log-meta">
              <span>{{ h.repo }}</span>
              <a :href="h.htmlUrl" target="_blank" rel="noreferrer">release</a>
            </div>
          </div>
          <div class="row">
            <button class="btn btn-sm btn-primary" type="button" @click="toDraft(h)">Write post</button>
            <button class="btn btn-sm" type="button" @click="dismiss(h.id)">Dismiss</button>
          </div>
        </li>
      </ul>
      <p v-if="!hints.length" class="empty">No new tags. Watch a repo that ships.</p>
    </section>
  </main>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const flash = useFlash();
const repo = ref("");
const releaseUrl = ref("");
const busy = ref(false);
const watches = ref<any[]>([]);
const hints = ref<any[]>([]);

onMounted(async () => {
  if (!ready.value) await refresh();
  if (!user.value) return navigateTo("/login?next=/changelog");
  await load();
});

async function load() {
  const data = await api<{ hints: any[]; watches: any[] }>("/api/changelog");
  hints.value = data.hints || [];
  watches.value = data.watches || [];
}

async function addWatch() {
  if (!repo.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await api("/api/watches", { method: "POST", body: JSON.stringify({ repo: repo.value }) });
    repo.value = "";
    await load();
  } catch (e: any) {
    flash.error(e);
  } finally {
    busy.value = false;
  }
}

async function fromURL() {
  if (!releaseUrl.value.trim() || busy.value) return;
  busy.value = true;
  try {
    const data = await api<{ hints: any[] }>("/api/changelog/from-url", {
      method: "POST",
      body: JSON.stringify({ url: releaseUrl.value }),
    });
    releaseUrl.value = "";
    hints.value = data.hints || [];
  } catch (e: any) {
    flash.error(e);
  } finally {
    busy.value = false;
  }
}

async function drop(name: string) {
  await api(`/api/watches?repo=${encodeURIComponent(name)}`, { method: "DELETE" });
  await load();
}

async function toDraft(h: any) {
  try {
    const data = await api<{ draft: any }>(`/api/changelog/${h.id}/draft`, { method: "POST" });
    await navigateTo(`/compose?draft=${data.draft.id}&mode=story`);
  } catch (e: any) {
    flash.error(e);
  }
}

async function dismiss(id: string) {
  const data = await api<{ hints: any[] }>(`/api/changelog/${id}/dismiss`, { method: "POST" });
  hints.value = data.hints || [];
}
</script>
