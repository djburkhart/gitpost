<template>
  <li class="log-item">
    <div class="log-meta">
      <NuxtLink :to="`/u/${post.owner}`">{{ post.owner }}</NuxtLink>
      <span>committed</span>
      <time :datetime="post.updatedAt" :title="formatFull(post.updatedAt)">{{ formatAgo(post.updatedAt) }}</time>
      <NuxtLink :to="`/p/${post.id}`" class="sha">{{ post.shortSha }}</NuxtLink>
      <span v-if="post.parentPostId" class="pill">fork</span>
      <span v-if="post.storyUrl" class="pill">story</span>
    </div>
    <h2 class="subject">
      <NuxtLink :to="`/p/${post.id}`">{{ post.subject }}</NuxtLink>
    </h2>
    <div class="log-stats">
      <span>{{ post.starCount }} {{ post.starCount === 1 ? "star" : "stars" }}</span>
      <span>{{ post.forkCount }} {{ post.forkCount === 1 ? "fork" : "forks" }}</span>
      <span>{{ post.commitCount }} {{ post.commitCount === 1 ? "commit" : "commits" }}</span>
    </div>
  </li>
</template>

<script setup lang="ts">
defineProps<{ post: any }>();
</script>
