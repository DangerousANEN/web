<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import {
  Copy,
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  Search,
  Loader2,
  ExternalLink,
  Plus,
  Trash2,
  GripVertical,
  Monitor,
} from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";

/**
 * MatchHudAssignModal — продвинутая модалка добавления HUD в матч.
 * Содержит двойной explorer:
 *   Левая панель:  доступные HUD layouts (с фильтром по категориям)
 *   Правая панель: выбранные для матча slots (drag-n-drop, reorder)
 * При клике на slot в правой панели — показывает панель свойств:
 *   URL для OBS, параметры slot_key, label, hud_id
 */

const props = defineProps<{
  matchId: string;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "changed"): void;
}>();

interface HudLayout {
  id: string;
  name: string;
  slug: string;
  category: string;
  is_public: boolean;
  is_default: boolean;
}

interface Slot {
  id: string;
  slot_key: string;
  label: string | null;
  hud_id: string | null;
  layout_id: string | null;
  display_order: number;
  hud?: { id: string; slug: string | null; name: string | null } | null;
  layout?: { id: string; slug: string | null; name: string | null } | null;
}

const CATEGORIES = [
  { key: "game", label: "Game" },
  { key: "operator", label: "Operator" },
  { key: "veto", label: "Veto" },
  { key: "freeze", label: "Freeze" },
  { key: "transition", label: "Transition" },
  { key: "casters", label: "Casters" },
  { key: "brackets", label: "Brackets" },
  { key: "grenade-cam", label: "Grenade Cam" },
];

// --- state ---
const layouts = ref<HudLayout[]>([]);
const slots = ref<Slot[]>([]);
const loading = ref(false);
const saving = ref(false);
const searchText = ref("");
const selectedCategory = ref<string>("all");
const selectedLayoutId = ref<string | null>(null);
const selectedSlotKey = ref<string | null>(null);
const copiedUrl = ref<string | null>(null);

// new slot form
const newSlotKey = ref("");
const newSlotLabel = ref("");

// drag state
const draggingSlotKey = ref<string | null>(null);
const dragOverIndex = ref<number | null>(null);

// --- computed ---
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

const filteredLayouts = computed(() => {
  let result = layouts.value;
  if (selectedCategory.value !== "all") {
    result = result.filter((l) => l.category === selectedCategory.value);
  }
  if (searchText.value.trim()) {
    const q = searchText.value.toLowerCase();
    result = result.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.slug.toLowerCase().includes(q),
    );
  }
  return result;
});

const availableLayouts = computed(() => {
  // layouts not yet assigned to any slot
  const usedLayoutIds = new Set(
    slots.value.map((s) => s.layout_id).filter(Boolean) as string[],
  );
  return filteredLayouts.value.filter((l) => !usedLayoutIds.has(l.id));
});

const selectedSlot = computed(() =>
  slots.value.find((s) => s.slot_key === selectedSlotKey.value) ?? null,
);

const slotUrl = computed(() => {
  if (!selectedSlot.value) return "";
  const s = selectedSlot.value;
  // Built-in layouts use ?layout=, custom layouts use ?slot=
  const builtInKeys = [
    "game",
    "operator",
    "veto",
    "freeze",
    "transition",
  ];
  if (builtInKeys.includes(s.slot_key) && !s.hud_id) {
    return `${webDomain.value}/overlay/hud/${props.matchId}?layout=${s.slot_key}`;
  }
  return `${webDomain.value}/overlay/hud/${props.matchId}?slot=${encodeURIComponent(
    s.slot_key,
  )}`;
});

const previewUrl = computed(() => {
  if (!selectedSlot.value) return "";
  return `${slotUrl.value}&debug=1`;
});

// --- methods ---
async function loadLayouts() {
  if (!apiBase.value) return;
  try {
    const res = await fetch(`${apiBase.value}/huds`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`huds: ${res.status}`);
    layouts.value = (await res.json()) as HudLayout[];
  } catch (e) {
    console.error("[hud-assign] failed to load HUDs", e);
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
      if (a.display_order !== b.display_order)
        return a.display_order - b.display_order;
      return a.slot_key.localeCompare(b.slot_key);
    });
  } catch (e) {
    console.error("[hud-assign] failed to load slots", e);
  }
}

async function load() {
  loading.value = true;
  try {
    await Promise.all([loadLayouts(), loadSlots()]);
  } finally {
    loading.value = false;
  }
}

