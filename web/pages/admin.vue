<template>
  <main class="page">
    <p class="kicker">control plane</p>
    <h1 class="subject" style="margin-top: 0">Admin</h1>
    <p v-if="!user" class="muted">Sign in as an administrator.</p>
    <p v-else-if="!user.isAdmin" class="muted">This console is reserved for administrators.</p>
    <template v-else>
      <div class="stat-grid" v-if="overview">
        <div class="card stat"><span class="kicker">users</span><strong>{{ overview.users }}</strong></div>
        <div class="card stat"><span class="kicker">admins</span><strong>{{ overview.admins }}</strong></div>
        <div class="card stat"><span class="kicker">sessions</span><strong>{{ overview.sessions }}</strong></div>
        <div class="card stat"><span class="kicker">invites</span><strong>{{ overview.invites }}</strong></div>
      </div>

      <div class="tabs" role="tablist">
        <button v-for="t in tabs" :key="t.id" :aria-selected="tab === t.id" @click="tab = t.id">{{ t.label }}</button>
      </div>
      <p v-if="notice" class="subtle">{{ notice }}</p>

      <section v-if="tab === 'users'">
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr><th>handle</th><th>role</th><th>status</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td>
                  <NuxtLink :to="`/u/${u.handle}`">@{{ u.handle }}</NuxtLink>
                  <div class="subtle">{{ u.name }}</div>
                </td>
                <td><span class="pill">{{ u.role }}</span></td>
                <td>
                  <span v-if="u.disabled" class="pill danger">disabled</span>
                  <span v-else class="pill">active</span>
                </td>
                <td class="row-actions">
                  <template v-if="!u.isSuperAdmin">
                    <button class="btn btn-sm" type="button" @click="toggleUser(u)">
                      {{ u.disabled ? "Enable" : "Disable" }}
                    </button>
                    <button
                      v-if="user.isSuperAdmin"
                      class="btn btn-sm"
                      type="button"
                      @click="setRole(u, u.role === 'admin' ? 'member' : 'admin')"
                    >
                      {{ u.role === "admin" ? "Demote" : "Make admin" }}
                    </button>
                    <button
                      v-if="user.isSuperAdmin"
                      class="btn btn-sm btn-danger"
                      type="button"
                      @click="removeUser(u)"
                    >
                      Remove
                    </button>
                  </template>
                  <span v-else class="subtle">protected</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="tab === 'invites'">
        <div class="row" style="margin-bottom: 16px">
          <button class="btn btn-primary btn-sm" type="button" @click="makeInvite">Mint invite</button>
        </div>
        <ul class="log-list">
          <li v-for="inv in invites" :key="inv.code" class="invite-row">
            <div>
              <code class="mono">{{ inv.code }}</code>
              <div class="log-meta">
                <span>by @{{ inv.createdBy }}</span>
                <span v-if="inv.usedBy">used by @{{ inv.usedBy }}</span>
                <span v-else>expires {{ formatFull(inv.expiresAt) }}</span>
              </div>
            </div>
            <button v-if="!inv.usedBy" class="btn btn-sm" type="button" @click="revokeInvite(inv.code)">Revoke</button>
          </li>
        </ul>
        <p v-if="!invites.length" class="empty">No invites yet.</p>
      </section>

      <section v-else-if="tab === 'sessions'">
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr><th>user</th><th>ip</th><th>created</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="s in sessions" :key="s.token">
                <td>@{{ s.handle }}</td>
                <td class="mono">{{ s.ip || "—" }}</td>
                <td class="subtle">{{ formatAgo(s.createdAt) }}</td>
                <td><button class="btn btn-sm" type="button" @click="kick(s.token)">Revoke</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="tab === 'audit'">
        <ol class="log-list">
          <li v-for="e in audit" :key="e.id" class="audit-row">
            <span class="sha">{{ e.action }}</span>
            <span>@{{ e.actor }}</span>
            <span class="muted">{{ e.target }}</span>
            <span class="subtle">{{ formatAgo(e.createdAt) }}</span>
          </li>
        </ol>
      </section>

      <section v-else-if="tab === 'settings'" class="card" style="max-width: 480px">
        <div class="field">
          <label for="mode">Signup mode</label>
          <select id="mode" v-model="settings.signupMode" class="field-select">
            <option value="invite">Invite only</option>
            <option value="open">Open registration</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div class="field">
          <label for="minpw">Minimum password length</label>
          <input id="minpw" v-model.number="settings.minPassword" type="number" min="12" max="64" />
        </div>
        <button class="btn btn-primary" type="button" @click="saveSettings">Save policy</button>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
const { user, ready, refresh } = useAuth();
const tab = ref("users");
const tabs = [
  { id: "users", label: "Users" },
  { id: "invites", label: "Invites" },
  { id: "sessions", label: "Sessions" },
  { id: "audit", label: "Audit" },
  { id: "settings", label: "Policy" },
];
const overview = ref<any>(null);
const users = ref<any[]>([]);
const invites = ref<any[]>([]);
const sessions = ref<any[]>([]);
const audit = ref<any[]>([]);
const settings = ref({ signupMode: "invite", minPassword: 12 });
const error = ref("");
const flash = useFlash();
const notice = ref("");

onMounted(async () => {
  if (!ready.value) await refresh();
  if (!user.value?.isAdmin) return;
  await load();
});

async function load() {
  error.value = "";
  try {
    const [ov, us, inv, sess, ev, st] = await Promise.all([
      api<any>("/api/admin/overview"),
      api<any>("/api/admin/users"),
      api<any>("/api/admin/invites"),
      api<any>("/api/admin/sessions"),
      api<any>("/api/admin/audit"),
      api<any>("/api/admin/settings"),
    ]);
    overview.value = ov;
    users.value = us.users || [];
    invites.value = inv.invites || [];
    sessions.value = sess.sessions || [];
    audit.value = ev.events || [];
    settings.value = st.settings || settings.value;
  } catch (e: any) {
    flash.error(e);
  }
}

async function toggleUser(u: any) {
  const path = u.disabled ? "enable" : "disable";
  await api(`/api/admin/users/${u.handle}/${path}`, { method: "POST" });
  notice.value = `${u.handle} ${path}d`;
  await load();
}

async function setRole(u: any, role: string) {
  await api(`/api/admin/users/${u.handle}/role`, { method: "POST", body: JSON.stringify({ role }) });
  notice.value = `${u.handle} is now ${role}`;
  await load();
}

async function removeUser(u: any) {
  if (!confirm(`Remove @${u.handle}? This cannot be undone.`)) return;
  await api(`/api/admin/users/${u.handle}`, { method: "DELETE" });
  notice.value = `removed @${u.handle}`;
  await load();
}

async function makeInvite() {
  const data = await api<any>("/api/admin/invites", { method: "POST", body: JSON.stringify({ days: 14 }) });
  notice.value = `Invite ${data.invite.code}`;
  await load();
}

async function revokeInvite(code: string) {
  await api(`/api/admin/invites/${code}`, { method: "DELETE" });
  await load();
}

async function kick(token: string) {
  await api(`/api/admin/sessions/${encodeURIComponent(token)}`, { method: "DELETE" });
  await load();
}

async function saveSettings() {
  await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings.value) });
  notice.value = "Policy saved";
  await load();
}
</script>
