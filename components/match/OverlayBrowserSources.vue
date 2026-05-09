<script setup lang="ts">
import { computed, ref } from "vue";
import { Copy, Check } from "lucide-vue-next";

// Tournament operators copy these URLs into OBS as "Browser Source"
// inputs. The HUD page itself lives at /overlay/hud/<matchId>?layout=
// game|operator and is publicly accessible (see middleware/
// auth.global.ts + api/overlay.controller.ts).
//
// Two layouts shipped:
//   game     — drawn over the cs2 game footage (top scoreboard +
//              bomb timer + map name)
//   operator — drawn between rounds over operator camera scenes
//              (round timer, score, both-team economy, full buy
//              snapshot per slot)
//
// Suggested OBS settings: Source size 1920x1080, "Refresh browser
// when scene becomes active" checked, "Shutdown when not visible"
// off so the page stays subscribed to GSI updates.

const props = defineProps<{
  matchId: string;
}>();

const webDomain = computed(() => {
  const raw = String(useRuntimeConfig().public.webDomain ?? "").replace(
    /\/$/,
    "",
  );
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw) return `https://${raw}`;
  // Fallback to current origin (covers local dev where webDomain may
  // not be set in runtime config).
  if (typeof window !== "undefined") return window.location.origin;
  return "";
});

const gameUrl = computed(
  () => `${webDomain.value}/overlay/hud/${props.matchId}?layout=game`,
);
const operatorUrl = computed(
  () => `${webDomain.value}/overlay/hud/${props.matchId}?layout=operator`,
);

const copiedKey = ref<string | null>(null);

async function copy(key: "game" | "operator", url: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    copiedKey.value = key;
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1500);
  } catch (err) {
    console.error("[overlay] copy failed", err);
  }
}
</script>

<template>
  <div class="rounded-lg border bg-card p-4 space-y-3">
    <div class="space-y-1">
      <h3 class="text-sm font-semibold leading-none tracking-tight">
        {{ $t("overlay.browser_sources_title") || "OBS Browser Source URLs" }}
      </h3>
      <p class="text-xs text-muted-foreground">
        {{
          $t("overlay.browser_sources_description") ||
          "Paste these URLs into OBS as Browser Source layers (1920x1080) over the game video. The api streamer pod must run with STREAMER_OPENHUD_DISABLED=1 for the raw video feed."
        }}
      </p>
    </div>
    <div class="space-y-2">
      <div class="flex items-stretch gap-2">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium mb-0.5">
            {{ $t("overlay.layout_game") || "Game view (over the match)" }}
          </div>
          <code
            class="block w-full rounded bg-muted px-2 py-1.5 text-xs font-mono truncate"
            >{{ gameUrl }}</code
          >
        </div>
        <button
          type="button"
          class="self-end inline-flex items-center justify-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          @click="copy('game', gameUrl)"
        >
          <component
            :is="copiedKey === 'game' ? Check : Copy"
            class="h-3.5 w-3.5 mr-1.5"
          />
          {{
            copiedKey === "game"
              ? $t("common.copied") || "Copied"
              : $t("common.copy") || "Copy"
          }}
        </button>
      </div>
      <div class="flex items-stretch gap-2">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium mb-0.5">
            {{
              $t("overlay.layout_operator") ||
              "Operator view (between rounds, over camera scenes)"
            }}
          </div>
          <code
            class="block w-full rounded bg-muted px-2 py-1.5 text-xs font-mono truncate"
            >{{ operatorUrl }}</code
          >
        </div>
        <button
          type="button"
          class="self-end inline-flex items-center justify-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          @click="copy('operator', operatorUrl)"
        >
          <component
            :is="copiedKey === 'operator' ? Check : Copy"
            class="h-3.5 w-3.5 mr-1.5"
          />
          {{
            copiedKey === "operator"
              ? $t("common.copied") || "Copied"
              : $t("common.copy") || "Copy"
          }}
        </button>
      </div>
    </div>
  </div>
</template>
