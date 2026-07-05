<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute } from "vue-router";
import { useApolloClient } from "@vue/apollo-composable";
import { generateQuery } from "~/graphql/graphqlGen";
import type { ApolloQueryResult } from "@apollo/client";

// HUD Preview — renders a saved hud_layout config.
//
// Two modes:
//   1. Mock mode (default): /overlay/hud/preview?layout=<slug>
//      Uses fake GSI data so the designer can see how blocks look
//      without a live match.
//   2. Live mode: /overlay/hud/preview?layout=<slug>&live=<matchId>
//      Polls /overlay/state/<matchId> and feeds real GSI into
//      blockContent(), so the designer can preview a saved layout
//      against an actual running match.
//
// Auth: none required for public layouts; private layouts will 404
// for anonymous users (the designer should open this while logged in).

definePageMeta({ layout: false });

const route = useRoute();
const layoutSlug = computed(() => String(route.query.layout || ""));
const liveMatchId = computed(() => String(route.query.live || ""));
const isLive = computed(() => !!liveMatchId.value);
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

// ─── Live GSI state ─────────────────────────────────────────────
interface LiveGsi {
  map_name?: string | null;
  round_phase?: string | null;
  round_number?: number | null;
  spectated_steam_id?: string | null;
  team_ct_name?: string | null;
  team_t_name?: string | null;
  team_ct_score?: number;
  team_t_score?: number;
  phase?: string | null;
  phase_ends_in_s?: number | null;
  bomb_state?: string | null;
  bomb_countdown_s?: number | null;
  spec_players_ext?: Array<{
    slot: number;
    steam_id: string;
    name: string | null;
    team: "T" | "CT" | null;
    alive: boolean;
    health: number;
    kills: number;
    deaths: number;
    assists: number;
    money: number;
    equip_value: number;
    active_weapon: string | null;
  }>;
}

interface LiveOverlayState {
  match: {
    status: string;
    lineup_1?: { name?: string | null } | null;
    lineup_2?: { name?: string | null } | null;
  } | null;
  gsi: LiveGsi | null;
}

const liveState = ref<LiveOverlayState | null>(null);
let livePollTimer: ReturnType<typeof setInterval> | null = null;

const apiBase = computed(() => {
  const raw = String(useRuntimeConfig().public.apiDomain ?? "").replace(
    /\/$/,
    "",
  );
  return raw;
});

async function pollLiveState() {
  if (!liveMatchId.value || !apiBase.value) return;
  try {
    const res = await fetch(
      `${apiBase.value}/overlay/state/${liveMatchId.value}`,
    );
    if (!res.ok) return;
    liveState.value = (await res.json()) as LiveOverlayState;
  } catch {
    // transient — next tick
  }
}

const LIVE_POLL_MS = 1000;

function startLivePolling() {
  stopLivePolling();
  void pollLiveState();
  livePollTimer = setInterval(pollLiveState, LIVE_POLL_MS);
}

function stopLivePolling() {
  if (livePollTimer) {
    clearInterval(livePollTimer);
    livePollTimer = null;
  }
}

watch(
  liveMatchId,
  (id) => {
    if (id) startLivePolling();
    else stopLivePolling();
  },
);

// ─── Layout loading ──────────────────────────────────────────────

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

onMounted(() => {
  void load();
  if (liveMatchId.value) startLivePolling();
});

onBeforeUnmount(() => {
  stopLivePolling();
});

// ─── Mock GSI data (fallback when no ?live=) ─────────────────────

const mockTeams = {
  ct: { name: "Natus Vincere", score: 13 },
  t: { name: "Vitality", score: 11 },
};

const mockPlayers = [
  { name: "s1mple", team: "CT" as const, kills: 24, deaths: 14, assists: 5, money: 15400, alive: true, active_weapon: "weapon_ak47" },
  { name: "b1t", team: "CT" as const, kills: 18, deaths: 16, assists: 8, money: 3200, alive: true, active_weapon: "weapon_m4a1" },
  { name: "iM", team: "CT" as const, kills: 15, deaths: 18, assists: 6, money: 800, alive: false, active_weapon: null },
  { name: "jL", team: "CT" as const, kills: 12, deaths: 19, assists: 4, money: 150, alive: true, active_weapon: "weapon_glock" },
  { name: "w0nderful", team: "CT" as const, kills: 20, deaths: 15, assists: 3, money: 5400, alive: true, active_weapon: "weapon_awp" },
  { name: "ZywOo", team: "T" as const, kills: 28, deaths: 12, assists: 4, money: 12000, alive: true, active_weapon: "weapon_ak47" },
  { name: "apEX", team: "T" as const, kills: 10, deaths: 20, assists: 12, money: 200, alive: false, active_weapon: null },
  { name: "flameZ", team: "T" as const, kills: 16, deaths: 17, assists: 7, money: 4100, alive: true, active_weapon: "weapon_deagle" },
  { name: "Spinx", team: "T" as const, kills: 19, deaths: 15, assists: 5, money: 6700, alive: true, active_weapon: "weapon_ak47" },
  { name: "mezii", team: "T" as const, kills: 14, deaths: 18, assists: 9, money: 900, alive: true, active_weapon: "weapon_m4a1" },
];

