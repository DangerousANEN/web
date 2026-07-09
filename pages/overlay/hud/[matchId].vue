<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";

// OBS Browser Source HUD overlay. Two built-in layouts:
//   game      — drawn over the cs2 game footage during play
//   operator  — drawn over the operator-cam scene between rounds
//
// New flexible API (preferred): /overlay/hud/<id>?slot=<slot_key>
//   The slot_key is matched against `match_overlay_huds.slot_key` on
//   the server. If the slot has a `hud_id` referencing a custom HUD
//   pack with a browser-renderable format we'd render that pack here
//   in an iframe (TODO — see below); for now, slot_key is mapped to
//   one of the two built-in layouts.
//
// Backwards-compat: /overlay/hud/<id>?layout=game|operator still
// works exactly the same way it did before slots existed.
//
// Auth: none. The api's /overlay/state/:matchId is also no-auth, so
// pasting the URL into OBS "just works". See middleware/auth.global.ts
// for the public-route allowlist and api/overlay.controller.ts for the
// server side.
//
// Background: fully transparent (rgba(0,0,0,0)) so OBS composes the
// HUD over an arbitrary scene. Operators add the URL as a Browser
// Source 1920x1080, "Custom CSS" empty, "Refresh browser when scene
// becomes active" checked.

definePageMeta({
  layout: false,
});

const route = useRoute();
const matchId = computed(() => String(route.params.matchId));

// Direct ?layout= takes precedence so URLs that operators already
// pasted into OBS keep working unchanged.
const explicitLayout = computed<
  "game" | "operator" | "veto" | "freeze" | "transition" | null
>(() => {
  const v = route.query.layout
    ? String(route.query.layout).toLowerCase()
    : null;
  if (v === "operator") return "operator";
  if (v === "game") return "game";
  if (v === "veto") return "veto";
  if (v === "freeze") return "freeze";
  if (v === "transition") return "transition";
  return null;
});

const slotKey = computed(() => {
  const v = route.query.slot ? String(route.query.slot).toLowerCase() : null;
  return v && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v) ? v : null;
});

// Defer initialisation of `state` so it's already in the file when
// `layout` reads from it. The layout resolution prefers an explicit
// ?layout=… , then the slot's known mapping, then default to game.
const SLOT_LAYOUT_MAP: Record<string, "game" | "operator" | "veto" | "freeze" | "transition"> = {
  operator: "operator",
  veto: "veto",
  freeze: "freeze",
  freeze_time: "freeze",
  freezetime: "freeze",
  transition: "transition",
  intermission: "transition",
};
function layoutForSlot(
  key: string | null,
): "game" | "operator" | "veto" | "freeze" | "transition" {
  if (!key) return "game";
  return SLOT_LAYOUT_MAP[key] ?? "game";
}
// `?debug=1` paints a faint border around the canvas + dumps the raw
// state so operators can verify the data is flowing without having to
// open devtools inside OBS.
const debug = computed(() => route.query.debug === "1");

interface SpecSlot {
  slot: number;
  steam_id: string;
  name: string | null;
  team: "T" | "CT" | null;
  alive: boolean;
  health: number;
}

interface SpecPlayerExt extends SpecSlot {
  armor: number;
  helmet: boolean;
  money: number;
  equip_value: number;
  round_kills: number;
  round_killhs: number;
  kills: number;
  assists: number;
  deaths: number;
  mvps: number;
  score: number;
  weapons: Array<{ name: string; type: string | null }>;
  active_weapon: string | null;
  defusekit: boolean;
}

interface OverlayHud {
  id: string;
  slot_key: string;
  label: string | null;
  hud_id: string | null;
  layout_id: string | null;
  display_order: number;
  hud?: {
    id: string;
    slug: string | null;
    name: string | null;
    format?: string | null;
  } | null;
  layout?: {
    id: string;
    slug: string | null;
    name: string | null;
  } | null;
}

