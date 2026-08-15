<template>
  <aside v-if="story" class="story">
    <p class="kicker">{{ story.provider || "story" }} object</p>
    <h3>{{ story.repo }} <span v-if="story.sha" class="sha">{{ story.sha.slice(0, 7) }}</span></h3>
    <p class="muted" style="white-space: pre-wrap; margin: 0 0 12px">{{ firstLine }}</p>
    <p class="subtle" style="margin: 0 0 12px; font-size: 0.8rem; font-family: var(--font-mono)">
      <span v-if="story.author">{{ story.author }}</span>
      <span v-if="story.additions || story.deletions">
        · <span style="color: var(--add)">+{{ story.additions }}</span>
        /
        <span style="color: var(--del)">−{{ story.deletions }}</span>
      </span>
    </p>
    <DiffView v-if="story.snippet" :diff="story.snippet" />
    <p v-if="story.htmlUrl || story.url" style="margin: 12px 0 0">
      <a :href="story.htmlUrl || story.url" target="_blank" rel="noreferrer">Open original</a>
    </p>
  </aside>
</template>

<script setup lang="ts">
const props = defineProps<{ story: any }>();
const firstLine = computed(() => (props.story?.message || "").split("\n")[0]);
</script>
