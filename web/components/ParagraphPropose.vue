<template>
  <div class="sheet-backdrop" role="presentation" @click.self="$emit('close')">
    <div class="sheet sheet-wide" role="dialog" aria-labelledby="para-title">
      <p class="kicker">paragraph pull request</p>
      <h2 id="para-title" class="subject" style="font-size: var(--text-xl); margin: 0 0 8px">Propose a change</h2>
      <p class="muted" style="margin-top: 0">Rewrite this paragraph and say why you disagree. The author can accept, reject, or reply.</p>
      <div class="para-compare">
        <div>
          <p class="kicker">current</p>
          <div class="para-box">{{ original }}</div>
        </div>
        <div>
          <p class="kicker">your take</p>
          <textarea v-model="proposed" class="para-edit" rows="7" placeholder="Write the paragraph as you think it should read." />
        </div>
      </div>
      <label class="field" style="margin-top: 16px">
        <span class="subtle" style="font-size: 0.8rem">Why you disagree</span>
        <textarea v-model="rationale" class="para-edit" rows="4" placeholder="Be specific. This becomes the PR rationale." />
      </label>
      <div class="actions" style="margin-top: 18px">
        <button class="btn btn-primary" type="button" :disabled="!canSubmit || busy" @click="submit">Open pull request</button>
        <button class="btn btn-ghost" type="button" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  postId: string;
  index: number;
  original: string;
}>();
const emit = defineEmits<{ close: []; opened: [id: string] }>();
const proposed = ref(props.original);
const rationale = ref("");
const busy = ref(false);
const flash = useFlash();
const canSubmit = computed(
  () => proposed.value.trim() && proposed.value.trim() !== props.original.trim() && rationale.value.trim().length >= 8,
);

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  try {
    const data = await api<{ pr: any }>("/api/prs", {
      method: "POST",
      body: JSON.stringify({
        kind: "paragraph",
        targetId: props.postId,
        paragraphIndex: props.index,
        original: props.original,
        proposed: proposed.value.trim(),
        rationale: rationale.value.trim(),
        title: `Paragraph ${props.index + 1}`,
      }),
    });
    emit("opened", data.pr.id);
  } catch (e: any) {
    flash.error(e);
  } finally {
    busy.value = false;
  }
}
</script>
