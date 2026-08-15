<template>
  <section class="discuss">
    <p class="muted" style="margin-top: 0">
      Comments stay off the main line. The owner can promote a thread into a formal branch.
    </p>
    <form v-if="user" class="comment-form" @submit.prevent="send()">
      <textarea v-model="draft" rows="3" class="para-edit" placeholder="Add to the discussion…" />
      <button class="btn btn-sm btn-primary" type="submit" :disabled="!draft.trim()">Comment</button>
    </form>
    <p v-else class="empty">Sign in to join the discussion.</p>
    <article v-for="c in roots" :key="c.id" class="thread">
      <div class="comment" :class="{ branched: !!c.branch }">
        <div class="log-meta">
          <NuxtLink :to="`/u/${c.author}`">{{ c.author }}</NuxtLink>
          <time>{{ formatAgo(c.createdAt) }}</time>
          <span v-if="c.branch" class="pill">{{ c.branch }}</span>
        </div>
        <MarkdownBody :source="c.body" />
        <div class="actions" style="margin-top: 8px">
          <button v-if="user" class="btn btn-ghost btn-sm" type="button" @click="replyTo = replyTo === c.id ? '' : c.id">Reply</button>
          <button v-if="mine && !c.branch" class="btn btn-sm" type="button" @click="branch(c.id)">Branch this thread</button>
        </div>
        <form v-if="replyTo === c.id" class="comment-form" @submit.prevent="send(c.id)">
          <textarea v-model="reply" rows="2" class="para-edit" placeholder="Reply in this thread…" />
          <button class="btn btn-sm" type="submit" :disabled="!reply.trim()">Reply</button>
        </form>
      </div>
      <div v-for="r in children(c.id)" :key="r.id" class="comment reply" :class="{ branched: !!r.branch }">
        <div class="log-meta">
          <NuxtLink :to="`/u/${r.author}`">{{ r.author }}</NuxtLink>
          <time>{{ formatAgo(r.createdAt) }}</time>
        </div>
        <MarkdownBody :source="r.body" />
      </div>
    </article>
    <p v-if="!comments.length" class="empty">No discussion yet.</p>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{ postId: string; mine: boolean }>();
const { user } = useAuth();
const flash = useFlash();
const comments = ref<any[]>([]);
const draft = ref("");
const reply = ref("");
const replyTo = ref("");

const roots = computed(() => comments.value.filter((c) => !c.parentId));
function children(id: string) {
  return comments.value.filter((c) => c.parentId === id);
}

async function load() {
  const data = await api<{ comments: any[] }>(`/api/posts/${props.postId}/comments`);
  comments.value = data.comments || [];
}

async function send(parentId = "") {
  const body = parentId ? reply.value : draft.value;
  try {
    await api(`/api/posts/${props.postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, parentId }),
    });
    if (parentId) {
      reply.value = "";
      replyTo.value = "";
    } else {
      draft.value = "";
    }
    await load();
  } catch (e: any) {
    flash.error(e);
  }
}

async function branch(id: string) {
  try {
    const data = await api<{ branch: { name: string } }>(`/api/posts/${props.postId}/comments/${id}/branch`, {
      method: "POST",
    });
    flash.ok(`Branched as ${data.branch.name}`);
    await load();
  } catch (e: any) {
    flash.error(e);
  }
}

onMounted(load);
watch(() => props.postId, load);
</script>
