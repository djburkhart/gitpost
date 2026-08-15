<template>
  <div class="graph" role="img" aria-label="Commit graph">
    <div
      v-for="row in rows"
      :key="row.node.id"
      class="graph-row"
    >
      <svg class="graph-lanes" :width="svgW" :height="64" aria-hidden="true">
        <template v-for="(on, i) in row.passThrough" :key="'p' + i">
          <line v-if="on" :x1="x(i)" y1="0" :x2="x(i)" y2="64" class="graph-edge" />
        </template>
        <line
          v-for="(c, i) in row.joins"
          :key="'j' + i"
          :x1="x(row.lane)"
          y1="32"
          :x2="x(c)"
          y2="64"
          class="graph-edge join"
        />
        <circle :cx="x(row.lane)" cy="32" r="5.5" class="graph-dot" :class="row.node.kind" />
      </svg>
      <div class="graph-body">
        <div class="log-meta">
          <NuxtLink :to="`/u/${row.node.owner}`">{{ row.node.owner }}</NuxtLink>
          <time>{{ formatAgo(row.node.updatedAt) }}</time>
          <NuxtLink :to="`/p/${row.node.id}`" class="sha">{{ row.node.shortSha }}</NuxtLink>
          <span v-if="row.node.kind === 'fork'" class="pill">{{ intentLabel(row.node.forkIntent) || "fork" }}</span>
          <span v-else-if="row.node.kind === 'merge'" class="pill">merge</span>
          <span v-for="t in row.node.topics || []" :key="t" class="pill">remote:{{ t }}</span>
        </div>
        <h2 class="subject">
          <NuxtLink :to="`/p/${row.node.id}`">{{ row.node.subject }}</NuxtLink>
        </h2>
        <div class="log-stats">
          <span>{{ row.node.starCount }} ★</span>
          <span>{{ row.node.forkCount }} forks</span>
          <span>{{ row.node.commitCount }} commits</span>
        </div>
      </div>
    </div>
    <p v-if="!rows.length" class="empty">The object store is empty.</p>
  </div>
</template>

<script setup lang="ts">
import { intentLabel } from "~/utils/intents";

const props = defineProps<{ nodes: any[] }>();

type Row = {
  node: any;
  lane: number;
  passThrough: boolean[];
  joins: number[];
};

const laid = computed(() => {
  const nodes = [...(props.nodes || [])];
  const lanes: (string | null)[] = [];
  const rows: Row[] = [];
  for (const n of nodes) {
    let lane = lanes.indexOf(n.id);
    if (lane < 0) {
      lane = lanes.findIndex((id) => id == null);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(n.id);
      } else {
        lanes[lane] = n.id;
      }
    }
    const parents: string[] = Array.isArray(n.parents) && n.parents.length
      ? n.parents
      : n.parentPostId
        ? [n.parentPostId]
        : [];
    const joins: number[] = [];
    const passThrough = lanes.map((id, i) => id != null && i !== lane);
    const primary = parents[0];
    if (primary && nodes.some((x) => x.id === primary)) {
      const existing = lanes.findIndex((id) => id === primary);
      if (existing >= 0 && existing !== lane) {
        joins.push(existing);
        lanes[lane] = null;
      } else {
        lanes[lane] = primary;
      }
    } else {
      lanes[lane] = null;
    }
    for (let k = 1; k < parents.length; k++) {
      const extra = parents[k];
      let pl = lanes.indexOf(extra);
      if (pl < 0) {
        pl = lanes.findIndex((id) => id == null);
        if (pl < 0) {
          pl = lanes.length;
          lanes.push(extra);
        } else {
          lanes[pl] = extra;
        }
      }
      if (pl !== lane) joins.push(pl);
    }
    rows.push({ node: n, lane, passThrough, joins });
  }
  const laneCount = Math.max(1, ...rows.map((r) => Math.max(r.lane, ...r.joins, 0) + 1));
  return { rows, laneCount };
});

const rows = computed(() => laid.value.rows);
const svgW = computed(() => laid.value.laneCount * 18 + 8);
function x(i: number) {
  return 9 + i * 18;
}
</script>
