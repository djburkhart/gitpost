<template>
  <main class="page article" v-if="post">
    <p class="kicker">amend · {{ post.shortSha }}</p>
    <h1 class="subject" style="font-size: var(--text-2xl); margin-top: 0">New commit on this object</h1>
    <form @submit.prevent="submit">
      <div class="field">
        <label for="subject">
          Subject
          <span class="counter" :class="{ warn: subject.length > 50, bad: subject.length > 72 }">{{ subject.length }}/72</span>
        </label>
        <input id="subject" v-model="subject" class="subject-input" required />
      </div>
      <div class="field">
        <label for="body">Body</label>
        <textarea id="body" v-model="body" />
      </div>
      <p v-if="error" style="color: var(--del)">{{ error }}</p>
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
const post = ref<any>(null);
const subject = ref("");
const body = ref("");
const error = ref("");
const busy = ref(false);

onMounted(async () => {
  if (!ready.value) await refresh();
  const data = await api<{ post: any }>(`/api/posts/${route.params.id}`);
  post.value = data.post;
  subject.value = data.post.subject;
  body.value = data.post.body;
  if (!user.value || user.value.handle !== data.post.owner) {
    await navigateTo(`/p/${data.post.id}`);
  }
});

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    const data = await api<{ post: any }>(`/api/posts/${post.value.id}`, {
      method: "PUT",
      body: JSON.stringify({ subject: subject.value, body: body.value, storyUrl: post.value.storyUrl }),
    });
    await navigateTo(`/p/${data.post.id}`);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
