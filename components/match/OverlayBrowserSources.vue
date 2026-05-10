<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { Copy, Check, Plus, Trash2, Loader2 } from "lucide-vue-next";
import { useApolloClient } from "@vue/apollo-composable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { generateMutation } from "~/graphql/graphqlGen";

// Per-match OBS Browser Source manager. Each "slot" is a named
// configuration (slot_key + label + hud_id) that maps to a unique
// overlay URL `/overlay/hud/<matchId>?slot=<slot_key>`. Operators
// add one slot per OBS scene that needs its own HUD layout (e.g.
// `game`, `operator`, `intermission`, ...). Slot list is unlimited
// — there's no hard-coded "game/operator" pair anymore.
//
// Why a separate browser-source-side endpoint instead of the SSO
// GraphQL: OBS Browser Source can't carry the SSO cookie reliably,
// so the public `/overlay/state/<id>` endpoint backs both URL copy
// and the slot manager preview here.

const props = defineProps<{
  matchId: string;
  canEdit?: boolean;
}>();

interface Hud {
  id: string;
  name: string;
  slug: string;
  format?: string | null;
  is_default?: boolean;
  is_public?: boolean;
}

interface Slot {
  id: string;
  slot_key: string;
  label: string | null;
  hud_id: string | null;
  display_order: number;
  hud?: { id: string; slug: string | null; name: string | null } | null;
}

const SENTINEL_DEFAULT = "__default__";
const SUGGESTED_KEYS: { key: string; label: string }[] = [
  { key: "game", label: "Game view" },
  { key: "operator", label: "Operator view" },
];

const webDomain = computed(() => {
  const raw = String(useRuntimeConfig().public.webDomain ?? "").replace(
    /\/$/,
    "",
  );
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw) return `https://${raw}`;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
});

const apiBase = computed(() => {
  const raw = String(useRuntimeConfig().public.apiDomain ?? "").replace(
    /\/$/,
    "",
  );
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
});

const slots = ref<Slot[]>([]);
const huds = ref<Hud[]>([]);
const loading = ref(false);
const savingKey = ref<string | null>(null);
const copiedKey = ref<string | null>(null);

const newSlotKey = ref("");
const newSlotLabel = ref("");
const newSlotHudId = ref<string>(SENTINEL_DEFAULT);
const adding = ref(false);

let pollTimer: number | undefined;

function urlFor(slotKey: string) {
  return `${webDomain.value}/overlay/hud/${props.matchId}?slot=${encodeURIComponent(
    slotKey,
  )}`;
}

async function copy(key: string, url: string) {
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

async function loadHuds() {
  if (!apiBase.value) return;
  try {
    const res = await fetch(`${apiBase.value}/huds`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`huds: ${res.status}`);
    huds.value = (await res.json()) as Hud[];
  } catch (e) {
    console.error("[overlay] failed to load HUDs", e);
  }
}

async function loadSlots() {
  if (!apiBase.value) return;
  try {
    const res = await fetch(
      `${apiBase.value}/overlay/state/${props.matchId}`,
      { credentials: "include" },
    );
    if (!res.ok) throw new Error(`overlay state: ${res.status}`);
    const body = (await res.json()) as { overlay_huds?: Slot[] };
    slots.value = (body.overlay_huds ?? []).slice().sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return a.slot_key.localeCompare(b.slot_key);
    });
  } catch (e) {
    console.error("[overlay] failed to load slots", e);
  }
}

async function load() {
  loading.value = true;
  try {
    await Promise.all([loadHuds(), loadSlots()]);
  } finally {
    loading.value = false;
  }
}

