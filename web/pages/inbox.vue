<template>
  <main class="page article">
    <p class="kicker">inbox</p>
    <h1 class="subject" style="margin-top: 0">Derived from you</h1>
    <p class="muted">Forks and cherry-picks that carry your attribution. Credit is structural.</p>
    <div class="row" style="margin-bottom: 16px">
      <button v-if="unread" class="btn btn-sm" type="button" @click="markAll">Mark all read</button>
    </div>
    <ul class="log-list">
      <li v-for="n in notices" :key="n.id" class="invite-row" :class="{ unread: !n.read }">
        <div>
          <div>
            <template v-if="n.kind === 'release'">
              {{ n.subject }} shipped —
              <NuxtLink to="/changelog">write the changelog</NuxtLink>
            </template>
            <template v-else>
              <NuxtLink :to="`/u/${n.actor}`">@{{ n.actor }}</NuxtLink>
              {{ n.kind === "fork" ? "forked" : "cherry-picked" }}
              <NuxtLink v-if="n.sourcePostId" :to="`/p/${n.sourcePostId}`">your object</NuxtLink>
              into
              <NuxtLink :to="`/p/${n.postId}`">{{ n.subject || n.postId.slice(0, 8) }}</NuxtLink>
            </template>
          </div>
          <div class="log-meta">
            <time>{{ formatAgo(n.createdAt) }}</time>
            <span class="pill">{{ n.kind }}</span>
          </div>
        </div>
        <button v-if="!n.read" class="btn btn-sm" type="button" @click="mark([n.id])">Read</button>
      </li>
    </ul>
    <p v-if="!notices.length" class="empty">Nothing derived from you yet.</p>
  </main>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const notices = ref<any[]>([]);
const unread = ref(0);

onMounted(async () => {
  if (!ready.value) await refresh();
  if (!user.value) return navigateTo("/login?next=/inbox");
  await load();
});

async function load() {
  const data = await api<{ notices: any[]; unread: number }>("/api/inbox");
  notices.value = data.notices || [];
  unread.value = data.unread || 0;
}

async function mark(ids: string[]) {
  const data = await api<{ notices: any[]; unread: number }>("/api/inbox/read", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  notices.value = data.notices || [];
  unread.value = data.unread || 0;
}

async function markAll() {
  const data = await api<{ notices: any[]; unread: number }>("/api/inbox/read", {
    method: "POST",
    body: JSON.stringify({ all: true }),
  });
  notices.value = data.notices || [];
  unread.value = data.unread || 0;
}
</script>
