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
let observer: MutationObserver | null = null;

function tagPortals() {
  for (const el of document.body.querySelectorAll<HTMLElement>(":scope > div")) {
    const style = getComputedStyle(el);
    const z = Number(style.zIndex);
    if (style.position === "fixed" && style.whiteSpace === "nowrap" && (style.zIndex === "10" || z === 10)) {
      el.classList.add("wysimark-tip");
      continue;
    }
    if ((style.position === "fixed" || style.position === "absolute") && z >= 10) {
      el.classList.add("wysimark-layer");
      el.querySelectorAll<HTMLElement>("*").forEach((child) => {
        const bg = getComputedStyle(child).backgroundColor;
        if (bg === "rgb(255, 255, 255)" || bg === "rgb(250, 250, 250)") {
          child.classList.add("wysimark-paper");
        }
      });
    }
  }
}

onMounted(async () => {
  document.documentElement.classList.add("wysimark-on");
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
  observer = new MutationObserver(() => tagPortals());
  observer.observe(document.body, { childList: true, subtree: true });
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
  observer?.disconnect();
  observer = null;
  editor?.unmount();
  editor = null;
  if (!document.querySelector(".wysimark-shell")) {
    document.documentElement.classList.remove("wysimark-on");
  }
});

function getMarkdown() {
  return editor?.getMarkdown() ?? props.modelValue ?? "";
}

defineExpose({ getMarkdown });
</script>
