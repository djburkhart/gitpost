<template>
  <main class="page">
    <section class="hero" v-if="profile">
      <p class="kicker">@{{ profile.handle }}</p>
      <h1>{{ profile.name }}</h1>
      <p>{{ profile.bio || "No bio committed yet." }}</p>
      <div v-if="score" class="score-row">
        <div class="score-card">
          <span class="score-num">{{ score.score }}</span>
          <span class="subtle">maintainer score</span>
        </div>
        <p class="muted" style="margin: 0; max-width: 36ch">
          Reviews {{ score.reviews }} · merges accepted {{ score.mergesAccepted }} ·
          taken {{ score.taken }} · quality main {{ score.qualityMain }} ·
          stars on maintained objects {{ score.starsMaintained }}. Volume of posts does not count.
        </p>
      </div>
      <button v-if="me" class="btn btn-sm" style="margin-top: 16px" type="button" @click="logoutThen">Sign out</button>
    </section>
    <ContributionGraph v-if="graph" :graph="graph" />
    <section v-if="derived.length" class="derived-block">
      <p class="kicker">upstream · ideas taken from this log</p>
      <ul class="log-list">
        <li v-for="d in derived" :key="d.id + d.kind" class="invite-row">
          <div>
            <span class="pill">{{ d.kind }}</span>
            <NuxtLink :to="`/u/${d.owner}`">@{{ d.owner }}</NuxtLink>
            →
            <NuxtLink :to="`/p/${d.id}`">{{ d.subject }}</NuxtLink>
          </div>
        </li>
      </ul>
    </section>
    <ol class="log-list">
      <PostRow v-for="p in posts" :key="p.id" :post="p" />
    </ol>
    <p v-if="!loading && !posts.length" class="empty">No objects in this log.</p>
  </main>
</template>

<script setup lang="ts">
const route = useRoute();
const { user, logout } = useAuth();
const profile = ref<any>(null);
const posts = ref<any[]>([]);
const graph = ref<any>(null);
const score = ref<any>(null);
const derived = ref<any[]>([]);
const loading = ref(true);
const me = computed(() => user.value && profile.value && user.value.handle === profile.value.handle);

async function load() {
  loading.value = true;
  try {
    const data = await api<{ user: any; posts: any[]; graph?: any; score?: any; derived?: any[] }>(
      `/api/users/${route.params.handle}`,
    );
    profile.value = data.user;
    posts.value = data.posts || [];
    graph.value = data.graph || null;
    score.value = data.score || null;
    derived.value = data.derived || [];
  } finally {
    loading.value = false;
  }
}

async function logoutThen() {
  await logout();
  await navigateTo("/");
}

onMounted(load);
watch(() => route.params.handle, load);
</script>
