<template>
  <main class="page article">
    <p class="kicker">account</p>
    <h1 class="subject" style="margin-top: 0">Security</h1>
    <p v-if="!user" class="muted">Sign in to manage sessions and your password.</p>
    <template v-else>
      <section class="card" style="margin-bottom: 24px">
        <p class="kicker">identity</p>
        <p style="margin: 0 0 8px"><strong>@{{ user.handle }}</strong> · {{ user.role || "member" }}</p>
        <p class="muted" style="margin: 0">Change this password after first login. Sessions other than this one can be revoked below.</p>
      </section>

      <section class="card" style="margin-bottom: 24px; max-width: 480px">
        <p class="kicker">password</p>
        <form @submit.prevent="changePw">
          <div class="field">
            <label for="cur">Current</label>
            <input id="cur" v-model="current" type="password" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="nxt">New password</label>
            <input id="nxt" v-model="next" type="password" autocomplete="new-password" required minlength="12" />
            <span class="counter">At least 12 characters, with a letter and a number.</span>
          </div>
          <p v-if="pwError" style="color: var(--del)">{{ pwError }}</p>
          <p v-if="pwOk" class="subtle">Password updated. Other sessions were signed out.</p>
          <button class="btn btn-primary" type="submit">Update password</button>
        </form>
      </section>

      <section>
        <div class="row" style="margin-bottom: 12px">
          <p class="kicker" style="margin: 0">active sessions</p>
          <button class="btn btn-sm" type="button" @click="revokeAll">Sign out other devices</button>
        </div>
        <ul class="log-list">
          <li v-for="s in sessions" :key="s.token" class="invite-row">
            <div>
              <div>{{ s.current ? "This device" : s.userAgent || "Session" }}</div>
              <div class="log-meta">
                <span>{{ s.ip || "ip unknown" }}</span>
                <span>{{ formatAgo(s.createdAt) }}</span>
              </div>
            </div>
            <button v-if="!s.current" class="btn btn-sm" type="button" @click="revoke(s.token)">Revoke</button>
            <span v-else class="pill">current</span>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const current = ref("");
const next = ref("");
const pwError = ref("");
const pwOk = ref(false);
const sessions = ref<any[]>([]);

onMounted(async () => {
  if (!ready.value) await refresh();
  if (user.value) await loadSessions();
});

async function loadSessions() {
  const data = await api<{ sessions: any[] }>("/api/security/sessions");
  sessions.value = data.sessions || [];
}

async function changePw() {
  pwError.value = "";
  pwOk.value = false;
  try {
    await api("/api/security/password", {
      method: "POST",
      body: JSON.stringify({ current: current.value, next: next.value }),
    });
    current.value = "";
    next.value = "";
    pwOk.value = true;
    await refresh();
    await loadSessions();
  } catch (e: any) {
    pwError.value = e.message || "Could not update password";
  }
}

async function revoke(token: string) {
  await api(`/api/security/sessions/${encodeURIComponent(token)}`, { method: "DELETE" });
  await loadSessions();
}

async function revokeAll() {
  await api("/api/security/sessions/revoke-all", { method: "POST" });
  await loadSessions();
}
</script>
