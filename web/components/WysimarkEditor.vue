<template>
  <div class="wysimark-shell">
    <div ref="host" class="wysimark-host" />
  </div>
</template>

<script setup lang="ts">
import type { Wysimark } from "@wysimark/standalone";

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const host = ref<HTMLElement | null>(null);
let editor: Wysimark | null = null;

onMounted(async () => {
  const { createWysimark } = await import("@wysimark/standalone");
  if (!host.value) return;
  editor = createWysimark(host.value, {
    initialMarkdown: props.modelValue || "",
    placeholder: props.placeholder || "Why this exists. Markdown is welcome.",
    minHeight: 280,
    maxHeight: 640,
    throttleInMs: 120,
    onChange: (markdown) => emit("update:modelValue", markdown),
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor) return;
    const next = value || "";
    if (next !== editor.getMarkdown()) editor.setMarkdown(next);
  },
);

onBeforeUnmount(() => {
  editor?.unmount();
  editor = null;
});

function getMarkdown() {
  return editor?.getMarkdown() ?? props.modelValue ?? "";
}

defineExpose({ getMarkdown });
</script>
