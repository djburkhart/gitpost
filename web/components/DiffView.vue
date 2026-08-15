<template>
  <div class="diff" role="region" aria-label="Diff">
    <div v-if="!lines.length" class="diff-line meta">No textual changes.</div>
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="diff-line"
      :class="line.kind"
    >
      <span>{{ line.mark }}</span>
      <span>{{ line.text || " " }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ diff: string }>();

const lines = computed(() => {
  if (!props.diff) return [];
  return props.diff.split("\n").map((raw) => {
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff") || raw.startsWith("index") || raw.startsWith("@@")) {
      return { kind: "meta", mark: " ", text: raw };
    }
    if (raw.startsWith("+")) return { kind: "add", mark: "+", text: raw.slice(1) };
    if (raw.startsWith("-")) return { kind: "del", mark: "−", text: raw.slice(1) };
    return { kind: "ctx", mark: " ", text: raw.startsWith(" ") ? raw.slice(1) : raw };
  });
});
</script>
