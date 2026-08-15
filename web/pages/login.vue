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
        <button class="btn btn-primary" type="submit" style="width: 100%">Open session</button>
      </form>
      <p class="muted" style="margin: 16px 0 0; font-size: 0.9rem">
        No account?
        <NuxtLink to="/join">Request access</NuxtLink>
      </p>
    </div>
  </main>
</template>

<script setup lang="ts">
const { login } = useAuth();
const handle = ref("");
const password = ref("");
const error = ref("");
const flash = useFlash();
const route = useRoute();

async function submit() {
  error.value = "";
  try {
    await login(handle.value, password.value);
    await navigateTo((route.query.next as string) || "/");
  } catch (e: any) {
    flash.error(e.message || "Could not sign in");
  }
}
</script>
