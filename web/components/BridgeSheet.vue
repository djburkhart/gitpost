<template>
  <div class="sheet-backdrop" role="presentation" @click.self="$emit('close')">
    <div class="sheet" role="dialog" aria-labelledby="bridge-title">
      <p class="kicker">idea ↔ code</p>
      <h2 id="bridge-title" class="subject" style="font-size: var(--text-xl); margin: 0 0 8px">Link a repo object</h2>
      <p class="muted">Paste a GitHub or GitLab issue, pull request, or commit. The writing stays here; the work continues there.</p>
      <label class="field">
        <span class="subtle" style="font-size: 0.8rem">URL</span>
        <input v-model="url" class="subject-input" placeholder="https://github.com/org/repo/issues/12" @change="preview" />
      </label>
      <StoryEmbed v-if="story" :story="story" />
      <div class="actions" style="margin-top: 12px">
        <button class="btn btn-primary" type="button" :disabled="!url.trim() || busy" @click="submit">Link</button>
        <button class="btn btn-ghost" type="button" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ postId: string }>();
const emit = defineEmits<{ close: []; linked: [] }>();
const url = ref("");
const story = ref<any>(null);
const busy = ref(false);
const flash = useFlash();

async function preview() {
  if (!url.value.trim()) {
    story.value = null;
    return;
  }
  try {
    const data = await api<{ story: any }>(`/api/story/preview?url=${encodeURIComponent(url.value)}`);
    story.value = data.story;
  } catch {
    story.value = { url: url.value, provider: "link", htmlUrl: url.value };
  }
}

async function submit() {
  if (!url.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await api(`/api/posts/${props.postId}/bridges`, {
      method: "POST",
      body: JSON.stringify({ url: url.value, direction: "writing-to-code" }),
    });
    flash.ok("Linked to the repo object");
    emit("linked");
  } catch (e: any) {
    flash.error(e);
    busy.value = false;
  }
}
</script>
