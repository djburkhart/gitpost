<template>
  <div class="sheet-backdrop" role="presentation" @click.self="$emit('close')">
    <div class="sheet" role="dialog" aria-labelledby="fork-title">
      <p class="kicker">git fork --intent</p>
      <h2 id="fork-title" class="subject" style="font-size: var(--text-xl); margin: 0 0 8px">Take this idea somewhere</h2>
      <p class="muted" style="margin-top: 0">One click. The intent stays on the branch so the graph stays readable.</p>
      <label class="field" style="margin: 12px 0 16px">
        <span class="subtle" style="font-size: 0.8rem">Note (optional)</span>
        <input v-model="note" class="btn" style="width: 100%; text-align: left; margin-top: 6px" maxlength="280" placeholder="One line on the angle you’re taking" />
      </label>
      <div class="intent-grid">
        <button
          v-for="opt in intents"
          :key="opt.id"
          type="button"
          class="intent-card"
          :disabled="busy"
          @click="submit(opt.id)"
        >
          <strong>{{ opt.label }}</strong>
          <span>{{ opt.hint }}</span>
        </button>
      </div>
      <div class="actions" style="margin-top: 18px">
        <button class="btn btn-ghost" type="button" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FORK_INTENTS } from "~/utils/intents";

const props = defineProps<{ postId: string }>();
const emit = defineEmits<{ close: []; forked: [id: string] }>();
const intents = FORK_INTENTS;
const note = ref("");
const busy = ref(false);
const flash = useFlash();

async function submit(intent: string) {
  if (!intent || busy.value) return;
  busy.value = true;
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.postId}/fork`, {
      method: "POST",
      body: JSON.stringify({ intent, note: note.value }),
    });
    emit("forked", data.post.id);
  } catch (e: any) {
    flash.error(e);
    busy.value = false;
  }
}
</script>
