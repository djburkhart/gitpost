<template>
  <div class="sheet-backdrop" role="presentation" @click.self="$emit('close')">
    <div class="sheet" role="dialog" aria-labelledby="cp-title">
      <p class="kicker">git cherry-pick --excerpt</p>
      <h2 id="cp-title" class="subject" style="font-size: var(--text-xl); margin: 0 0 8px">Lift this into your tree</h2>
      <p class="muted" style="margin-top: 0">Attribution is baked in — @{{ sourceOwner }} `{{ sourceSha }}`.</p>
      <blockquote class="excerpt-preview">{{ excerpt }}</blockquote>
      <div class="field">
        <label>Destination</label>
        <select v-model="destId" class="btn" style="width: 100%; text-align: left">
          <option value="">New object</option>
          <option v-for="p in mine" :key="p.id" :value="p.id">{{ p.subject }} · {{ p.shortSha }}</option>
        </select>
      </div>
      <div class="actions" style="margin-top: 18px">
        <button class="btn btn-primary" type="button" :disabled="busy" @click="commit">Commit cherry-pick</button>
        <button class="btn btn-ghost" type="button" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  sourceId: string;
  sourceOwner: string;
  sourceSha: string;
  excerpt: string;
}>();
const emit = defineEmits<{ close: []; picked: [id: string] }>();
const destId = ref("");
const mine = ref<any[]>([]);
const busy = ref(false);
const flash = useFlash();
const { user } = useAuth();

onMounted(async () => {
  if (!user.value) return;
  try {
    const data = await api<{ posts: any[] }>(`/api/users/${user.value.handle}`);
    mine.value = (data.posts || []).filter((p) => p.id !== props.sourceId);
  } catch {
    mine.value = [];
  }
});

async function commit() {
  busy.value = true;
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.sourceId}/excerpt`, {
      method: "POST",
      body: JSON.stringify({ destId: destId.value, excerpt: props.excerpt }),
    });
    emit("picked", data.post.id);
  } catch (e: any) {
    flash.error(e);
  } finally {
    busy.value = false;
  }
}
</script>
