<template>
  <header class="site-header">
    <div class="inner">
      <NuxtLink to="/" class="brand">gitpo<em>.st</em></NuxtLink>
      <nav class="nav" aria-label="Primary">
        <NuxtLink to="/">log</NuxtLink>
        <NuxtLink to="/explore">explore</NuxtLink>
        <NuxtLink to="/pulls">pulls</NuxtLink>
        <NuxtLink v-if="user" to="/drafts">drafts</NuxtLink>
        <NuxtLink v-if="user" to="/changelog">ship</NuxtLink>
        <NuxtLink v-if="user?.isAdmin" to="/admin">admin</NuxtLink>
      </nav>
      <div class="header-actions">
        <NuxtLink v-if="user" to="/compose?mode=story" class="btn btn-sm">Story</NuxtLink>
        <NuxtLink v-if="user" to="/compose" class="btn btn-primary btn-sm">Commit</NuxtLink>
        <NuxtLink v-else to="/login" class="btn btn-primary btn-sm">Sign in</NuxtLink>
        <NuxtLink v-if="user" to="/inbox" class="btn btn-ghost btn-sm inbox-link">
          inbox
          <span v-if="unread" class="inbox-count">{{ unread }}</span>
        </NuxtLink>
        <NuxtLink v-if="user" to="/settings" class="btn btn-ghost btn-sm">security</NuxtLink>
        <NuxtLink v-if="user" :to="`/u/${user.handle}`" class="btn btn-ghost btn-sm">@{{ user.handle }}</NuxtLink>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const unread = ref(0);

async function loadUnread() {
  if (!user.value) {
    unread.value = 0;
    return;
  }
  try {
    const data = await api<{ unread?: number }>("/api/auth/me");
    unread.value = data.unread || 0;
  } catch {
    unread.value = 0;
  }
}

onMounted(async () => {
  if (!ready.value) await refresh();
  await loadUnread();
});
watch(() => user.value?.handle, loadUnread);
</script>
