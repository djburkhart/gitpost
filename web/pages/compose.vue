<template>
  <main class="page article">
    <p class="kicker">{{ draftId ? "working tree" : "git commit" }}</p>
    <h1 class="subject" style="font-size: var(--text-2xl); margin-top: 0">
      {{ draftId ? "Private draft" : "New object" }}
    </h1>
    <p class="muted">
      Save privately until the thought is ready. Commit publishes a sealed object.
    </p>
    <form @submit.prevent="publish">
      <div class="field">
        <label for="subject">
          Subject
          <span class="counter" :class="{ warn: subject.length > 50, bad: subject.length > 72 }">
            {{ subject.length }}/72
          </span>
        </label>
        <input
          id="subject"
          v-model="subject"
          class="subject-input"
          maxlength="120"
          placeholder="Reject stale session tokens after password change"
        />
      </div>
      <div class="field">
        <label>Body</label>
        <WysimarkEditor ref="editor" v-model="body" placeholder="Why this exists. Write in Markdown — headings, lists, code, tables." />
      </div>
      <details style="margin-bottom: 24px">
        <summary class="muted" style="cursor: pointer; font-size: 0.9rem">Story mode — embed a GitHub or GitLab commit / PR</summary>
        <div class="field" style="margin-top: 12px">
          <label for="story">URL</label>
          <input id="story" v-model="storyUrl" placeholder="https://github.com/git/git/commit/…" @change="previewStory" />
        </div>
        <StoryEmbed v-if="story" :story="story" />
      </details>
      <TopicField v-model="topics" label="Remotes" placeholder="ai-safety, writing…" />
      <p class="subtle">{{ saveHint }}</p>
      <div class="row">
        <button class="btn" type="button" :disabled="busy || !dirty" @click="saveDraft">Save draft</button>
        <button class="btn btn-primary" type="submit" :disabled="busy || !subject.trim()">Commit</button>
        <NuxtLink to="/drafts" class="btn btn-ghost">Working tree</NuxtLink>
      </div>
    </form>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const { user, ready, refresh } = useAuth();
const flash = useFlash();
const subject = ref("");
const body = ref("");
const storyUrl = ref("");
const story = ref<any>(null);
const topics = ref<string[]>([]);
const busy = ref(false);
const draftId = ref("");
const dirty = ref(false);
const saveHint = ref("Drafts stay private.");
const editor = ref<{ getMarkdown: () => string } | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  if (!ready.value) await refresh();
  if (!user.value) {
    await navigateTo("/login?next=/compose");
    return;
  }
  const id = String(route.query.draft || "");
  if (id) {
    try {
      const data = await api<{ draft: any }>(`/api/drafts/${id}`);
      applyDraft(data.draft);
    } catch {
      flash.error("Draft not found");
    }
  }
  watch([subject, body, storyUrl, topics], () => {
    dirty.value = true;
    schedule();
  }, { deep: true });
});

function applyDraft(d: any) {
  draftId.value = d.id;
  subject.value = d.subject || "";
  body.value = d.body || "";
  storyUrl.value = d.storyUrl || "";
  topics.value = d.topics || [];
  dirty.value = false;
}

function payload() {
  return {
    subject: subject.value,
    body: editor.value?.getMarkdown() ?? body.value,
    storyUrl: storyUrl.value,
    topics: topics.value,
  };
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => saveDraft(true), 1800);
}

async function saveDraft(silent = false) {
  if (!user.value) return;
  const data = payload();
  if (!data.subject.trim() && !String(data.body || "").trim()) return;
  busy.value = !silent;
  try {
    if (draftId.value) {
      const res = await api<{ draft: any }>(`/api/drafts/${draftId.value}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      dirty.value = false;
      saveHint.value = "Saved to working tree.";
      if (!silent) applyDraft(res.draft);
    } else {
      const res = await api<{ draft: any }>("/api/drafts", {
        method: "POST",
        body: JSON.stringify(data),
      });
      applyDraft(res.draft);
      saveHint.value = "Draft created — still private.";
      await router.replace({ path: "/compose", query: { draft: res.draft.id } });
    }
  } catch (e: any) {
    if (!silent) flash.error(e);
  } finally {
    busy.value = false;
  }
}

async function previewStory() {
  if (!storyUrl.value) {
    story.value = null;
    return;
  }
  try {
    const data = await api<{ story: any }>(`/api/story/preview?url=${encodeURIComponent(storyUrl.value)}`);
    story.value = data.story;
  } catch {
    story.value = { url: storyUrl.value, provider: "link", htmlUrl: storyUrl.value };
  }
}

async function publish() {
  if (!subject.value.trim()) return;
  busy.value = true;
  try {
    await saveDraft(true);
    if (draftId.value) {
      const data = await api<{ post: any }>(`/api/drafts/${draftId.value}/commit`, { method: "POST" });
      await navigateTo(`/p/${data.post.id}`);
      return;
    }
    const data = await api<{ post: any }>("/api/posts", {
      method: "POST",
      body: JSON.stringify(payload()),
    });
    await navigateTo(`/p/${data.post.id}`);
  } catch (e: any) {
    flash.error(e.message || "Commit failed");
  } finally {
    busy.value = false;
  }
}
</script>