interface OverlayState {
  match: {
    id: string;
    status: string;
    current_match_map_id?: string | null;
    options?: {
      type?: string | null;
      raw_hud_overlay?: boolean | null;
    } | null;
    lineup_1?: {
      id?: string;
      name?: string | null;
      team?: { name?: string | null; logo_url?: string | null } | null;
    } | null;
    lineup_2?: {
      id?: string;
      name?: string | null;
      team?: { name?: string | null; logo_url?: string | null } | null;
    } | null;
    match_maps?: Array<{
      id: string;
      order: number | null;
      status: string;
      map?: { name?: string | null } | null;
      lineup_1_score?: number | null;
      lineup_2_score?: number | null;
    }>;
    veto_picks?: Array<{
      id: string;
      order: number | null;
      type: string;
      map?: { name?: string | null; image_url?: string | null } | null;
      lineup?: {
        team?: { name?: string | null; logo_url?: string | null } | null;
      } | null;
    }>;
  } | null;
  overlay_huds?: OverlayHud[];
  gsi: {
    map_name?: string | null;
    round_phase?: string | null;
    round_number?: number | null;
    spectated_steam_id?: string | null;
    spec_slots?: SpecSlot[];
    spec_players_ext?: SpecPlayerExt[];
    team_ct_name?: string | null;
    team_t_name?: string | null;
    team_ct_score?: number;
    team_t_score?: number;
    phase?: string | null;
    phase_ends_in_s?: number | null;
    bomb_state?: string | null;
    bomb_countdown_s?: number | null;
  } | null;
}

const state = ref<OverlayState | null>(null);
const lastErrorAt = ref(0);
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Effective layout: if the operator passed ?layout= explicitly we
// honour it; otherwise we look up the matching slot in overlay state
// and use that slot_key's mapping (operator → operator, anything else
// → game). If the slot exists but resolves to a custom HUD pack,
// we'll surface that here in a future iteration; for now the slot's
// HUD pack is metadata only.
const layout = computed<"game" | "operator" | "veto" | "freeze" | "transition">(() => {
  if (explicitLayout.value) return explicitLayout.value;
  return layoutForSlot(slotKey.value);
});

const customLayoutSlug = computed<string | null>(() => {
  // If a slot is requested and that slot has a custom hud_layout,
  // return its slug so we can iframe the preview page.
  if (!slotKey.value) return null;
  const slot = state.value?.overlay_huds?.find(
    (h) => h.slot_key === slotKey.value,
  );
  return slot?.layout?.slug ?? null;
});

const apiBase = computed(() => {
  const raw = String(useRuntimeConfig().public.apiDomain ?? "").replace(
    /\/$/,
    "",
  );
  return raw;
});

async function poll() {
  if (!apiBase.value || !matchId.value) return;
  try {
    const res = await fetch(`${apiBase.value}/overlay/state/${matchId.value}`, {
      credentials: "omit",
    });
    if (!res.ok) {
      lastErrorAt.value = Date.now();
      return;
    }
    state.value = (await res.json()) as OverlayState;
  } catch {
    lastErrorAt.value = Date.now();
  }
}

onMounted(() => {
  void poll();
  pollTimer = setInterval(poll, 1_000);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});

const ctSlots = computed<SpecPlayerExt[]>(() => {
  const ext = state.value?.gsi?.spec_players_ext;
  if (!ext) return [];
  return ext.filter((p) => p.team === "CT").sort((a, b) => a.slot - b.slot);
});
const tSlots = computed<SpecPlayerExt[]>(() => {
  const ext = state.value?.gsi?.spec_players_ext;
  if (!ext) return [];
  return ext.filter((p) => p.team === "T").sort((a, b) => a.slot - b.slot);
});

const ctTeamName = computed(
  () =>
    state.value?.gsi?.team_ct_name ??
    state.value?.match?.lineup_1?.name ??
    "CT",
);
const tTeamName = computed(
  () =>
    state.value?.gsi?.team_t_name ?? state.value?.match?.lineup_2?.name ?? "T",
);

const ctScore = computed(() => state.value?.gsi?.team_ct_score ?? 0);
const tScore = computed(() => state.value?.gsi?.team_t_score ?? 0);

const currentMatchMap = computed(() => {
  const m = state.value?.match;
  if (!m) return null;
  if (m.current_match_map_id && m.match_maps) {
    return (
      m.match_maps.find((mm) => mm.id === m.current_match_map_id) ?? null
    );
  }
  return null;
});

const mapName = computed(
  () =>
    state.value?.gsi?.map_name ??
    currentMatchMap.value?.map?.name ??
    null,
);

const roundNumber = computed(() => state.value?.gsi?.round_number ?? null);