async function assignLayout(layout: HudLayout) {
  // Add a new slot with this layout
  const key =
    layout.slug.replace(/[^a-z0-9_-]/g, "-") || `layout-${layout.id.slice(0, 8)}`;
  if (slots.value.some((s) => s.slot_key === key)) {
    toast({
      variant: "destructive",
      title: "Slot already exists",
      description: `Slot "${key}" is already configured.`,
    });
    return;
  }
  saving.value = true;
  try {
    const nextOrder =
      slots.value.length === 0
        ? 0
        : Math.max(...slots.value.map((s) => s.display_order)) + 1;
    await upsertSlot(key, layout.name, null, layout.id, nextOrder);
    await loadSlots();
    selectedSlotKey.value = key;
    emit("changed");
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to assign HUD",
      description: e?.message ?? String(e),
    });
  } finally {
    saving.value = false;
  }
}

async function addCustomSlot() {
  const key = newSlotKey.value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) {
    toast({
      variant: "destructive",
      title: "Invalid slot key",
      description: "1-64 chars, a-z 0-9 - _",
    });
    return;
  }
  if (slots.value.some((s) => s.slot_key === key)) {
    toast({ variant: "destructive", title: "Slot already exists" });
    return;
  }
  saving.value = true;
  try {
    const nextOrder =
      slots.value.length === 0
        ? 0
        : Math.max(...slots.value.map((s) => s.display_order)) + 1;
    await upsertSlot(key, newSlotLabel.value.trim() || null, null, null, nextOrder);
    newSlotKey.value = "";
    newSlotLabel.value = "";
    await loadSlots();
    selectedSlotKey.value = key;
    emit("changed");
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to add slot",
      description: e?.message ?? String(e),
    });
  } finally {
    saving.value = false;
  }
}

async function removeSlot(slot: Slot) {
  saving.value = true;
  try {
    const { useApolloClient } = await import("@vue/apollo-composable");
    const { client } = useApolloClient();
    const { generateMutation } = await import("~/graphql/graphqlGen");
    await client.mutate({
      mutation: generateMutation({
        deleteMatchOverlayHud: [
          { match_id: props.matchId, slot_key: slot.slot_key },
          { success: true },
        ],
      }),
    });
    if (selectedSlotKey.value === slot.slot_key) selectedSlotKey.value = null;
    await loadSlots();
    emit("changed");
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to remove slot",
      description: e?.message ?? String(e),
    });
  } finally {
    saving.value = false;
  }
}

async function upsertSlot(
  slotKey: string,
  label: string | null,
  hudId: string | null,
  layoutId: string | null,
  displayOrder: number,
) {
  try {
    const { useApolloClient } = await import("@vue/apollo-composable");
    const { client } = useApolloClient();
    const { generateMutation } = await import("~/graphql/graphqlGen");
    await client.mutate({
      mutation: generateMutation({
        upsertMatchOverlayHud: [
          {
            match_id: props.matchId,
            slot_key: slotKey,
            label,
            hud_id: hudId,
            layout_id: layoutId,
            display_order: displayOrder,
          },
          {
            id: true,
            slot_key: true,
            label: true,
            display_order: true,
          },
        ],
      }),
    });
  } catch (e: any) {
    console.error("[hud-assign] upsertSlot failed", e);
    toast({
      variant: "destructive",
      title: "Failed to save slot",
      description: e?.message ?? String(e),
    });
    throw e;
  }
}

// --- drag-n-drop reorder ---
function onDragStart(slotKey: string) {
  draggingSlotKey.value = slotKey;
}

function onDragOver(index: number) {
  dragOverIndex.value = index;
}

function onDragEnd() {
  draggingSlotKey.value = null;
  dragOverIndex.value = null;
}

async function onDrop(targetIndex: number) {
  if (!draggingSlotKey.value) return;
  const draggedSlot = slots.value.find(
    (s) => s.slot_key === draggingSlotKey.value,
  );
  if (!draggedSlot) return;

  // Reorder logic: move dragged slot to target position
  const reordered = [...slots.value];
  const draggedIdx = reordered.findIndex(
    (s) => s.slot_key === draggingSlotKey.value,
  );
  if (draggedIdx === -1 || draggedIdx === targetIndex) return;

  reordered.splice(draggedIdx, 1);
  reordered.splice(targetIndex, 0, draggedSlot);

  // Update display_order for all affected slots
  saving.value = true;
  try {
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].display_order !== i) {
        reordered[i].display_order = i;
        await upsertSlot(
          reordered[i].slot_key,
          reordered[i].label,
          reordered[i].hud_id,
          reordered[i].layout_id,
          i,
        );
      }
    }
    await loadSlots();
    emit("changed");
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to reorder",
      description: e?.message ?? String(e),
    });
  } finally {
    saving.value = false;
    draggingSlotKey.value = null;
    dragOverIndex.value = null;
  }
}