function normalizeSlotKey(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

function isValidSlotKey(raw: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(raw);
}

const { client: apolloClient } = useApolloClient();

async function callUpsert(
  slotKey: string,
  label: string | null,
  hudId: string | null,
  displayOrder: number,
) {
  // The Hasura Action returns the full slot row; we re-pull the
  // public list afterwards rather than mutating client state in
  // place because an existing row's `id` doesn't appear in the
  // call args.
  await apolloClient.mutate({
    mutation: generateMutation({
      upsertMatchOverlayHud: [
        {
          match_id: props.matchId,
          slot_key: slotKey,
          label,
          hud_id: hudId,
          display_order: displayOrder,
        },
        {
          id: true,
          slot_key: true,
          label: true,
          hud_id: true,
          display_order: true,
        },
      ],
    }),
  });
}

async function callDelete(slotKey: string) {
  await apolloClient.mutate({
    mutation: generateMutation({
      deleteMatchOverlayHud: [
        { match_id: props.matchId, slot_key: slotKey },
        { success: true },
      ],
    }),
  });
}

async function persistSlot(slot: Slot, patch: Partial<Slot>) {
  if (!props.canEdit) return;
  const merged: Slot = { ...slot, ...patch };
  savingKey.value = merged.slot_key;
  try {
    await callUpsert(
      merged.slot_key,
      merged.label,
      merged.hud_id,
      merged.display_order,
    );
    await loadSlots();
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to save overlay slot",
      description: e?.message ?? String(e),
    });
  } finally {
    savingKey.value = null;
  }
}

async function deleteSlot(slot: Slot) {
  if (!props.canEdit) return;
  if (
    typeof window !== "undefined" &&
    !window.confirm(`Remove slot "${slot.slot_key}"?`)
  ) {
    return;
  }
  savingKey.value = slot.slot_key;
  try {
    await callDelete(slot.slot_key);
    await loadSlots();
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to remove overlay slot",
      description: e?.message ?? String(e),
    });
  } finally {
    savingKey.value = null;
  }
}

async function addSlot() {
  if (!props.canEdit) return;
  const key = normalizeSlotKey(newSlotKey.value);
  if (!isValidSlotKey(key)) {
    toast({
      variant: "destructive",
      title: "Invalid slot key",
      description:
        "1-64 chars, must start with a letter or digit, only a-z 0-9 - _",
    });
    return;
  }
  if (slots.value.some((s) => s.slot_key === key)) {
    toast({
      variant: "destructive",
      title: "Slot already exists",
      description: `Slot "${key}" is already configured.`,
    });
    return;
  }
  adding.value = true;
  try {
    const nextOrder =
      slots.value.length === 0
        ? 0
        : Math.max(...slots.value.map((s) => s.display_order)) + 1;
    await callUpsert(
      key,
      newSlotLabel.value.trim() || null,
      newSlotHudId.value === SENTINEL_DEFAULT ? null : newSlotHudId.value,
      nextOrder,
    );
    newSlotKey.value = "";
    newSlotLabel.value = "";
    newSlotHudId.value = SENTINEL_DEFAULT;
    await loadSlots();
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to add overlay slot",
      description: e?.message ?? String(e),
    });
  } finally {
    adding.value = false;
  }
}

async function quickAddSuggested(key: string, label: string) {
  if (!props.canEdit) return;
  if (slots.value.some((s) => s.slot_key === key)) return;
  adding.value = true;
  try {
    const nextOrder =
      slots.value.length === 0
        ? 0
        : Math.max(...slots.value.map((s) => s.display_order)) + 1;
    await callUpsert(key, label, null, nextOrder);
    await loadSlots();
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to add overlay slot",
      description: e?.message ?? String(e),
    });
  } finally {
    adding.value = false;
  }
}

watch(
  () => props.matchId,
  () => void load(),
);

onMounted(() => {
  void load();
  // Light polling so multiple operators editing the slot list see
  // each other's changes within a few seconds without a websocket
  // wiring round-trip.
  if (typeof window !== "undefined") {
    pollTimer = window.setInterval(() => {
      void loadSlots();
    }, 5000);
  }
});

onBeforeUnmount(() => {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
});

const hasSlots = computed(() => slots.value.length > 0);
</script>