// Local countdown: phase_ends_in_s is reported by the streamer pod's
// last GSI tick (up to ~1s stale). Tick a local clock every 100ms so
// the operator-view timer updates smoothly between polls.
const localPhaseTickMs = ref(0);
let phaseAnchor = { phase: null as string | null, secondsAt: 0, anchoredAtMs: 0 };
let tickRaf: number | null = null;
function tick() {
  localPhaseTickMs.value = Date.now();
  tickRaf = requestAnimationFrame(tick);
}
onMounted(() => {
  tickRaf = requestAnimationFrame(tick);
});
onBeforeUnmount(() => {
  if (tickRaf !== null) cancelAnimationFrame(tickRaf);
});
const phaseLabel = computed(() => {
  const p = state.value?.gsi?.phase ?? state.value?.gsi?.round_phase ?? null;
  if (!p) return null;
  if (p === "freezetime") return "Buy Time";
  if (p === "live") return "Live";
  if (p === "over") return "Round Over";
  if (p === "warmup") return "Warmup";
  if (p === "intermission") return "Halftime";
  if (p === "gameover") return "Match Over";
  return p;
});
const phaseSecondsLeft = computed(() => {
  const ends = state.value?.gsi?.phase_ends_in_s;
  const phase = state.value?.gsi?.phase ?? null;
  if (typeof ends !== "number") return null;
  if (phaseAnchor.phase !== phase || ends > phaseAnchor.secondsAt) {
    phaseAnchor = {
      phase,
      secondsAt: ends,
      anchoredAtMs: localPhaseTickMs.value || Date.now(),
    };
  }
  const elapsed = (localPhaseTickMs.value - phaseAnchor.anchoredAtMs) / 1000;
  return Math.max(0, phaseAnchor.secondsAt - elapsed);
});

const bombCountdownSeconds = computed(() => {
  const c = state.value?.gsi?.bomb_countdown_s;
  if (typeof c !== "number") return null;
  return Math.max(0, c);
});

// ─── Veto layout state ─────────────────────────────────────────
// Pulled from /overlay/state/:matchId.match.veto_picks + team info.
const vetoPicks = computed(() => state.value?.match?.veto_picks ?? []);
const team1Name = computed(
  () => state.value?.match?.lineup_1?.team?.name ??
    state.value?.match?.lineup_1?.name ??
    "Team 1",
);
const team2Name = computed(
  () => state.value?.match?.lineup_2?.team?.name ??
    state.value?.match?.lineup_2?.name ??
    "Team 2",
);
const team1Logo = computed(
  () => state.value?.match?.lineup_1?.team?.logo_url ?? null,
);
const team2Logo = computed(
  () => state.value?.match?.lineup_2?.team?.logo_url ?? null,
);
const vetoActive = computed(
  () => state.value?.match?.status === "Veto",
);

// ─── Round transition stinger state ────────────────────────────
// Tracks last-seen `phase`. When phase changes from live → over,
// or freezetime → live, the transition layout shows a brief stinger.
const lastPhase = ref<string | null>(null);
const transitionTrigger = ref(0);
const TRANSITION_DURATION_MS = 2500;
watch(
  () => state.value?.gsi?.phase,
  (next) => {
    if (next && lastPhase.value && next !== lastPhase.value) {
      transitionTrigger.value = Date.now();
    }
    lastPhase.value = next;
  },
);
const showTransition = computed(() => {
  if (layout.value !== "transition") return false;
  if (!transitionTrigger.value) return false;
  return (
    Date.now() - transitionTrigger.value < TRANSITION_DURATION_MS
  );
});