// --- copy URL ---
async function copyUrl(url: string) {
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
    copiedUrl.value = url;
    setTimeout(() => {
      if (copiedUrl.value === url) copiedUrl.value = null;
    }, 1500);
  } catch (err) {
    console.error("[hud-assign] copy failed", err);
  }
}

// --- lifecycle ---
watch(
  () => props.open,
  (v) => {
    if (v) void load();
  },
);

watch(
  () => props.matchId,
  () => {
    if (props.open) void load();
  },
);

onMounted(() => {
  if (props.open) void load();
});
</script>

<template>
  <Dialog
    :open="open"
    @update:open="(v) => emit('update:open', v)"
  >
    <DialogContent class="max-w-5xl !p-0 overflow-hidden">
      <DialogHeader class="px-5 pt-5 pb-3">
        <DialogTitle class="text-base">
          {{ $t("match.hud_assign_title") || "HUD Assignment" }}
        </DialogTitle>
        <DialogDescription class="text-xs">
          {{
            $t("match.hud_assign_description") ||
            "Assign HUD layouts to OBS browser source slots"
          }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="flex items-center justify-center py-12">
        <Loader2 class="size-5 animate-spin text-muted-foreground" />
      </div>

      <div v-else class="flex flex-col" style="height: 70vh">
        <!-- Dual explorer -->
        <div class="flex-1 flex min-h-0">
          <!-- LEFT: Available layouts -->
          <div class="w-1/2 border-r border-border/60 flex flex-col min-h-0">
            <!-- search + filters -->
            <div class="p-2 border-b border-border/40 space-y-2">
              <div class="relative">
                <Search
                  class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
                />
                <Input
                  v-model="searchText"
                  :placeholder="
                    $t('common.search') || 'Search layouts...'
                  "
                  class="h-7 pl-7 text-xs"
                />
              </div>
              <div class="flex flex-wrap gap-1">
                <button
                  type="button"
                  class="px-2 py-0.5 rounded text-[10px] font-medium border transition-colors"
                  :class="{
                    'bg-primary text-primary-foreground border-primary':
                      selectedCategory === 'all',
                    'border-border/40 hover:bg-muted/50':
                      selectedCategory !== 'all',
                  }"
                  @click="selectedCategory = 'all'"
                >
                  All
                </button>
                <button
                  v-for="cat in CATEGORIES"
                  :key="cat.key"
                  type="button"
                  class="px-2 py-0.5 rounded text-[10px] font-medium border transition-colors"
                  :class="{
                    'bg-primary text-primary-foreground border-primary':
                      selectedCategory === cat.key,
                    'border-border/40 hover:bg-muted/50':
                      selectedCategory !== cat.key,
                  }"
                  @click="selectedCategory = cat.key"
                >
                  {{ cat.label }}
                </button>
              </div>
            </div>

            <!-- layout list -->
            <div class="flex-1 overflow-y-auto p-2 space-y-1">
              <div
                v-for="layout in availableLayouts"
                :key="layout.id"
                class="group flex items-center gap-2 p-2 rounded border border-border/40 hover:bg-muted/40 cursor-pointer transition-colors"
                @click="assignLayout(layout)"
              >
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium truncate">
                    {{ layout.name }}
                  </div>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant="outline"
                      class="text-[9px] py-0 px-1"
                    >
                      {{ layout.category }}
                    </Badge>
                    <span class="text-[10px] text-muted-foreground truncate">
                      /{{ layout.slug }}
                    </span>
                  </div>
                </div>
                <ChevronRight
                  class="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>
              <div
                v-if="!availableLayouts.length"
                class="text-xs text-muted-foreground text-center py-4"
              >
                {{
                  $t("match.no_layouts_available") ||
                  "No layouts available (all assigned or filtered out)"
                }}
              </div>
            </div>

            <!-- Add custom slot -->
            <div class="p-2 border-t border-border/40 space-y-2">
              <div class="text-[10px] uppercase tracking-wider text-muted-foreground">
                {{ $t("match.add_custom_slot") || "Add custom slot" }}
              </div>
              <div class="flex gap-2">
                <Input
                  v-model="newSlotKey"
                  placeholder="slot-key (e.g. GrenadeCam)"
                  class="h-7 text-xs flex-1"
                />
                <Input
                  v-model="newSlotLabel"
                  placeholder="Label (optional)"
                  class="h-7 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  :disabled="!newSlotKey.trim() || saving"
                  @click="addCustomSlot"
                >
                  <Plus class="size-3" />
                </Button>
              </div>
            </div>
          </div>

          <!-- RIGHT: Selected slots -->
          <div class="w-1/2 flex flex-col min-h-0">
            <div class="p-2 border-b border-border/40">
              <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground">
                {{
                  $t("match.assigned_slots") || "Assigned to match"
                }}
                ({{ slots.length }})
              </h4>
            </div>

            <div
              v-if="!slots.length"
              class="flex-1 flex items-center justify-center p-4"
            >
              <p class="text-xs text-muted-foreground text-center">
                {{
                  $t("match.no_slots_yet") ||
                  "No HUD slots assigned yet. Click a layout on the left to assign it."
                }}
              </p>
            </div>

            <div v-else class="flex-1 overflow-y-auto p-2 space-y-1">
              <div
                v-for="(slot, idx) in slots"
                :key="slot.id"
                class="flex items-stretch gap-1 group"
                :class="{
                  'opacity-50': draggingSlotKey === slot.slot_key,
                  'border-t-2 border-primary':
                    dragOverIndex === idx && draggingSlotKey !== slot.slot_key,
                }"
                draggable="true"
                @dragstart="onDragStart(slot.slot_key)"
                @dragover.prevent="onDragOver(idx)"
                @dragend="onDragEnd"
                @drop.prevent="onDrop(idx)"
              >
                <!-- drag handle -->
                <div
                  class="flex items-center px-1 cursor-grab text-muted-foreground hover:text-foreground"
                >
                  <GripVertical class="size-3.5" />
                </div>

                <!-- slot info -->
                <button
                  type="button"
                  class="flex-1 text-left p-2 rounded border transition-colors min-w-0"
                  :class="{
                    'border-primary bg-primary/5': selectedSlotKey === slot.slot_key,
                    'border-border/40 hover:bg-muted/40':
                      selectedSlotKey !== slot.slot_key,
                  }"
                  @click="selectedSlotKey = slot.slot_key"
                >
                  <div class="flex items-center gap-2">
                    <Monitor class="size-3.5 text-muted-foreground flex-shrink-0" />
                    <span class="text-xs font-medium truncate flex-1">
                      {{ slot.label || slot.slot_key }}
                    </span>
                    <Badge variant="outline" class="text-[9px] py-0 px-1">
                      #{{ slot.display_order }}
                    </Badge>
                  </div>
                  <div class="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {{ slot.slot_key }}
                    {{
                      slot.hud?.name ? `· ${slot.hud.name}` : ""
                    }}
                  </div>
                </button>

                <!-- delete -->
                <button
                  type="button"
                  class="flex items-center px-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                  :disabled="saving"
                  @click.stop="removeSlot(slot)"
                >
                  <Trash2 class="size-3.5" />
                </button>
              </div>
            </div>

            <!-- URL panel for selected slot -->
            <div
              v-if="selectedSlot"
              class="border-t border-border/60 p-3 bg-card/30 space-y-2 flex-shrink-0"
            >
              <h5 class="text-[10px] uppercase tracking-wider text-muted-foreground">
                {{ $t("match.obs_url") || "OBS Browser Source URL" }}
              </h5>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-[10px] bg-muted/50 px-2 py-1.5 rounded truncate">
                  {{ slotUrl }}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 flex-shrink-0"
                  @click="copyUrl(slotUrl)"
                >
                  <component
                    :is="copiedUrl === slotUrl ? Check : Copy"
                    class="size-3"
                  />
                </Button>
                <a
                  :href="previewUrl"
                  target="_blank"
                  class="inline-flex"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 flex-shrink-0"
                  >
                    <ExternalLink class="size-3" />
                  </Button>
                </a>
              </div>
              <div class="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>
                  {{
                    $t("match.resolution") || "Resolution"
                  }}: 1920×1080
                </span>
                <span>·</span>
                <span>
                  {{
                    $t("match.custom_css") || "Custom CSS"
                  }}: (empty)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
