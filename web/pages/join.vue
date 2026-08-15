<template>
  <main class="page">
    <div class="auth-box card">
      <p class="kicker">init</p>
      <h1 class="subject" style="margin-top: 0">Create an identity</h1>
      <form @submit.prevent="submit">
        <div class="field">
          <label for="handle">Handle</label>
          <input id="handle" v-model="handle" required pattern="[A-Za-z0-9_-]{2,24}" placeholder="ada" />
        </div>
        <div class="field">
          <label for="name">Name</label>
          <input id="name" v-model="name" required />
        </div>
        <div class="field">
          <label for="pw">Password</label>
          <input id="pw" v-model="password" type="password" required minlength="3" />
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
const error = ref("");

async function submit() {
  error.value = "";
  try {
    await register({ handle: handle.value, name: name.value, password: password.value, bio: bio.value });
    await navigateTo("/");
  } catch (e: any) {
    error.value = e.message || "Could not register";
  }
}
</script>
