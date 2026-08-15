<template>
  <div class="md" v-html="html" />
</template>

<script setup lang="ts">
import { marked } from "marked";

const props = defineProps<{ source: string }>();

function sanitize(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/javascript:/gi, "");
}

const html = computed(() => {
  const raw = marked.parse(props.source || "", { async: false, gfm: true, breaks: true }) as string;
  return sanitize(raw);
});
</script>
