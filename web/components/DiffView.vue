<template>
  <div class="diff" role="region" aria-label="Diff">
    <div v-if="!lines.length" class="diff-empty">
      <p class="kicker">git diff</p>
      <p>{{ emptyLabel }}</p>
    </div>
    <template v-else>
      <div class="diff-file">POST.md</div>
      <div
        v-for="(line, i) in lines"
        :key="i"
        class="diff-line"
        :class="line.kind"
      >
        <span class="diff-mark">{{ line.mark }}</span>
        <span class="diff-text">{{ line.text || " " }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  diff: string;
  emptyLabel?: string;
}>();

const emptyLabel = computed(
  () => props.emptyLabel || "No textual changes between these revisions.",
);

const lines = computed(() => {
  if (!props.diff?.trim()) return [];
  return props.diff.split("\n").filter((raw) => raw.length > 0).map((raw) => {
    if (
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("diff") ||
      raw.startsWith("index") ||
      raw.startsWith("@@")
    ) {
      return { kind: "meta", mark: " ", text: raw };
    }
    if (raw.startsWith("+")) return { kind: "add", mark: "+", text: raw.slice(1) };
    if (raw.startsWith("-")) return { kind: "del", mark: "−", text: raw.slice(1) };
    return { kind: "ctx", mark: " ", text: raw.startsWith(" ") ? raw.slice(1) : raw };
  });
});
</script>
