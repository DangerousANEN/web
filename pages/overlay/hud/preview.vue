<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useApolloClient } from "@vue/apollo-composable";
import { generateQuery } from "~/graphql/graphqlGen";
import type { ApolloQueryResult } from "@apollo/client";

// HUD Preview — renders a saved hud_layout config with fake GSI data
// so the designer can see how blocks look without a live match.
//
// Usage: /overlay/hud/preview?layout=<slug>
//
// Auth: none required for public layouts; private layouts will 404
// for anonymous users (the designer should open this while logged in).

definePageMeta({ layout: false });

const route = useRoute();
const layoutSlug = computed(() => String(route.query.layout || ""));
const { client: apolloClient } = useApolloClient();

interface BlockConfig {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: Record<string, string | undefined>;
  data: Record<string, unknown>;
}

interface HudLayout {
  id: string;
  name: string;
  slug: string;
  category: string;
  config: { blocks?: BlockConfig[] } | null;
}

const layout = ref<HudLayout | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const blocks = computed<BlockConfig[]>(() => {
  const b = layout.value?.config?.blocks;
  return Array.isArray(b) ? b : [];
});

async function load() {
  if (!layoutSlug.value) {
    error.value = "Missing ?layout=<slug>";
    loading.value = false;
    return;
  }
  try {
    const result: ApolloQueryResult<{ hud_layouts: HudLayout[] }> =
      await apolloClient.query({
        query: generateQuery({
          hud_layouts: [
            {
              where: { slug: { _eq: layoutSlug.value } },
              limit: 1,
            },
            {
              id: true,
              name: true,
              slug: true,
              category: true,
              config: true,
            },
          ],
        }),
        fetchPolicy: "network-only",
      });
    layout.value = result.data.hud_layouts?.[0] ?? null;
    if (!layout.value) error.value = "Layout not found";
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ---- Mock GSI data for preview ----
const mockTeams = {
  ct: { name: "Natus Vincere", score: 13 },
  t: { name: "Vitality", score: 11 },
};

const mockPlayers = [
  { name: "s1mple", team: "CT" as const, kills: 24, deaths: 14, assists: 5, money: 15400, alive: true },
  { name: "b1t", team: "CT" as const, kills: 18, deaths: 16, assists: 8, money: 3200, alive: true },
  { name: "iM", team: "CT" as const, kills: 15, deaths: 18, assists: 6, money: 800, alive: false },
  { name: "jL", team: "CT" as const, kills: 12, deaths: 19, assists: 4, money: 150, alive: true },
  { name: "w0nderful", team: "CT" as const, kills: 20, deaths: 15, assists: 3, money: 5400, alive: true },
  { name: "ZywOo", team: "T" as const, kills: 28, deaths: 12, assists: 4, money: 12000, alive: true },
  { name: "apEX", team: "T" as const, kills: 10, deaths: 20, assists: 12, money: 200, alive: false },
  { name: "flameZ", team: "T" as const, kills: 16, deaths: 17, assists: 7, money: 4100, alive: true },
  { name: "Spinx", team: "T" as const, kills: 19, deaths: 15, assists: 5, money: 6700, alive: true },
  { name: "mezii", team: "T" as const, kills: 14, deaths: 18, assists: 9, money: 900, alive: true },
];

const mockRound = { number: 24, phase: "live", timeLeft: 45 };
const mockBomb = { state: "planted", countdown: 32 };

function blockContent(type: string): string {
  switch (type) {
    case "scoreboard":
      return `${mockTeams.ct.name} ${mockTeams.ct.score} - ${mockTeams.t.score} ${mockTeams.t.name}`;
    case "player-list":
      return mockPlayers.map((p) => `${p.alive ? "●" : "○"} ${p.name}`).join("\n");
    case "team-banner":
      return `${mockTeams.ct.name} vs ${mockTeams.t.name}`;
    case "kill-feed":
      return "s1mple → ZywOo (AK-47)\nb1t → apEX (M4A1-S)";
    case "bomb-timer":
      return `BOMB ${mockBomb.countdown}s`;
    case "round-info":
      return `Round ${mockRound.number} — ${mockRound.phase.toUpperCase()}`;
    case "custom-text":
      return "Custom Text";
    case "custom-image":
      return "[IMAGE]";
    default:
      return type;
  }
}
</script>

<template>
  <div
    class="fixed inset-0"
    style="width: 1920px; height: 1080px; background: transparent"
  >
    <!-- Loading / error states are invisible in OBS — only the designer
         sees them in the browser tab. -->
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center text-white/30 font-mono text-xs"
    >
      Loading layout…
    </div>
    <div
      v-else-if="error"
      class="absolute inset-0 flex items-center justify-center text-red-400/60 font-mono text-xs"
    >
      {{ error }}
    </div>

    <!-- Render blocks -->
    <div
      v-for="block in blocks"
      :key="block.id"
      class="absolute overflow-hidden"
      :style="{
        left: `${block.x}px`,
        top: `${block.y}px`,
        width: `${block.width}px`,
        height: `${block.height}px`,
        backgroundColor: block.style.backgroundColor || 'rgba(0,0,0,0.7)',
        color: block.style.color || '#fff',
        fontFamily: block.style.fontFamily || 'sans-serif',
        fontSize: block.style.fontSize || '14px',
        fontWeight: block.style.fontWeight || '400',
        border: block.style.border || 'none',
        borderRadius: block.style.borderRadius || '0px',
        padding: block.style.padding || '8px',
        textAlign: (block.style.textAlign as any) || 'left',
        opacity: block.style.opacity ?? '1',
        whiteSpace: 'pre-line',
      }"
    >
      {{ blockContent(block.type) }}
    </div>
  </div>
</template>