function formatSeconds(s: number | null): string {
  if (s === null) return "—";
  const total = Math.ceil(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatMoney(m: number): string {
  return `$${m.toLocaleString("en-US")}`;
}

function teamEconomyTotal(slots: SpecPlayerExt[]): number {
  return slots.reduce((acc, p) => acc + p.money, 0);
}
function teamEquipTotal(slots: SpecPlayerExt[]): number {
  return slots.reduce((acc, p) => acc + p.equip_value, 0);
}

// Strip `weapon_` prefix and `_t1`/`_haj` suffixes for compact display
// in the operator-view buy snapshot column.
function shortWeapon(name: string | null): string {
  if (!name) return "";
  return name
    .replace(/^weapon_/, "")
    .replace(/_t1$|_haj$/i, "")
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

// Pick the "headline" weapon for a player buy: prefer the active rifle
// /pistol, fall back to the first non-knife/grenade weapon.
function primaryWeapon(p: SpecPlayerExt): string {
  if (p.active_weapon && p.active_weapon !== "weapon_knife")
    return shortWeapon(p.active_weapon);
  const interesting = p.weapons.find(
    (w) => w.type !== "Knife" && w.type !== "Grenade" && w.type !== "C4",
  );
  return interesting ? shortWeapon(interesting.name) : "";
}

function grenadeIcons(p: SpecPlayerExt): string[] {
  const icons: string[] = [];
  for (const w of p.weapons) {
    if (w.type !== "Grenade") continue;
    if (w.name.endsWith("flashbang")) icons.push("F");
    else if (w.name.endsWith("smokegrenade")) icons.push("S");
    else if (w.name.endsWith("hegrenade")) icons.push("HE");
    else if (w.name.endsWith("molotov") || w.name.endsWith("incgrenade"))
      icons.push("M");
    else if (w.name.endsWith("decoy")) icons.push("D");
  }
  return icons;
}
</script>

<template>
  <div
    class="overlay-root"
    :class="[
      `overlay-${layout}`,
      { 'overlay-debug': debug },
      { 'overlay-empty': !state?.gsi },
    ]"
  >
    <!-- Custom HUD layout via iframe -->
    <iframe
      v-if="customLayoutSlug"
      :src="`/overlay/hud/preview?layout=${encodeURIComponent(customLayoutSlug)}`"
      class="absolute inset-0 w-full h-full border-0"
      style="background: transparent"
    />

    <!-- ───────────────────────── GAME-VIEW ──────────────────────── -->
    <template v-else-if="layout === 'game'">
      <header class="game-scoreboard">
        <div class="team team-ct">
          <span class="team-name">{{ ctTeamName }}</span>
          <span class="team-score">{{ ctScore }}</span>
        </div>
        <div class="round-divider">
          <span class="round-no">
            {{ roundNumber !== null ? `R${roundNumber}` : "—" }}
          </span>
          <span v-if="phaseLabel" class="phase-label">{{ phaseLabel }}</span>
          <span
            v-if="phaseSecondsLeft !== null"
            class="phase-countdown"
            >{{ formatSeconds(phaseSecondsLeft) }}</span
          >
        </div>
        <div class="team team-t">
          <span class="team-score">{{ tScore }}</span>
          <span class="team-name">{{ tTeamName }}</span>
        </div>
      </header>

      <div
        v-if="bombCountdownSeconds !== null"
        class="bomb-banner"
        :class="{ defusing: state?.gsi?.bomb_state === 'defusing' }"
      >
        <span class="bomb-label">{{
          state?.gsi?.bomb_state === "defusing" ? "DEFUSING" : "BOMB"
        }}</span>
        <span class="bomb-time">{{ formatSeconds(bombCountdownSeconds) }}</span>
      </div>

      <footer v-if="mapName" class="map-name">{{ mapName }}</footer>
    </template>

    <!-- ─────────────────────── OPERATOR-VIEW ────────────────────── -->
    <template v-else-if="layout === 'operator'">
      <header class="op-header">
        <div class="op-team">
          <span class="op-team-name">{{ ctTeamName }}</span>
          <span class="op-team-score">{{ ctScore }}</span>
        </div>
        <div class="op-center">
          <span class="op-round">
            Round
            <strong>{{ roundNumber !== null ? roundNumber : "—" }}</strong>
          </span>
          <span v-if="phaseLabel" class="op-phase">{{ phaseLabel }}</span>
          <span
            v-if="phaseSecondsLeft !== null"
            class="op-countdown"
            >{{ formatSeconds(phaseSecondsLeft) }}</span
          >
          <span v-if="mapName" class="op-map">{{ mapName }}</span>
        </div>
        <div class="op-team">
          <span class="op-team-score">{{ tScore }}</span>
          <span class="op-team-name">{{ tTeamName }}</span>
        </div>
      </header>

      <section class="op-economy">
        <div class="op-eco op-eco-ct">
          <h3>{{ ctTeamName }}</h3>
          <div class="op-eco-row">
            <span class="op-eco-label">Bank</span>
            <span class="op-eco-val">{{
              formatMoney(teamEconomyTotal(ctSlots))
            }}</span>
          </div>
          <div class="op-eco-row">
            <span class="op-eco-label">Equip</span>
            <span class="op-eco-val">{{
              formatMoney(teamEquipTotal(ctSlots))
            }}</span>
          </div>
        </div>
        <div class="op-eco op-eco-t">
          <h3>{{ tTeamName }}</h3>
          <div class="op-eco-row">
            <span class="op-eco-label">Bank</span>
            <span class="op-eco-val">{{
              formatMoney(teamEconomyTotal(tSlots))
            }}</span>
          </div>
          <div class="op-eco-row">
            <span class="op-eco-label">Equip</span>
            <span class="op-eco-val">{{
              formatMoney(teamEquipTotal(tSlots))
            }}</span>
          </div>
        </div>
      </section>

      <section class="op-rosters">
        <div class="op-roster op-roster-ct">
          <ul>
            <li
              v-for="p in ctSlots"
              :key="p.steam_id"
              :class="{ dead: !p.alive }"
            >
              <span class="op-name">{{ p.name ?? p.steam_id }}</span>
              <span class="op-money">{{ formatMoney(p.money) }}</span>
              <span class="op-equip">{{ formatMoney(p.equip_value) }}</span>
              <span class="op-weapon">{{ primaryWeapon(p) }}</span>
              <span class="op-grenades">
                <span
                  v-for="(g, i) in grenadeIcons(p)"
                  :key="i"
                  class="op-grenade-icon"
                  >{{ g }}</span
                >
              </span>
              <span class="op-stats"
                >{{ p.kills }}/{{ p.assists }}/{{ p.deaths }}</span
              >
            </li>
          </ul>
        </div>
        <div class="op-roster op-roster-t">
          <ul>
            <li
              v-for="p in tSlots"
              :key="p.steam_id"
              :class="{ dead: !p.alive }"
            >
              <span class="op-name">{{ p.name ?? p.steam_id }}</span>
              <span class="op-money">{{ formatMoney(p.money) }}</span>
              <span class="op-equip">{{ formatMoney(p.equip_value) }}</span>
              <span class="op-weapon">{{ primaryWeapon(p) }}</span>
              <span class="op-grenades">
                <span
                  v-for="(g, i) in grenadeIcons(p)"
                  :key="i"
                  class="op-grenade-icon"
                  >{{ g }}</span
                >
              </span>
              <span class="op-stats"
                >{{ p.kills }}/{{ p.assists }}/{{ p.deaths }}</span
              >
            </li>
          </ul>
        </div>
      </section>
    </template>

    <!-- ─────────────────────── VETO-VIEW ───────────────────────── -->
    <template v-else-if="layout === 'veto'">
      <div class="veto-overlay" :class="{ 'veto-active': vetoActive }">
        <div class="veto-header">
          <div class="veto-team veto-team-1">
            <img
              v-if="team1Logo"
              :src="team1Logo"
              class="veto-team-logo"
              alt=""
            />
            <span class="veto-team-name">{{ team1Name }}</span>
          </div>
          <div class="veto-vs">VETO</div>
          <div class="veto-team veto-team-2">
            <span class="veto-team-name">{{ team2Name }}</span>
            <img
              v-if="team2Logo"
              :src="team2Logo"
              class="veto-team-logo"
              alt=""
            />
          </div>
        </div>

        <div class="veto-grid">
          <div
            v-for="pick in vetoPicks"
            :key="pick.id"
            class="veto-card"
            :class="{
              'veto-pick': pick.type === 'pick',
              'veto-ban': pick.type === 'ban',
            }"
          >
            <div class="veto-card-order">#{{ pick.order }}</div>
            <div class="veto-card-type">
              {{ pick.type === "pick" ? "PICK" : "BAN" }}
            </div>
            <div class="veto-card-map">{{ pick.map?.name ?? "—" }}</div>
            <div class="veto-card-team">
              {{ pick.lineup?.team?.name ?? "" }}
            </div>
          </div>
          <div
            v-if="!vetoPicks.length"
            class="veto-empty"
          >
            {{ vetoActive ? "Waiting for veto to start…" : "Veto phase" }}
          </div>
        </div>
      </div>
    </template>

    <!-- ─────────────────────── FREEZE-TIME-VIEW ──────────────────── -->
    <template v-else-if="layout === 'freeze'">
      <div
        v-if="state?.gsi?.phase === 'freezetime'"
        class="freeze-overlay"
      >
        <header class="freeze-header">
          <div class="freeze-team freeze-team-ct">
            <span class="freeze-team-name">{{ ctTeamName }}</span>
            <span class="freeze-team-score">{{ ctScore }}</span>
          </div>
          <div class="freeze-round-box">
            <span class="freeze-round-label">
              {{ roundNumber !== null ? `Round ${roundNumber}` : "Freeze" }}
            </span>
            <span v-if="phaseSecondsLeft !== null" class="freeze-countdown">
              {{ formatSeconds(phaseSecondsLeft) }}
            </span>
          </div>
          <div class="freeze-team freeze-team-t">
            <span class="freeze-team-score">{{ tScore }}</span>
            <span class="freeze-team-name">{{ tTeamName }}</span>
          </div>
        </header>
        <section class="freeze-economy">
          <div class="freeze-eco-side freeze-eco-ct">
            <div class="freeze-eco-total">
              Bank: {{ formatMoney(teamEconomyTotal(ctSlots)) }} · Equip:
              {{ formatMoney(teamEquipTotal(ctSlots)) }}
            </div>
            <div
              v-for="p in ctSlots"
              :key="p.steam_id"
              class="freeze-eco-player"
              :class="{ dead: !p.alive }"
            >
              <span class="freeze-pname">{{ p.name ?? p.steam_id }}</span>
              <span class="freeze-pmoney">{{ formatMoney(p.money) }}</span>
              <span class="freeze-pweapon">{{ primaryWeapon(p) }}</span>
            </div>
          </div>
          <div class="freeze-eco-side freeze-eco-t">
            <div class="freeze-eco-total">
              Bank: {{ formatMoney(teamEconomyTotal(tSlots)) }} · Equip:
              {{ formatMoney(teamEquipTotal(tSlots)) }}
            </div>
            <div
              v-for="p in tSlots"
              :key="p.steam_id"
              class="freeze-eco-player"
              :class="{ dead: !p.alive }"
            >
              <span class="freeze-pname">{{ p.name ?? p.steam_id }}</span>
              <span class="freeze-pmoney">{{ formatMoney(p.money) }}</span>
              <span class="freeze-pweapon">{{ primaryWeapon(p) }}</span>
            </div>
          </div>
        </section>
      </div>
      <!-- When not in freeze phase, show a minimal scoreboard -->
      <header v-else class="game-scoreboard">
        <div class="team team-ct">
          <span class="team-name">{{ ctTeamName }}</span>
          <span class="team-score">{{ ctScore }}</span>
        </div>
        <div class="round-divider">
          <span class="round-no">
            {{ roundNumber !== null ? `R${roundNumber}` : "—" }}
          </span>
          <span v-if="phaseLabel" class="phase-label">{{ phaseLabel }}</span>
        </div>
        <div class="team team-t">
          <span class="team-score">{{ tScore }}</span>
          <span class="team-name">{{ tTeamName }}</span>
        </div>
      </header>
    </template>

    <!-- ─────────────────────── TRANSITION OVERLAY ──────────── -->
    <template v-else-if="layout === 'transition'">
      <Transition name="stinger">
        <div
          v-if="showTransition"
          class="transition-stinger"
          :key="transitionTrigger"
        >
          <div class="transition-content">
            <div class="transition-phase">{{ phaseLabel ?? "transition" }}</div>
            <div class="transition-teams">
              <span>{{ ctTeamName }}</span>
              <span class="transition-score">{{ ctScore }}</span>
              <span class="transition-dash">–</span>
              <span class="transition-score">{{ tScore }}</span>
              <span>{{ tTeamName }}</span>
            </div>
          </div>
        </div>
      </Transition>
      <!-- Always-visible minimal scoreboard during transition -->
      <header class="game-scoreboard">
        <div class="team team-ct">
          <span class="team-name">{{ ctTeamName }}</span>
          <span class="team-score">{{ ctScore }}</span>
        </div>
        <div class="round-divider">
          <span class="round-no">
            {{ roundNumber !== null ? `R${roundNumber}` : "—" }}
          </span>
          <span v-if="phaseLabel" class="phase-label">{{ phaseLabel }}</span>
        </div>
        <div class="team team-t">
          <span class="team-score">{{ tScore }}</span>
          <span class="team-name">{{ tTeamName }}</span>
        </div>
      </header>
    </template>

    <div v-if="debug" class="debug-pre">
      <div>matchId: {{ matchId }} layout: {{ layout }}</div>
      <div>
        gsi-fresh: {{ !!state?.gsi }} match: {{ state?.match?.status ?? "—" }}
      </div>
      <pre>{{ JSON.stringify(state, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
/* Full-bleed transparent canvas. OBS Browser Source ignores body
   padding but the wrapper must be 100% to fill the configured
   1920x1080 source size. */
.overlay-root {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  background: transparent;
  color: white;
  font-family: "Inter", system-ui, sans-serif;
  pointer-events: none;
  user-select: none;
  z-index: 0;
}
.overlay-debug {
  outline: 2px dashed rgba(255, 200, 0, 0.5);
}
.overlay-empty::before {
  content: "waiting for game state…";
  position: absolute;
  top: 1rem;
  left: 1rem;
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  font-family: monospace;
}

/* ─────────────────────── GAME-VIEW ──────────────────────── */
.game-scoreboard {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 1rem;
  background: rgba(0, 0, 0, 0.7);
  padding: 0.5rem 1.5rem;
  border-radius: 8px;
  backdrop-filter: blur(4px);
  font-weight: 700;
}
.team {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 12rem;
}
.team-ct {
  justify-content: flex-end;
}
.team-t {
  justify-content: flex-start;
}
.team-name {
  font-size: 1rem;
  letter-spacing: 0.05em;
}
.team-ct .team-name {
  color: hsl(212 100% 70%);
}
.team-t .team-name {
  color: hsl(45 100% 65%);
}
.team-score {
  font-size: 1.6rem;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}
.round-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 1rem;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
  border-right: 1px solid rgba(255, 255, 255, 0.15);
}
.round-no {
  font-size: 0.8rem;
  letter-spacing: 0.15em;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
}
.phase-label {
  font-size: 0.7rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}
.phase-countdown {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 1.2rem;
}
.bomb-banner {
  position: absolute;
  top: 5.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: rgba(190, 30, 30, 0.85);
  color: white;
  padding: 0.4rem 1.2rem;
  border-radius: 6px;
  font-weight: 800;
}
.bomb-banner.defusing {
  background: rgba(40, 130, 200, 0.85);
}
.bomb-label {
  letter-spacing: 0.2em;
  font-size: 0.7rem;
}
.bomb-time {
  font-variant-numeric: tabular-nums;
  font-size: 1.2rem;
}
.map-name {
  position: absolute;
  bottom: 0.8rem;
  right: 1rem;
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  font-family: monospace;
  background: rgba(0, 0, 0, 0.5);
  padding: 0.3rem 0.7rem;
  border-radius: 4px;
}

/* ─────────────────────── OPERATOR-VIEW ────────────────────── */
.op-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  background: linear-gradient(
    90deg,
    rgba(0, 80, 160, 0.92) 0%,
    rgba(0, 0, 0, 0.92) 50%,
    rgba(160, 80, 0, 0.92) 100%
  );
  padding: 1rem 2rem;
  font-size: 1.4rem;
  font-weight: 700;
}
.op-team {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.op-team:first-child {
  justify-content: flex-end;
}
.op-team-score {
  font-size: 2.4rem;
  font-variant-numeric: tabular-nums;
}
.op-team-name {
  font-size: 1.4rem;
  letter-spacing: 0.05em;
}
.op-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 2rem;
}
.op-round {
  font-size: 1rem;
  letter-spacing: 0.15em;
}
.op-phase {
  font-size: 0.85rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  opacity: 0.7;
}
.op-countdown {
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}
.op-map {
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-family: monospace;
  opacity: 0.5;
  margin-top: 0.3rem;
}
.op-economy {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1rem 2rem;
  background: rgba(0, 0, 0, 0.7);
}
.op-eco {
  background: rgba(255, 255, 255, 0.05);
  padding: 0.7rem 1rem;
  border-radius: 6px;
}
.op-eco h3 {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.op-eco-ct h3 {
  color: hsl(212 100% 70%);
}
.op-eco-t h3 {
  color: hsl(45 100% 65%);
}
.op-eco-row {
  display: flex;
  justify-content: space-between;
  font-variant-numeric: tabular-nums;
  font-size: 1rem;
  margin-bottom: 0.2rem;
}
.op-eco-label {
  color: rgba(255, 255, 255, 0.55);
}
.op-rosters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1rem 2rem;
  background: rgba(0, 0, 0, 0.65);
}
.op-roster ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.op-roster li {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1.4fr 1.2fr 1fr;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0.7rem;
  border-radius: 4px;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}
.op-roster li.dead {
  opacity: 0.4;
  text-decoration: line-through;
}
.op-roster-ct li {
  background: rgba(0, 80, 160, 0.18);
}
.op-roster-t li {
  background: rgba(160, 80, 0, 0.18);
}
.op-name {
  font-weight: 700;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.op-money {
  color: hsl(120 60% 65%);
}
.op-equip {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.85rem;
}
.op-weapon {
  letter-spacing: 0.05em;
}
.op-grenades {
  display: flex;
  gap: 0.2rem;
}
.op-grenade-icon {
  font-size: 0.7rem;
  background: rgba(255, 255, 255, 0.15);
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
}
.op-stats {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.65);
}

/* Debug panel */
.debug-pre {
  position: absolute;
  bottom: 0;
  left: 0;
  font-family: monospace;
  font-size: 0.65rem;
  color: rgba(255, 200, 0, 0.7);
  background: rgba(0, 0, 0, 0.5);
  max-width: 36rem;
  max-height: 12rem;
  overflow: auto;
  padding: 0.4rem;
}

/* ─────────────────── VETO-VIEW ─────────────────── */
.veto-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  padding: 4rem 6rem;
  background: rgba(0, 0, 0, 0.78);
  pointer-events: none;
}
.veto-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3rem;
  width: 100%;
  border-bottom: 2px solid rgba(255, 255, 255, 0.15);
  padding-bottom: 1.5rem;
}
.veto-team {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.veto-team-logo {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  object-fit: contain;
}
.veto-team-name {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.veto-vs {
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: 0.3em;
  color: rgba(255, 255, 255, 0.6);
}
.veto-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  width: 100%;
  max-width: 1000px;
}
.veto-card {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.veto-card.veto-pick {
  border-color: rgba(34, 197, 94, 0.7);
  background: rgba(34, 197, 94, 0.08);
}
.veto-card.veto-ban {
  border-color: rgba(239, 68, 68, 0.7);
  background: rgba(239, 68, 68, 0.08);
}
.veto-card-order {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.1em;
}
.veto-card-type {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.15em;
}
.veto-pick .veto-card-type {
  color: rgb(74, 222, 128);
}
.veto-ban .veto-card-type {
  color: rgb(248, 113, 113);
}
.veto-card-map {
  font-size: 1.15rem;
  font-weight: 600;
  margin-top: 0.25rem;
}
.veto-card-team {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
}
.veto-empty {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.5);
  padding: 2rem;
}
.veto-active .veto-vs {
  color: rgba(255, 255, 255, 0.9);
  animation: veto-pulse 2s ease-in-out infinite;
}
@keyframes veto-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* ─────────────────── FREEZE-TIME-VIEW ─────────────────── */
.freeze-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem 3rem;
  background: rgba(0, 0, 0, 0.65);
}
.freeze-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}
.freeze-team {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.4rem;
  font-weight: 700;
}
.freeze-team-name { letter-spacing: 0.04em; }
.freeze-team-score {
  font-size: 2rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.freeze-round-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}
