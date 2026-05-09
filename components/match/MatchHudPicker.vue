<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-vue-next";
import { toast } from "@/components/ui/toast";

const props = defineProps<{
  matchId: string;
  canEdit: boolean;
}>();

interface Hud {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
  is_public: boolean;
}

const apiBase = computed(() => {
  const raw = String(useRuntimeConfig().public.apiDomain ?? "").replace(
    /\/$/,
    "",
  );
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
});
const SENTINEL_DEFAULT = "__default__";

const loading = ref(false);
const saving = ref(false);
const huds = ref<Hud[]>([]);
const selected = ref<string>(SENTINEL_DEFAULT);
const activeName = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    // /huds/match/:id returns ONLY the per-match override (or null) so the
    // dropdown reflects the user's actual pick. /huds/active/:id is the
    // effective resolution (override → default → null) and is what we use
    // to render the inherited fallback name on the Default sentinel item.
    const [hudsRes, overrideRes, activeRes] = await Promise.all([
      fetch(`${apiBase.value}/huds`, { credentials: "include" }),
      fetch(`${apiBase.value}/huds/match/${props.matchId}`, {
        credentials: "include",
      }),
      fetch(`${apiBase.value}/huds/active/${props.matchId}`, {
        credentials: "include",
      }),
    ]);
    if (!hudsRes.ok) throw new Error(`huds: ${hudsRes.status}`);
    huds.value = (await hudsRes.json()) as Hud[];

    if (activeRes.ok) {
      const hud = (await activeRes.json()) as Hud;
      activeName.value = hud.name;
    } else if (activeRes.status === 404) {
      activeName.value = null;
    }

    if (overrideRes.ok) {
      const body = (await overrideRes.json()) as { hud: Hud | null };
      selected.value = body.hud?.id ?? SENTINEL_DEFAULT;
    } else {
      selected.value = SENTINEL_DEFAULT;
    }
  } catch (e) {
    toast({
      title: "Failed to load HUDs",
      description: (e as Error).message,
      variant: "destructive",
    });
  } finally {
    loading.value = false;
  }
}

async function save(value: string) {
  if (!props.canEdit) return;
  saving.value = true;
  try {
    const body = { hud: value === SENTINEL_DEFAULT ? null : value };
    const res = await fetch(
      `${apiBase.value}/huds/match/${props.matchId}`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        credentials: "include",
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    toast({ title: "HUD updated" });
    await load();
  } catch (e) {
    toast({
      title: "Failed to update HUD",
      description: (e as Error).message,
      variant: "destructive",
    });
  } finally {
    saving.value = false;
  }
}

watch(selected, (next) => {
  if (!loading.value) void save(next);
});

onMounted(load);
</script>

<template>
  <div class="flex items-center gap-2 flex-wrap">
    <span class="text-xs uppercase tracking-wider text-muted-foreground">
      Spectator HUD
    </span>
    <Select v-if="canEdit" v-model="selected" :disabled="loading || saving">
      <SelectTrigger class="w-56 h-8">
        <SelectValue placeholder="Loading…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="SENTINEL_DEFAULT">
          Default ({{ activeName ?? "OpenHud built-in" }})
        </SelectItem>
        <SelectItem v-for="hud in huds" :key="hud.id" :value="hud.id">
          {{ hud.name }}<span v-if="hud.is_default"> ★</span>
        </SelectItem>
      </SelectContent>
    </Select>
    <span v-else class="text-sm">
      {{ activeName ?? "Default" }}
    </span>
    <Loader2
      v-if="loading || saving"
      class="size-3.5 animate-spin text-muted-foreground"
    />
  </div>
</template>
