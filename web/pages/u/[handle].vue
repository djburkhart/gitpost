<template>
  <main class="page">
    <section class="hero" v-if="profile">
      <p class="kicker">@{{ profile.handle }}</p>
      <h1>{{ profile.name }}</h1>
      <p>{{ profile.bio || "No bio committed yet." }}</p>
      <button v-if="me" class="btn btn-sm" style="margin-top: 16px" type="button" @click="logoutThen">Sign out</button>
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
const loading = ref(true);
const me = computed(() => user.value && profile.value && user.value.handle === profile.value.handle);

async function load() {
  loading.value = true;
  try {
    const data = await api<{ user: any; posts: any[] }>(`/api/users/${route.params.handle}`);
    profile.value = data.user;
    posts.value = data.posts || [];
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