.freeze-round-label {
  font-size: 0.9rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
}
.freeze-countdown {
  font-size: 1.6rem;
  font-weight: 800;
  color: rgb(250, 204, 21);
  font-variant-numeric: tabular-nums;
}
.freeze-economy {
  display: flex;
  justify-content: space-between;
  gap: 3rem;
}
.freeze-eco-side {
  flex: 1;
  max-width: 45%;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.freeze-eco-total {
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 0.5rem;
}
.freeze-eco-ct .freeze-eco-total { border-left: 3px solid rgb(96, 165, 250); }
.freeze-eco-t .freeze-eco-total { border-left: 3px solid rgb(248, 113, 113); }
.freeze-eco-player {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.5rem;
  font-size: 0.8rem;
  padding: 0.2rem 0.4rem;
  align-items: center;
}
.freeze-eco-player.dead { opacity: 0.4; }
.freeze-pname {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.freeze-pmoney {
  color: rgb(74, 222, 128);
  font-variant-numeric: tabular-nums;
}
.freeze-pweapon {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.75rem;
}

/* ─────────────────── TRANSITION-VIEW ─────────────────── */
.transition-stinger {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  z-index: 5;
}
.transition-content {
  text-align: center;
  padding: 2rem 4rem;
}
.transition-phase {
  font-size: 2.4rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin-bottom: 1rem;
}
.transition-teams {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 1.5rem;
  font-weight: 600;
  justify-content: center;
}
.transition-score {
  font-size: 2rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.transition-dash {
  color: rgba(255, 255, 255, 0.4);
  font-size: 1.5rem;
}
.stinger-enter-active,
.stinger-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.stinger-enter-from,
.stinger-leave-to {
  opacity: 0;
  transform: scale(1.05);
}
</style>
