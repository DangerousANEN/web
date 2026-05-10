<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import WhepPlayer from "~/components/match/WhepPlayer.vue";

// OBS Browser Source — bare video feed, zero chrome.
// Usage in OBS: add Browser Source, paste the URL copied from the
// Stream Deck page, size 1920x1080.
//
// The WHEP endpoint is passed as ?whep= so no auth is required
// (OBS can't carry our SSO cookie). The URL is generated on the
// Stream Deck page where the operator is already authenticated.

definePageMeta({
  layout: false,
});

const route = useRoute();
const matchId = computed(() => String(route.params.matchId));

const whepUrl = computed(() => {
  const raw = route.query.whep;
  if (!raw) return null;
  const url = String(raw);
  // Basic sanity — must look like a WHEP endpoint we serve
  try {
    const u = new URL(url);
    if (!u.pathname.endsWith("/whep")) return null;
    return url;
  } catch {
    return null;
  }
});
</script>

<template>
  <div
    class="fixed inset-0 bg-black flex items-center justify-center overflow-hidden"
  >
    <WhepPlayer
      v-if="whepUrl"
      :whep-url="whepUrl"
      :muted="true"
      class="h-full w-full"
    />
    <div
      v-else
      class="text-center font-mono text-xs uppercase tracking-[0.2em] text-white/40"
    >
      <p>No WHEP source</p>
      <p class="mt-1 text-white/25">Copy the OBS URL from the Stream Deck</p>
    </div>
  </div>
</template>
