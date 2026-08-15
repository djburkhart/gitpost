<template>
  <div class="blame">
    <article v-for="row in rows" :key="row.index" class="blame-para">
      <MarkdownBody :source="row.text" />
      <div class="blame-tip" role="note">
        <span class="sha">{{ row.shortSha }}</span>
        <span>{{ row.author }}</span>
        <time>{{ formatAgo(row.date) }}</time>
        <span class="subtle">{{ row.subject }}</span>
      </div>
    </article>
    <p v-if="!rows.length && !loading" class="empty">No paragraphs to blame.</p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ postId: string; fallback?: string }>();
const rows = ref<any[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const data = await api<{ blame: any[] }>(`/api/posts/${props.postId}/blame`);
    rows.value = data.blame || [];
  } catch {
    const paras = (props.fallback || "")
      .replace(/\r\n/g, "\n")
      .trim()
      .split(/\n\n+/)
      .filter(Boolean)
      .map((text, index) => ({ index, text, author: "", shortSha: "", date: "", subject: "" }));
    rows.value = paras;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.postId, load);
</script>
