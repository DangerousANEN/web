import { ref, watch, type ComputedRef } from "vue";

// Grenade cam watcher — observes the live GSI stream and, when a player
// equips a grenade (especially a smoke or flashbang), surfaces that slot
// so the stream-deck's auto-director can spec to it.
//
// The streamer pod's spec server already exposes `spec_players_ext` with
// `active_weapon` and `weapons` per slot. This composable polls
// `/overlay/state/:matchId` (no-auth, low overhead) and tracks:
//   - the current "grenade holder" slot (player who just switched to
//     a nade in the last N ms)
//   - a "grenade event" pulse the UI can flash on
//
// Used by the operator to catch lineup grenades (smokes, flashes, mollies)
// for the broadcast cut without staring at the buy menu.

const NADE_WEAPONS = new Set([
  "weapon_smokegrenade",
  "weapon_flashbang",
  "weapon_hegrenade",
  "weapon_molotov",
  "weapon_incgrenade",
  // decoy is technically a grenade but rarely broadcast-relevant
]);

const NADE_HOLD_MS = 4000;

export interface GrenadeEvent {
  steam_id: string;
  name: string | null;
  team: "T" | "CT" | null;
  slot: number;
  weapon: string;
  at: number;
}

export function useGrenadeWatcher(
  matchId: ComputedRef<string | null | undefined>,
  enabled: ComputedRef<boolean>,
  pollIntervalMs = 500,
) {
  const grenadeHolder = ref<GrenadeEvent | null>(null);
  const recentNades = ref<GrenadeEvent[]>([]);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastSeen = new Map<string, string>(); // steam_id → active_weapon

  async function poll() {
    const id = matchId.value;
    if (!id || !enabled.value) return;
    try {
      const apiBase = String(
        useRuntimeConfig().public.apiDomain ?? "",
      ).replace(/\/$/, "");
      if (!apiBase) return;
      const res = await fetch(`${apiBase}/overlay/state/${id}`);
      if (!res.ok) return;
      const body = await res.json() as any;
      const players: any[] = body?.gsi?.spec_players_ext ?? [];
      const now = Date.now();
      for (const p of players) {
        const prev = lastSeen.get(p.steam_id);
        const curr = p.active_weapon ?? null;
        if (
          curr &&
          NADE_WEAPONS.has(curr) &&
          prev !== curr
        ) {
          const evt: GrenadeEvent = {
            steam_id: p.steam_id,
            name: p.name ?? null,
            team: p.team ?? null,
            slot: p.slot,
            weapon: curr,
            at: now,
          };
          grenadeHolder.value = evt;
          recentNades.value = [
            evt,
            ...recentNades.value.filter(
              (e) => e.steam_id !== p.steam_id,
            ),
          ].slice(0, 5);
        }
        if (curr !== undefined) lastSeen.set(p.steam_id, curr);
      }
      // Decay grenadeHolder after NADE_HOLD_MS
      if (
        grenadeHolder.value &&
        now - grenadeHolder.value.at > NADE_HOLD_MS
      ) {
        // Check if the holder still has the nade equipped
        const holder = players.find(
          (p) => p.steam_id === grenadeHolder.value!.steam_id,
        );
        if (
          !holder ||
          !NADE_WEAPONS.has(holder.active_weapon ?? "")
        ) {
          grenadeHolder.value = null;
        } else {
          // Refresh timestamp
          grenadeHolder.value = { ...grenadeHolder.value, at: now };
        }
      }
    } catch {
      // ignore — next tick
    }
  }

  function start() {
    stop();
    void poll();
    pollTimer = setInterval(poll, pollIntervalMs);
  }
  function stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  watch(
    [enabled, matchId],
    ([en, id]) => {
      if (en && id) start();
      else stop();
    },
    { immediate: true },
  );

  return {
    grenadeHolder,
    recentNades,
    stop,
  };
}
