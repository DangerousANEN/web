<script lang="ts" setup>
/**
 * Standalone Veto Overlay
 * Full-screen veto display for OBS browser source.
 * Shows animated map veto process: bans (red), picks (green), decider (gold).
 * Connects to match GraphQL subscription for real-time veto state.
 */
import { gql, useQuery } from "#imports";

const route = useRoute();
const matchId = computed(() => route.params.matchId as string);

// Color palette
const COLORS = {
  ban: "#ef4444",
  pick: "#22c55e",
  decider: "#f59e0b",
  bg: "rgba(15,15,20,0.92)",
  text: "#ffffff",
  accent: "#f97316",
  dim: "rgba(255,255,255,0.4)",
};

const MAPS = [
  "de_dust2", "de_mirage", "de_inferno", "de_nuke",
  "de_overpass", "de_ancient", "de_vertigo", "de_anubis",
  "de_train", "de_cache", "de_cbble",
];

interface VetoStep {
  action: "ban" | "pick" | "decider";
  map: string;
  team: string | null;
  order: number;
}

const MATCH_VETO_QUERY = gql`
  query MatchVeto($matchId: uuid!) {
    matches_by_pk(id: $matchId) {
      id
      map_veto {
        id
        veto_steps {
          action
          map
          team
          order
        }
      }
      team1 { name logo_url }
      team2 { name logo_url }
    }
  }
`;

const { result, loading } = useQuery(MATCH_VETO_QUERY, () => ({
  matchId: matchId.value,
}));

const match = computed(() => result.value?.matches_by_pk ?? null);
const vetoSteps = computed<VetoStep[]>(() => {
  const steps = match.value?.map_veto?.veto_steps;
  if (!steps) return [];
  return [...steps].sort((a: any, b: any) => a.order - b.order);
});

const bannedMaps = computed(() => vetoSteps.value.filter(s => s.action === "ban").map(s => s.map));
const pickedMaps = computed(() => vetoSteps.value.filter(s => s.action === "pick").map(s => s.map));
const deciderMap = computed(() => vetoSteps.value.find(s => s.action === "decider")?.map);

const remainingMaps = computed(() =>
  MAPS.filter(m => !bannedMaps.value.includes(m) && !pickedMaps.value.includes(m) && m !== deciderMap.value)
);

function actionColor(action: string) {
  if (action === "ban") return COLORS.ban;
  if (action === "pick") return COLORS.pick;
  return COLORS.decider;
}

function actionLabel(action: string) {
  if (action === "ban") return "BAN";
  if (action === "pick") return "PICK";
  return "DECIDER";
}

function actionIcon(action: string) {
  if (action === "ban") return "✕";
  if (action === "pick") return "✓";
  return "★";
}
</script>

