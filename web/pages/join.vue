<template>
  <main class="page">
    <div class="auth-box card">
      <p class="kicker">init</p>
      <h1 class="subject" style="margin-top: 0">Create an identity</h1>
      <p v-if="config.signupMode === 'closed'" class="muted">
        Registration is closed. Ask an administrator for access.
      </p>
      <form v-else @submit.prevent="submit">
        <div class="field" v-if="config.signupMode === 'invite'">
          <label for="invite">Invite code</label>
          <input id="invite" v-model="invite" required autocomplete="off" spellcheck="false" />
        </div>
        <div class="field">
          <label for="handle">Handle</label>
          <input id="handle" v-model="handle" required pattern="[A-Za-z0-9_-]{2,24}" placeholder="your-handle" />
        </div>
        <div class="field">
          <label for="name">Name</label>
          <input id="name" v-model="name" required />
        </div>
        <div class="field">
          <label for="pw">Password</label>
          <input id="pw" v-model="password" type="password" required :minlength="config.minPassword || 12" />
          <span class="counter">At least {{ config.minPassword || 12 }} characters, with a letter and a number.</span>
        </div>
        <div class="field">
          <label for="bio">Bio</label>
          <input id="bio" v-model="bio" />
        </div>
        <p v-if="error" style="color: var(--del)">{{ error }}</p>
        <button class="btn btn-primary" type="submit" style="width: 100%">Commit identity</button>
      </form>
      <p class="muted" style="margin-top: 16px; font-size: 0.9rem">
        Already have one? <NuxtLink to="/login">Sign in</NuxtLink>
      </p>
    </div>
  </main>
</template>

<script setup lang="ts">
const { register } = useAuth();
const handle = ref("");
const name = ref("");
const password = ref("");
const bio = ref("");
const invite = ref("");
const error = ref("");
const config = ref({ signupMode: "invite", minPassword: 12 });

onMounted(async () => {
  try {
    config.value = await api("/api/auth/config");
  } catch {
    /* keep defaults */
  }
  const q = useRoute().query.invite;
  if (typeof q === "string") invite.value = q;
});

async function submit() {
  error.value = "";
  try {
    await register({
      handle: handle.value,
      name: name.value,
      password: password.value,
      bio: bio.value,
      invite: invite.value,
    });
    await navigateTo("/");
  } catch (e: any) {
    error.value = e.message || "Could not register";
  }
}
</script>
