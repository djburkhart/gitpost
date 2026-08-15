<template>
  <div class="field">
    <label>{{ label }}</label>
    <div class="topic-field">
      <span v-for="t in model" :key="t" class="pill topic-pill">
        remote:{{ t }}
        <button type="button" class="topic-x" :aria-label="'Remove ' + t" @click="remove(t)">×</button>
      </span>
      <input
        v-model="draft"
        class="topic-input"
        :placeholder="placeholder"
        @keydown.enter.prevent="add"
        @keydown.comma.prevent="add"
      />
    </div>
    <p class="subtle" style="margin: 6px 0 0; font-size: 0.8rem">Hashtags in the body also become remotes.</p>
  </div>
</template>

<script setup lang="ts">
const model = defineModel<string[]>({ default: () => [] });
defineProps<{ label?: string; placeholder?: string }>();
const draft = ref("");

function slug(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/^remote:/, "")
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function add() {
  const t = slug(draft.value);
  draft.value = "";
  if (!t || t.length < 2) return;
  if (!model.value.includes(t)) model.value = [...model.value, t].slice(0, 8);
}

function remove(t: string) {
  model.value = model.value.filter((x) => x !== t);
}
</script>