<template>
  <div class="veto-overlay fixed inset-0 overflow-hidden" :style="{ backgroundColor: COLORS.bg, color: COLORS.text }">
    <!-- Top: Title -->
    <div class="absolute top-0 left-0 right-0 flex justify-center pt-12">
      <div class="text-center">
        <h1 class="text-6xl font-black tracking-wider" style="color: #fff; text-shadow: 0 0 20px rgba(249,115,22,0.4)">
          MAP VETO
        </h1>
        <div v-if="match" class="mt-4 text-2xl font-semibold" style="color: #aaa">
          {{ match.team1?.name || "Team 1" }} <span style="color: #555">vs</span> {{ match.team2?.name || "Team 2" }}
        </div>
      </div>
    </div>

    <!-- Center: Map pick/ban visualization -->
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1600px]">
      <div class="grid grid-cols-4 gap-8">
        <div
          v-for="map in MAPS"
          :key="map"
          class="relative aspect-video rounded-xl overflow-hidden border-2 transition-all duration-500"
          :class="{
            'opacity-30 border-transparent scale-95': bannedMaps.includes(map),
            'border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.3)]': pickedMaps.includes(map),
            'border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]': map === deciderMap,
          }"
          :style="{
            borderColor: bannedMaps.includes(map) ? 'transparent' :
                        pickedMaps.includes(map) ? '#22c55e' :
                        map === deciderMap ? '#f59e0b' :
                        'rgba(255,255,255,0.15)',
          }"
        >
          <!-- Map name -->
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-3xl font-bold" :style="{ color: bannedMaps.includes(map) ? '#666' : '#fff' }">
              {{ map.replace("de_", "").toUpperCase() }}
            </span>
          </div>

          <!-- Action overlay -->
          <div
            v-if="bannedMaps.includes(map) || pickedMaps.includes(map) || map === deciderMap"
            class="absolute inset-0 flex items-center justify-center"
            :style="{
              backgroundColor: bannedMaps.includes(map) ? 'rgba(239,68,68,0.15)' :
                              pickedMaps.includes(map) ? 'rgba(34,197,94,0.15)' :
                              'rgba(245,158,11,0.15)',
            }"
          >
            <div
              v-if="bannedMaps.includes(map)"
              class="text-7xl font-black"
              style="color: #ef4444; text-shadow: 0 0 10px rgba(239,68,68,0.5)"
            >
              ✕
            </div>
            <div
              v-else-if="pickedMaps.includes(map)"
              class="flex flex-col items-center gap-2"
            >
              <div class="text-6xl font-black" style="color: #22c55e">✓</div>
              <div
                class="text-sm font-bold uppercase tracking-wider px-4 py-1 rounded-full"
                style="background: rgba(34,197,94,0.2); color: #22c55e"
              >
                PICK
              </div>
            </div>
            <div
              v-else-if="map === deciderMap"
              class="flex flex-col items-center gap-2"
            >
              <div class="text-6xl font-black" style="color: #f59e0b">★</div>
              <div
                class="text-sm font-bold uppercase tracking-wider px-4 py-1 rounded-full"
                style="background: rgba(245,158,11,0.2); color: #f59e0b"
              >
                DECIDER
              </div>
            </div>
          </div>

          <!-- Team logo that picked/banned -->
          <div
            v-if="vetoSteps.find(s => s.map === map && s.team)"
            class="absolute bottom-2 left-2 text-xs px-2 py-1 rounded backdrop-blur-sm"
            :style="{
              backgroundColor: 'rgba(0,0,0,0.5)',
              color: actionColor(vetoSteps.find(s => s.map === map)?.action || ''),
            }"
          >
            {{ vetoSteps.find(s => s.map === map)?.team }}
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom: Veto History Log -->
    <div
      v-if="vetoSteps.length > 0"
      class="absolute bottom-8 left-8 right-8 flex justify-center"
    >
      <div class="flex gap-4 flex-wrap justify-center max-w-[1600px]">
        <div
          v-for="(step, i) in vetoSteps"
          :key="i"
          class="flex items-center gap-3 px-6 py-3 rounded-lg backdrop-blur-sm"
          :style="{
            backgroundColor: 'rgba(0,0,0,0.6)',
            border: `1px solid ${actionColor(step.action)}40`,
          }"
        >
          <span class="text-3xl font-bold" :style="{ color: actionColor(step.action) }">
            {{ actionIcon(step.action) }}
          </span>
          <div class="flex flex-col">
            <span class="text-xs uppercase tracking-wider" :style="{ color: actionColor(step.action) }">
              {{ actionLabel(step.action) }}
            </span>
            <span class="text-lg font-semibold text-white">
              {{ step.map.replace("de_", "").toUpperCase() }}
            </span>
          </div>
          <span v-if="step.team" class="text-sm text-gray-400 ml-2">{{ step.team }}</span>
        </div>
      </div>
    </div>

    <!-- Loading indicator -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
      <div class="text-2xl text-gray-600 animate-pulse">Loading veto...</div>
    </div>
  </div>
</template>

<style scoped>
.veto-overlay {
  font-family: "Inter", "Segoe UI", sans-serif;
  user-select: none;
  pointer-events: none;
}

.aspect-video {
  aspect-ratio: 16 / 9;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.veto-overlay > div {
  animation: slideIn 0.5s ease-out;
}
</style>
