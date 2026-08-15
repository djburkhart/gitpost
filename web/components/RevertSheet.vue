<template>
  <div class="sheet-backdrop" role="presentation" @click.self="$emit('close')">
    <div class="sheet" role="dialog" aria-labelledby="revert-title">
      <p class="kicker">git revert</p>
      <h2 id="revert-title" class="subject" style="font-size: var(--text-xl); margin: 0 0 8px">Revert with a reason</h2>
      <p class="muted" style="margin-top: 0">
        This writes a new commit that undoes <span class="sha">{{ sha.slice(0, 7) }}</span>.
        The bad edit stays in the log — the record stays honest.
      </p>
      <label class="field">
        <span class="subtle" style="font-size: 0.8rem">Why are you reverting this?</span>
        <textarea v-model="reason" class="para-edit" rows="5" maxlength="2000" placeholder="This claim was wrong because…" />
      </label>
      <label class="check-row">
        <input v-model="signoff" type="checkbox" />
        <span>Signed-off-by on the revert</span>
      </label>
      <div class="actions" style="margin-top: 8px">
        <button class="btn btn-primary" type="button" :disabled="!reason.trim() || busy" @click="submit">Revert</button>
        <button class="btn btn-ghost" type="button" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ postId: string; sha: string }>();
const emit = defineEmits<{ close: []; reverted: [] }>();
const reason = ref("");
const signoff = ref(true);
const busy = ref(false);
const flash = useFlash();

async function submit() {
  if (!reason.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await api(`/api/posts/${props.postId}/revert`, {
      method: "POST",
      body: JSON.stringify({ sha: props.sha, reason: reason.value, signoff: signoff.value }),
    });
    flash.ok("Reverted — the old commit is still addressable");
    emit("reverted");
  } catch (e: any) {
    flash.error(e);
    busy.value = false;
  }
}
</script>
