<template>
  <aside v-if="story" class="story">
    <p class="kicker">
      {{ story.provider || "story" }}
      ·
      {{ story.kind || "object" }}
      <span v-if="story.state" class="pill">{{ story.state }}</span>
    </p>
    <h3>
      {{ story.repo }}
      <span v-if="story.number" class="sha">#{{ story.number }}</span>
      <span v-else-if="story.sha" class="sha">{{ String(story.sha).slice(0, 7) }}</span>
    </h3>
    <p class="muted" style="white-space: pre-wrap; margin: 0 0 12px">{{ heading }}</p>
    <p class="subtle" style="margin: 0 0 12px; font-size: 0.8rem; font-family: var(--font-mono)">
      <span v-if="story.author">{{ story.author }}</span>
      <span v-if="story.additions || story.deletions">
        · <span style="color: var(--add)">+{{ story.additions }}</span>
        /
        <span style="color: var(--del)">−{{ story.deletions }}</span>
      </span>
    </p>
    <ul v-if="story.files?.length" class="story-files">
      <li v-for="f in story.files" :key="f.filename">
        <span>{{ f.filename }}</span>
        <span class="subtle">
          <span style="color: var(--add)">+{{ f.additions }}</span>
          <span style="color: var(--del)">−{{ f.deletions }}</span>
        </span>
      </li>
    </ul>
    <DiffView v-if="story.snippet" :diff="story.snippet" />
    <p v-if="story.htmlUrl || story.url" style="margin: 12px 0 0">
      <a :href="story.htmlUrl || story.url" target="_blank" rel="noreferrer">Open on {{ story.provider || "the web" }}</a>
    </p>
  </aside>
</template>

<script setup lang="ts">
const props = defineProps<{ story: any }>();
const heading = computed(() => props.story?.title || (props.story?.message || "").split("\n")[0]);
</script>
