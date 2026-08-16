<template>
  <main class="page article">
    <p class="kicker">{{ draftId ? "working tree" : mode === "story" ? "story commit" : "git commit" }}</p>
    <h1 class="subject" style="font-size: var(--text-2xl); margin-top: 0">
      {{ mode === "story" ? "Narrative around real code" : draftId ? "Private draft" : "New object" }}
    </h1>
    <div class="mode-switch" role="tablist">
      <button type="button" :class="{ on: mode === 'write' }" @click="mode = 'write'">Write</button>
      <button type="button" :class="{ on: mode === 'story' }" @click="mode = 'story'">Story commit</button>
    </div>
    <p class="muted">
      <template v-if="mode === 'story'">
        Paste a GitHub or GitLab commit, pull request, issue, or release. Write why it matters — the diff stays attached.
      </template>
      <template v-else>Save privately until the thought is ready. Commit publishes a sealed object.</template>
    </p>
    <form @submit.prevent="publish">
      <div v-if="mode === 'story'" class="field">
        <label for="story">Code object URL</label>
        <input
          id="story"
          v-model="storyUrl"
          class="subject-input"
          placeholder="https://github.com/git/git/commit/… or /pull/12 or /releases/tag/v2.0"
          @change="previewStory"
        />
        <StoryEmbed v-if="story" :story="story" />
        <p v-if="storyBusy" class="subtle">Fetching the object…</p>
      </div>
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
          :placeholder="mode === 'story' ? 'Why this change belongs in the log' : 'Reject stale session tokens after password change'"
        />
      </div>
      <div class="field">
        <label>{{ mode === "story" ? "Narrative" : "Body" }}</label>
        <WysimarkEditor
          ref="editor"
          v-model="body"
          :placeholder="mode === 'story' ? 'What shipped, what it means, what to watch next.' : 'Why this exists. Write in Markdown — headings, lists, code, tables.'"
        />
      </div>
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
const mode = ref<"write" | "story">("write");
const subject = ref("");
const body = ref("");
const storyUrl = ref("");
const story = ref<any>(null);
const storyBusy = ref(false);
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
  if (route.query.mode === "story") mode.value = "story";
  const id = String(route.query.draft || "");
  if (id) {
    try {
      const data = await api<{ draft: any }>(`/api/drafts/${id}`);
      applyDraft(data.draft);
    } catch {
      flash.error("Draft not found");
    }
  }
  if (route.query.url) {
    mode.value = "story";
    storyUrl.value = String(route.query.url);
    await previewStory();
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
  if (d.storyUrl) {
    mode.value = "story";
    previewStory();
  }
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
  if (!data.subject.trim() && !String(data.body || "").trim() && !data.storyUrl) return;
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
      await router.replace({ path: "/compose", query: { ...route.query, draft: res.draft.id } });
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
  storyBusy.value = true;
  try {
    const data = await api<{ story: any }>(`/api/story/preview?url=${encodeURIComponent(storyUrl.value)}`);
    story.value = data.story;
    if (!subject.value.trim()) {
      subject.value = data.story?.title || (data.story?.message || "").split("\n")[0] || "";
    }
    if (data.story?.kind && data.story.kind !== "link") mode.value = "story";
  } catch {
    story.value = { url: storyUrl.value, provider: "link", htmlUrl: storyUrl.value };
  } finally {
    storyBusy.value = false;
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