const mockRound = { number: 24, phase: "live", timeLeft: 45 };
const mockBomb = { state: "planted", countdown: 32 };

// ─── Unified block content (live or mock) ────────────────────────

const gsi = computed<LiveGsi | null>(() => liveState.value?.gsi ?? null);

const ctName = computed(() => {
  if (isLive.value) return gsi.value?.team_ct_name ?? liveState.value?.match?.lineup_1?.name ?? "CT";
  return mockTeams.ct.name;
});
const tName = computed(() => {
  if (isLive.value) return gsi.value?.team_t_name ?? liveState.value?.match?.lineup_2?.name ?? "T";
  return mockTeams.t.name;
});
const ctScore = computed(() => {
  if (isLive.value) return gsi.value?.team_ct_score ?? 0;
  return mockTeams.ct.score;
});
const tScore = computed(() => {
  if (isLive.value) return gsi.value?.team_t_score ?? 0;
  return mockTeams.t.score;
});
const roundNumber = computed(() => {
  if (isLive.value) return gsi.value?.round_number ?? null;
  return mockRound.number;
});
const phaseLabel = computed(() => {
  if (isLive.value) {
    const p = gsi.value?.phase ?? gsi.value?.round_phase ?? null;
    if (!p) return null;
    if (p === "freezetime") return "Buy Time";
    if (p === "live") return "Live";
    if (p === "over") return "Round Over";
    if (p === "warmup") return "Warmup";
    if (p === "intermission") return "Halftime";
    return p;
  }
  return mockRound.phase;
});
const bombState = computed(() => {
  if (isLive.value) return gsi.value?.bomb_state ?? null;
  return mockBomb.state;
});
const bombCountdown = computed(() => {
  if (isLive.value) return gsi.value?.bomb_countdown_s ?? null;
  return mockBomb.countdown;
});
const mapName = computed(() => {
  if (isLive.value) return gsi.value?.map_name ?? null;
  return "de_dust2";
});

interface DisplayPlayer {
  name: string;
  team: "CT" | "T";
  kills: number;
  deaths: number;
  assists: number;
  money: number;
  alive: boolean;
  active_weapon: string | null;
}

const displayPlayers = computed<DisplayPlayer[]>(() => {
  if (isLive.value && gsi.value?.spec_players_ext?.length) {
    return gsi.value.spec_players_ext.map((p) => ({
      name: p.name ?? p.steam_id,
      team: p.team ?? "CT",
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      money: p.money,
      alive: p.alive,
      active_weapon: p.active_weapon,
    }));
  }
  return mockPlayers;
});

function shortWeapon(name: string | null): string {
  if (!name) return "";
  return name.replace(/^weapon_/, "").replace(/^[a-z]/, (c) => c.toUpperCase());
}

function blockContent(block: BlockConfig): string {
  const type = block.type;
  switch (type) {
    case "scoreboard":
      return `${ctName.value} ${ctScore.value} - ${tScore.value} ${tName.value}`;
    case "player-list":
      return displayPlayers.value
        .map((p) => `${p.alive ? "●" : "○"} ${p.name} (${p.kills}/${p.assists}/${p.deaths})`)
        .join("\n");
    case "team-banner":
      return `${ctName.value} vs ${tName.value}`;
    case "kill-feed":
      // In live mode, a real kill-feed would need a separate event
      // stream; for preview we show the spectated player + weapon.
      if (isLive.value) {
        const spec = gsi.value?.spectated_steam_id;
        const specP = displayPlayers.value.find(
          (_, i) => gsi.value?.spec_players_ext?.[i]?.steam_id === spec,
        );
        return specP
          ? `Spec: ${specP.name} — ${shortWeapon(specP.active_weapon)}`
          : "—";
      }
      return "s1mple → ZywOo (AK-47)\nb1t → apEX (M4A1-S)";
    case "bomb-timer": {
      const cd = bombCountdown.value;
      const st = bombState.value;
      if (cd === null) return st ? `${st.toUpperCase()}` : "—";
      return `${st?.toUpperCase() ?? "BOMB"} ${cd}s`;
    }
    case "round-info": {
      const rn = roundNumber.value;
      const ph = phaseLabel.value;
      return `Round ${rn ?? "—"} — ${ph ?? ""}`.trim();
    }
    case "map-name":
      return mapName.value ?? "—";
    case "economy": {
      const ctBank = displayPlayers.value
        .filter((p) => p.team === "CT")
        .reduce((a, p) => a + p.money, 0);
      const tBank = displayPlayers.value
        .filter((p) => p.team === "T")
        .reduce((a, p) => a + p.money, 0);
      return `CT $${ctBank.toLocaleString()} | T $${tBank.toLocaleString()}`;
    }
    case "custom-text":
      return String(block.data?.text ?? "Custom Text");
    case "custom-image":
      return String(block.data?.url ?? "[IMAGE]");
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

    <!-- Live mode badge (only visible to designer, not OBS) -->
    <div
      v-if="isLive && !loading && !error"
      class="absolute top-1 left-1 text-[10px] font-mono uppercase tracking-wider text-emerald-400/60 z-10"
    >
      ● live {{ liveMatchId }}
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
      {{ blockContent(block) }}
    </div>
  </div>
</template>