<template>
  <div class="rounded-lg border bg-card p-4 space-y-4">
    <div class="space-y-1">
      <h3 class="text-sm font-semibold leading-none tracking-tight">
        {{ $t("overlay.browser_sources_title") }}
      </h3>
      <p class="text-xs text-muted-foreground">
        {{ $t("overlay.browser_sources_description") }}
      </p>
    </div>

    <div v-if="loading" class="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 class="size-3.5 animate-spin" />
      {{ $t("common.loading") || "Loading..." }}
    </div>

    <div v-else class="space-y-3">
      <div
        v-if="!hasSlots"
        class="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
      >
        {{ $t("overlay.no_slots_hint") }}
        <div v-if="canEdit" class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="suggested in SUGGESTED_KEYS"
            :key="suggested.key"
            type="button"
            class="inline-flex items-center justify-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-2.5"
            :disabled="adding"
            @click="quickAddSuggested(suggested.key, suggested.label)"
          >
            <Plus class="size-3.5 mr-1.5" />
            {{ suggested.key }} ({{ suggested.label }})
          </button>
        </div>
      </div>

      <div v-for="slot in slots" :key="slot.id" class="space-y-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <code
            class="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-mono"
          >
            {{ slot.slot_key }}
          </code>
          <input
            v-if="canEdit"
            class="h-8 px-2 text-xs rounded border border-input bg-background min-w-32 flex-1 max-w-64"
            :placeholder="$t('overlay.slot_label_placeholder')"
            :value="slot.label ?? ''"
            :disabled="savingKey === slot.slot_key"
            @change="
              (event) =>
                persistSlot(slot, {
                  label: (event.target as HTMLInputElement).value || null,
                })
            "
          />
          <span v-else class="text-xs text-muted-foreground">
            {{ slot.label || "—" }}
          </span>
          <Select
            v-if="canEdit"
            :model-value="slot.hud_id ?? SENTINEL_DEFAULT"
            :disabled="savingKey === slot.slot_key"
            @update:model-value="
              (value: any) =>
                persistSlot(slot, {
                  hud_id: value === SENTINEL_DEFAULT ? null : value,
                })
            "
          >
            <SelectTrigger class="h-8 w-56 text-xs">
              <SelectValue
                :placeholder="$t('overlay.hud_placeholder') || 'HUD'"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="SENTINEL_DEFAULT">
                {{ $t("overlay.hud_default") || "Default (built-in)" }}
              </SelectItem>
              <SelectItem v-for="hud in huds" :key="hud.id" :value="hud.id">
                {{ hud.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <span v-else class="text-xs text-muted-foreground">
            {{ slot.hud?.name ?? "Default" }}
          </span>
          <button
            v-if="canEdit"
            type="button"
            class="inline-flex items-center justify-center rounded-md h-8 w-8 text-xs ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-destructive hover:text-destructive-foreground"
            :disabled="savingKey === slot.slot_key"
            :title="$t('common.remove') || 'Remove'"
            @click="deleteSlot(slot)"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
        <div class="flex items-stretch gap-2">
          <code
            class="block flex-1 min-w-0 rounded bg-muted px-2 py-1.5 text-xs font-mono truncate"
            >{{ urlFor(slot.slot_key) }}</code
          >
          <button
            type="button"
            class="self-stretch inline-flex items-center justify-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
            @click="copy(slot.slot_key, urlFor(slot.slot_key))"
          >
            <component
              :is="copiedKey === slot.slot_key ? Check : Copy"
              class="h-3.5 w-3.5 mr-1.5"
            />
            {{
              copiedKey === slot.slot_key
                ? $t("common.copied") || "Copied"
                : $t("common.copy") || "Copy"
            }}
          </button>
        </div>
      </div>

      <div
        v-if="canEdit"
        class="border-t pt-3 mt-2 grid grid-cols-1 md:grid-cols-[8rem_1fr_14rem_auto] gap-2 items-center"
      >
        <input
          v-model="newSlotKey"
          class="h-8 px-2 text-xs rounded border border-input bg-background"
          :placeholder="$t('overlay.slot_key_placeholder') || 'slot_key'"
          :disabled="adding"
          @keydown.enter.prevent="addSlot"
        />
        <input
          v-model="newSlotLabel"
          class="h-8 px-2 text-xs rounded border border-input bg-background"
          :placeholder="$t('overlay.slot_label_placeholder') || 'Label'"
          :disabled="adding"
          @keydown.enter.prevent="addSlot"
        />
        <Select v-model="newSlotHudId" :disabled="adding">
          <SelectTrigger class="h-8 text-xs">
            <SelectValue
              :placeholder="$t('overlay.hud_placeholder') || 'HUD'"
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="SENTINEL_DEFAULT">
              {{ $t("overlay.hud_default") || "Default (built-in)" }}
            </SelectItem>
            <SelectItem v-for="hud in huds" :key="hud.id" :value="hud.id">
              {{ hud.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
          :disabled="adding || !newSlotKey.trim()"
          @click="addSlot"
        >
          <Plus class="size-3.5 mr-1.5" />
          {{ $t("overlay.add_scene") || "Add scene" }}
        </button>
      </div>
    </div>
  </div>
</template>
