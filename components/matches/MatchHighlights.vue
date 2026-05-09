<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Loader2, Swords, Trophy, Skull } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const props = defineProps<{
  matchId: string;
}>();

interface Highlight {
  id: string;
  round_number: number;
  steam_id: string;
  player_name: string | null;
  team: string | null;
  kills: number;
  label: string;
  weapon: string | null;
  created_at: string;
}

const apiBase = computed(() =>
  String(useRuntimeConfig().public.apiDomain ?? "").replace(/\/$/, ""),
);

const highlights = ref<Highlight[]>([]);
const loading = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    const res = await fetch(
      `${apiBase.value}/matches/${props.matchId}/highlights`,
      { credentials: "include" },
    );
    if (!res.ok) return;
    highlights.value = (await res.json()) as Highlight[];
  } catch {
    // non-fatal
  }
}

function labelBadgeVariant(label: string) {
  switch (label) {
    case "ace":
      return "destructive";
    case "4k":
      return "destructive";
    case "3k":
      return "default";
    default:
      return "secondary";
  }
}

function labelText(h: Highlight) {
  const map: Record<string, string> = {
    ace: "ACE",
    "4k": "4K",
    "3k": "3K",
    "2k": "2K",
    knife: "KNIFE",
    grenade: "GRENADE",
    noscope: "NO SCOPE",
    wallbang: "WALLBANG",
  };
  return map[h.label] ?? h.label.toUpperCase();
}

onMounted(async () => {
  loading.value = true;
  await refresh();
  loading.value = false;
  pollTimer = setInterval(refresh, 10_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <Card v-if="loading || highlights.length > 0">
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-base">
        <Swords class="h-4 w-4" />
        Round Highlights
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div v-if="loading" class="flex justify-center py-6">
        <Loader2 class="h-5 w-5 animate-spin" />
      </div>
      <div v-else class="flex flex-col gap-1.5">
        <div
          v-for="h in highlights"
          :key="h.id"
          class="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
        >
          <Badge :variant="labelBadgeVariant(h.label)" class="shrink-0">
            {{ labelText(h) }}
          </Badge>
          <span class="font-medium">
            {{ h.player_name ?? h.steam_id }}
          </span>
          <span class="text-muted-foreground">
            {{ h.kills }}K &middot; R{{ h.round_number + 1 }}
          </span>
          <Badge
            v-if="h.team"
            :variant="h.team === 'CT' ? 'outline' : 'secondary'"
            class="ml-auto shrink-0 text-xs"
          >
            {{ h.team }}
          </Badge>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
