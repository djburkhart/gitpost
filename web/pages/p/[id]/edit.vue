<template>
  <main class="page article" v-if="post">
    <p class="kicker">new commit · {{ post.shortSha }}</p>
    <h1 class="subject" style="font-size: var(--text-2xl); margin-top: 0">New commit on this object</h1>
    <p class="muted">This writes a new revision. The previous SHA stays addressable forever — nothing is rewritten.</p>
    <form @submit.prevent="submit">
      <div class="field">
        <label for="subject">
          Subject
          <span class="counter" :class="{ warn: subject.length > 50, bad: subject.length > 72 }">{{ subject.length }}/72</span>
        </label>
        <input id="subject" v-model="subject" class="subject-input" required />
      </div>
      <div class="field">
        <label>Body</label>
        <WysimarkEditor ref="editor" v-model="body" placeholder="Amend the body. Markdown is welcome." />
      </div>
      <TopicField v-model="topics" label="Remotes" placeholder="ai-safety, writing…" />
      <label class="check-row">
        <input v-model="signoff" type="checkbox" />
        <span>Signed-off-by {{ user?.name }} <{{ user?.email }}></span>
      </label>
      <p v-if="(post.coAuthors || []).length" class="subtle" style="margin-top: 0">
        Also attaching Co-authored-by for {{ post.coAuthors.join(", ") }}.
      </p>
      <div class="row">
        <button class="btn btn-primary" type="submit" :disabled="busy">Commit amendment</button>
        <NuxtLink :to="`/p/${post.id}`" class="btn btn-ghost">Back</NuxtLink>
      </div>
    </form>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const { user, ready, refresh } = useAuth();
const flash = useFlash();
const post = ref<any>(null);
const subject = ref("");
const body = ref("");
const topics = ref<string[]>([]);
const signoff = ref(true);
const busy = ref(false);
const editor = ref<{ getMarkdown: () => string } | null>(null);

onMounted(async () => {
  if (!ready.value) await refresh();
  const data = await api<{ post: any }>(`/api/posts/${route.params.id}`);
  post.value = data.post;
  subject.value = data.post.subject;
  body.value = data.post.body;
  topics.value = data.post.topics || [];
  if (!user.value || !data.post.canPush) {
    await navigateTo(`/p/${data.post.id}`);
  }
});

async function submit() {
  busy.value = true;
  try {
    const markdown = editor.value?.getMarkdown() ?? body.value;
    const data = await api<{ post: any }>(`/api/posts/${post.value.id}`, {
      method: "PUT",
      body: JSON.stringify({ subject: subject.value, body: markdown, storyUrl: post.value.storyUrl, topics: topics.value, signoff: signoff.value }),
    });
    await navigateTo(`/p/${data.post.id}`);
  } catch (e: any) {
    flash.error(e);
  } finally {
    busy.value = false;
  }
}
</script>
