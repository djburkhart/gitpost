<template>
  <main class="page">
    <div class="auth-box card">
      <p class="kicker">session</p>
      <h1 class="subject" style="margin-top: 0">Sign in</h1>
      <form @submit.prevent="submit">
        <div class="field">
          <label for="handle">Handle</label>
          <input id="handle" v-model="handle" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="pw">Password</label>
          <input id="pw" v-model="password" type="password" autocomplete="current-password" required />
        </div>
        <p v-if="error" class="subtle" style="color: var(--del)">{{ error }}</p>
        <button class="btn btn-primary" type="submit" style="width: 100%">Open session</button>
      </form>
      <p class="muted" style="margin: 16px 0 0; font-size: 0.9rem">
        No account?
        <NuxtLink to="/join">Create one</NuxtLink>
      </p>
      <p class="kicker" style="margin-top: 24px">Demo identities</p>
      <div class="demo-accounts">
        <button v-for="d in demos" :key="d.handle" class="btn" type="button" @click="quick(d.handle)">
          <span>{{ d.name }}</span>
          <span class="sha">@{{ d.handle }}</span>
        </button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
const { login } = useAuth();
const handle = ref("");
const password = ref("demo");
const error = ref("");
const route = useRoute();
const demos = [
  { handle: "ada", name: "Ada Lovelace" },
  { handle: "linus", name: "Linus T." },
  { handle: "maya", name: "Maya Chen" },
  { handle: "guest", name: "Guest" },
];

async function submit() {
  error.value = "";
  try {
    await login(handle.value, password.value);
    await navigateTo((route.query.next as string) || "/");
  } catch (e: any) {
    error.value = e.message || "Could not sign in";
  }
}

async function quick(h: string) {
  handle.value = h;
  password.value = "demo";
  await submit();
}
</script>
