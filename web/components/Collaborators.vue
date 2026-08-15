<template>
  <section class="collab">
    <div v-if="post.invited" class="card" style="margin-bottom: 16px">
      <p class="kicker">co-author invite</p>
      <p class="muted">You’ve been invited to take structural credit on this object.</p>
      <button class="btn btn-primary btn-sm" type="button" @click="accept">Accept Co-authored-by</button>
    </div>

    <div class="protect-row">
      <div>
        <p class="kicker">protected main</p>
        <p class="muted" style="margin: 0">
          {{ post.protected ? "Only the author and maintainers can push to the canonical tip. Everyone else works via PR." : "Unprotected — accepted co-authors can commit directly." }}
        </p>
      </div>
      <button v-if="isOwner" class="btn btn-sm" type="button" @click="toggleProtect">
        {{ post.protected ? "Unprotect" : "Protect main" }}
      </button>
    </div>

    <div class="field" v-if="isOwner" style="margin-top: 20px">
      <label>Maintainers</label>
      <div class="topic-field">
        <span v-for="h in post.maintainers || []" :key="'m' + h" class="pill">@{{ h }}</span>
        <input v-model="maintDraft" class="topic-input" placeholder="@handle" @keydown.enter.prevent="addMaintainer" />
      </div>
    </div>

    <div class="field">
      <label>Co-authors</label>
      <div class="topic-field">
        <span v-for="h in post.coAuthors || []" :key="'c' + h" class="pill topic-pill">
          @{{ h }}
          <button v-if="isOwner || user?.handle === h" type="button" class="topic-x" @click="remove(h)">×</button>
        </span>
        <span v-for="h in post.coAuthorInvites || []" :key="'i' + h" class="pill">invited @{{ h }}</span>
        <input v-if="canManage" v-model="inviteDraft" class="topic-input" placeholder="invite @handle" @keydown.enter.prevent="invite" />
      </div>
      <p class="subtle" style="margin: 6px 0 0; font-size: 0.8rem">Accepted co-authors appear as Co-authored-by trailers on new commits.</p>
    </div>

    <div class="field">
      <label>Review requests</label>
      <ul class="log-list">
        <li v-for="r in post.reviewers || []" :key="r.handle" class="commit-row" style="grid-template-columns: 1fr auto">
          <div>
            <NuxtLink :to="`/u/${r.handle}`">@{{ r.handle }}</NuxtLink>
            <div class="log-meta">
              <span class="pill">{{ r.status }}</span>
              <span v-if="r.note">{{ r.note }}</span>
            </div>
          </div>
          <div v-if="user?.handle === r.handle && r.status === 'requested'" class="row">
            <button class="btn btn-sm btn-primary" type="button" @click="review('approved')">Approve</button>
            <button class="btn btn-sm" type="button" @click="review('changes')">Request changes</button>
          </div>
        </li>
      </ul>
      <form v-if="canManage" class="row" @submit.prevent="requestReview">
        <input v-model="reviewDraft" class="btn" style="flex: 1; text-align: left" placeholder="@user to review this draft" />
        <button class="btn btn-primary" type="submit">Request review</button>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{ post: any }>();
const emit = defineEmits<{ updated: [post: any] }>();
const { user } = useAuth();
const flash = useFlash();
const inviteDraft = ref("");
const maintDraft = ref("");
const reviewDraft = ref("");

const isOwner = computed(() => user.value && props.post.owner === user.value.handle);
const canManage = computed(() => props.post.canPush);

async function accept() {
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.post.id}/coauthors/accept`, { method: "POST" });
    emit("updated", data.post);
    flash.ok("You’re a co-author");
  } catch (e: any) {
    flash.error(e);
  }
}

async function invite() {
  const handle = inviteDraft.value.replace(/^@/, "").trim();
  if (!handle) return;
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.post.id}/coauthors`, {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
    inviteDraft.value = "";
    emit("updated", data.post);
  } catch (e: any) {
    flash.error(e);
  }
}

async function remove(handle: string) {
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.post.id}/coauthors/${encodeURIComponent(handle)}`, {
      method: "DELETE",
    });
    emit("updated", data.post);
  } catch (e: any) {
    flash.error(e);
  }
}

async function toggleProtect() {
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.post.id}/protect`, {
      method: "POST",
      body: JSON.stringify({ protected: !props.post.protected, maintainers: props.post.maintainers || [] }),
    });
    emit("updated", data.post);
    flash.ok(data.post.protected ? "Main is protected" : "Main is open to co-authors");
  } catch (e: any) {
    flash.error(e);
  }
}

async function addMaintainer() {
  const handle = maintDraft.value.replace(/^@/, "").trim();
  if (!handle) return;
  const maintainers = [...(props.post.maintainers || []), handle];
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.post.id}/protect`, {
      method: "POST",
      body: JSON.stringify({ protected: props.post.protected, maintainers }),
    });
    maintDraft.value = "";
    emit("updated", data.post);
  } catch (e: any) {
    flash.error(e);
  }
}

async function requestReview() {
  const handle = reviewDraft.value.replace(/^@/, "").trim();
  if (!handle) return;
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.post.id}/reviewers`, {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
    reviewDraft.value = "";
    emit("updated", data.post);
    flash.ok(`Review requested from @${handle}`);
  } catch (e: any) {
    flash.error(e);
  }
}

async function review(status: string) {
  try {
    const data = await api<{ post: any }>(`/api/posts/${props.post.id}/review`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    emit("updated", data.post);
    flash.ok(status === "approved" ? "Approved" : "Changes requested");
  } catch (e: any) {
    flash.error(e);
  }
}
</script>
