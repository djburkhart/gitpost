<template>
  <section class="contrib" v-if="graph">
    <div class="contrib-head">
      <p class="kicker" style="margin: 0">writing log · last year</p>
      <p class="subtle">
        {{ totals.commits }} commits · {{ totals.merges }} merges accepted · {{ totals.taken }} taken
      </p>
    </div>
    <div class="heatmap-scroll">
      <div class="heatmap" role="img" :aria-label="label">
        <div v-for="(week, wi) in graph.weeks" :key="wi" class="heat-week">
          <button
            v-for="day in week"
            :key="day.date"
            type="button"
            class="heat-cell"
            :class="'lv-' + day.level"
            :title="tip(day)"
          />
        </div>
      </div>
    </div>
    <div class="heat-legend">
      <span class="subtle">less</span>
      <span class="heat-cell lv-0" />
      <span class="heat-cell lv-1" />
      <span class="heat-cell lv-2" />
      <span class="heat-cell lv-3" />
      <span class="heat-cell lv-4" />
      <span class="subtle">more</span>
    </div>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{ graph: any }>();
const totals = computed(() => props.graph?.totals || { commits: 0, merges: 0, taken: 0 });
const label = computed(
  () =>
    `${totals.value.commits} commits, ${totals.value.merges} merges accepted, ${totals.value.taken} cherry-picks taken from this log`,
);
function tip(day: any) {
  if (!day.total) return `${day.date}: none`;
  const bits = [];
  if (day.commits) bits.push(`${day.commits} commit${day.commits === 1 ? "" : "s"}`);
  if (day.merges) bits.push(`${day.merges} merge${day.merges === 1 ? "" : "s"} accepted`);
  if (day.taken) bits.push(`${day.taken} taken from you`);
  return `${day.date}: ${bits.join(", ")}`;
}
</script>
