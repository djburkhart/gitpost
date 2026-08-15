<template>
  <main class="page article">
    <p class="kicker">git commit</p>
    <h1 class="subject" style="font-size: var(--text-2xl); margin-top: 0">New object</h1>
    <form @submit.prevent="submit">
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
          required
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
      <div class="row">
        <button class="btn btn-primary" type="submit" :disabled="busy">Commit</button>
        <NuxtLink to="/" class="btn btn-ghost">Cancel</NuxtLink>
      </div>
    </form>
  </main>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const flash = useFlash();
const subject = ref("");
const body = ref("");
const storyUrl = ref("");
const story = ref<any>(null);
const topics = ref<string[]>([]);
const busy = ref(false);
const editor = ref<{ getMarkdown: () => string } | null>(null);

onMounted(async () => {
  if (!ready.value) await refresh();
  if (!user.value) {
    await navigateTo("/login?next=/compose");
  }
});

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

async function submit() {
  busy.value = true;
  try {
    const markdown = editor.value?.getMarkdown() ?? body.value;
    const data = await api<{ post: any }>("/api/posts", {
      method: "POST",
      body: JSON.stringify({ subject: subject.value, body: markdown, storyUrl: storyUrl.value, topics: topics.value }),
    });
    await navigateTo(`/p/${data.post.id}`);
  } catch (e: any) {
    flash.error(e.message || "Commit failed");
  } finally {
    busy.value = false;
  }
}
</script>
