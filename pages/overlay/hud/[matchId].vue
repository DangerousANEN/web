<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";

// OBS Browser Source HUD overlay. Two layouts on the same route:
//   ?layout=game     — drawn over the cs2 game footage during play
//   ?layout=operator — drawn over the operator-cam scene between rounds
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
const layout = computed(() => {
  const v = String(route.query.layout ?? "game").toLowerCase();
  return v === "operator" ? "operator" : "game";
});
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

interface OverlayState {
  match: {
    id: string;
    status: string;
    current_match_map_id?: string | null;
    options?: { type?: string | null } | null;
    lineup_1?: { name?: string | null } | null;
    lineup_2?: { name?: string | null } | null;
    match_maps?: Array<{
      id: string;
      order: number | null;
      status: string;
      map?: { name?: string | null } | null;
      lineup_1_score?: number | null;
      lineup_2_score?: number | null;
    }>;
  } | null;
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
    <!-- ───────────────────────── GAME-VIEW ──────────────────────── -->
    <template v-if="layout === 'game'">
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
    <template v-else>
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
</style>
