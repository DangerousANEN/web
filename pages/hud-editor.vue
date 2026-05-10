<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useApolloClient } from "@vue/apollo-composable";
import { generateQuery, generateMutation } from "~/graphql/graphqlGen";
import { useToast } from "~/components/ui/toast/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Copy,
  Check,
  Plus,
  Trash2,
  Loader2,
  LayoutTemplate,
  Type,
  Image as ImageIcon,
  Clock,
  Users,
  Trophy,
  Swords,
  Bomb,
  Crosshair,
} from "lucide-vue-next";
import type { ApolloQueryResult } from "@apollo/client";

interface HudLayout {
  id: string;
  name: string;
  slug: string;
  category: string;
  config: Record<string, unknown>;
  is_public: boolean;
  created_by_steam_id: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { key: "game", label: "Game" },
  { key: "operator", label: "Operator" },
  { key: "intermission", label: "Intermission" },
  { key: "casters", label: "Casters" },
  { key: "brackets", label: "Brackets" },
  { key: "veto", label: "Veto" },
  { key: "custom", label: "Custom" },
];

const BLOCK_TYPES = [
  { type: "scoreboard", label: "Scoreboard", icon: Trophy },
  { type: "player-list", label: "Player List", icon: Users },
  { type: "team-banner", label: "Team Banner", icon: Swords },
  { type: "kill-feed", label: "Kill Feed", icon: Crosshair },
  { type: "bomb-timer", label: "Bomb Timer", icon: Bomb },
  { type: "round-info", label: "Round Info", icon: Clock },
  { type: "custom-text", label: "Custom Text", icon: Type },
  { type: "custom-image", label: "Custom Image", icon: ImageIcon },
];

// ---- State ----
const layouts = ref<HudLayout[]>([]);
const selectedLayoutId = ref<string | null>(null);
const loading = ref(false);
const creating = ref(false);

const { toast } = useToast();
const { client: apolloClient } = useApolloClient();

// ---- New layout form ----
const newName = ref("");
const newCategory = ref("game");
const newSlug = computed(() => {
  return newName.value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
});

// ---- Selected layout ----
const selectedLayout = computed(() =>
  layouts.value.find((l) => l.id === selectedLayoutId.value) ?? null,
);

// ---- Canvas state ----
interface BlockConfig {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: Record<string, unknown>;
  data: Record<string, unknown>;
}

const blocks = ref<BlockConfig[]>([]);
const selectedBlockId = ref<string | null>(null);
const draggingBlockId = ref<string | null>(null);
const dragOffset = ref({ x: 0, y: 0 });

const selectedBlock = computed(() =>
  blocks.value.find((b) => b.id === selectedBlockId.value) ?? null,
);

// ---- Load layouts ----
async function loadLayouts() {
  loading.value = true;
  try {
    const result: ApolloQueryResult<{ hud_layouts: HudLayout[] }> =
      await apolloClient.query({
        query: generateQuery({
          hud_layouts: [
            {
              order_by: [{ category: "asc" as const }, { name: "asc" as const }],
            },
            {
              id: true,
              name: true,
              slug: true,
              category: true,
              config: true,
              is_public: true,
              created_by_steam_id: true,
              created_at: true,
              updated_at: true,
            },
          ],
        }),
        fetchPolicy: "network-only",
      });
    layouts.value = result.data.hud_layouts ?? [];
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to load layouts",
      description: e?.message ?? String(e),
    });
  } finally {
    loading.value = false;
  }
}

// ---- Create layout ----
async function createLayout() {
  if (!newName.value.trim()) return;
  creating.value = true;
  try {
    await apolloClient.mutate({
      mutation: generateMutation({
        insert_hud_layouts_one: [
          {
            object: {
              name: newName.value.trim(),
              slug: newSlug.value || `layout-${Date.now()}`,
              category: newCategory.value,
              config: {},
              is_public: false,
            },
          },
          { id: true, name: true, slug: true, category: true },
        ],
      }),
    });
    toast({ title: "Layout created" });
    newName.value = "";
    newCategory.value = "game";
    await loadLayouts();
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to create layout",
      description: e?.message ?? String(e),
    });
  } finally {
    creating.value = false;
  }
}

// ---- Delete layout ----
async function deleteLayout(id: string) {
  if (!confirm("Delete this layout?")) return;
  try {
    await apolloClient.mutate({
      mutation: generateMutation({
        delete_hud_layouts_by_pk: [{ id }, { id: true }],
      }),
    });
    toast({ title: "Layout deleted" });
    if (selectedLayoutId.value === id) {
      selectedLayoutId.value = null;
      blocks.value = [];
    }
    await loadLayouts();
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to delete layout",
      description: e?.message ?? String(e),
    });
  }
}

// ---- Block operations ----
function addBlock(type: string) {
  const id = `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const defaults: Record<string, { width: number; height: number }> = {
    scoreboard: { width: 400, height: 80 },
    "player-list": { width: 300, height: 400 },
    "team-banner": { width: 350, height: 60 },
    "kill-feed": { width: 300, height: 200 },
    "bomb-timer": { width: 200, height: 60 },
    "round-info": { width: 250, height: 50 },
    "custom-text": { width: 200, height: 40 },
    "custom-image": { width: 200, height: 150 },
  };
  const def = defaults[type] ?? { width: 200, height: 100 };
  blocks.value.push({
    id,
    type,
    x: 50 + (blocks.value.length * 20) % 400,
    y: 50 + (blocks.value.length * 20) % 300,
    width: def.width,
    height: def.height,
    style: { backgroundColor: "rgba(0,0,0,0.7)", color: "#fff" },
    data: {},
  });
  selectedBlockId.value = id;
}

function removeBlock(id: string) {
  blocks.value = blocks.value.filter((b) => b.id !== id);
  if (selectedBlockId.value === id) selectedBlockId.value = null;
}

// ---- Drag & drop ----
function onBlockMouseDown(e: MouseEvent, block: BlockConfig) {
  e.stopPropagation();
  selectedBlockId.value = block.id;
  draggingBlockId.value = block.id;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOffset.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function onCanvasMouseMove(e: MouseEvent) {
  if (!draggingBlockId.value) return;
  const canvas = document.getElementById("hud-canvas");
  if (!canvas) return;
  const canvasRect = canvas.getBoundingClientRect();
  const scaleX = 1920 / canvasRect.width;
  const scaleY = 1080 / canvasRect.height;

  const block = blocks.value.find((b) => b.id === draggingBlockId.value);
  if (!block) return;

  const rawX = (e.clientX - canvasRect.left - dragOffset.value.x) * scaleX;
  const rawY = (e.clientY - canvasRect.top - dragOffset.value.y) * scaleY;

  block.x = Math.max(0, Math.min(1920 - block.width, rawX));
  block.y = Math.max(0, Math.min(1080 - block.height, rawY));
}

function onCanvasMouseUp() {
  draggingBlockId.value = null;
}

// ---- Save layout config ----
const saving = ref(false);
async function saveLayout() {
  if (!selectedLayout.value) return;
  saving.value = true;
  try {
    await apolloClient.mutate({
      mutation: generateMutation({
        update_hud_layouts_by_pk: [
          {
            pk_columns: { id: selectedLayout.value.id },
            _set: {
              config: {
                blocks: blocks.value,
              },
            },
          },
          { id: true },
        ],
      }),
    });
    toast({ title: "Layout saved" });
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to save",
      description: e?.message ?? String(e),
    });
  } finally {
    saving.value = false;
  }
}

// ---- Load blocks from layout ----
watch(selectedLayoutId, (id) => {
  const layout = layouts.value.find((l) => l.id === id);
  if (layout?.config?.blocks) {
    blocks.value = JSON.parse(JSON.stringify(layout.config.blocks));
  } else {
    blocks.value = [];
  }
  selectedBlockId.value = null;
});

// ---- Preview URL ----
const previewUrl = computed(() => {
  if (!selectedLayout.value) return null;
  const domain =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${domain}/overlay/hud/preview?layout=${selectedLayout.value.slug}`;
});

const copiedPreview = ref(false);
async function copyPreviewUrl() {
  const url = previewUrl.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    copiedPreview.value = true;
    setTimeout(() => (copiedPreview.value = false), 1500);
  } catch (err) {
    console.error("copy failed", err);
  }
}

onMounted(() => {
  loadLayouts();
});
</script>

<template>
  <div class="h-[calc(100svh-3.5rem)] flex flex-col">
    <!-- Toolbar -->
    <header
      class="h-14 border-b border-border/60 bg-card/40 backdrop-blur-sm flex items-center gap-3 px-4 flex-shrink-0"
    >
      <LayoutTemplate class="size-5 text-[hsl(var(--tac-amber))]" />
      <h1 class="font-display text-sm font-bold tracking-tight">
        HUD Editor
      </h1>
      <div class="h-6 w-px bg-border/60 mx-2" />

      <!-- New layout -->
      <div class="flex items-center gap-2">
        <Input
          v-model="newName"
          placeholder="New layout name..."
          class="h-8 w-48 text-xs"
          @keydown.enter="createLayout"
        />
        <Select v-model="newCategory">
          <SelectTrigger class="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="cat in CATEGORIES"
              :key="cat.key"
              :value="cat.key"
            >
              {{ cat.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          :disabled="!newName.trim() || creating"
          @click="createLayout"
        >
          <Plus class="size-3.5 mr-1" />
          Create
        </Button>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <Button
          v-if="selectedLayout"
          size="sm"
          variant="outline"
          :disabled="saving"
          @click="saveLayout"
        >
          <Check v-if="!saving" class="size-3.5 mr-1" />
          <Loader2 v-else class="size-3.5 mr-1 animate-spin" />
          {{ saving ? "Saving..." : "Save" }}
        </Button>
        <Button
          v-if="previewUrl"
          size="sm"
          variant="outline"
          @click="copyPreviewUrl"
        >
          <component
            :is="copiedPreview ? Check : Copy"
            class="size-3.5 mr-1"
          />
          {{ copiedPreview ? "Copied" : "Copy URL" }}
        </Button>
      </div>
    </header>

    <!-- Main body: 3 panels -->
    <div class="flex-1 flex min-h-0">
      <!-- LEFT: Explorer -->
      <aside
        class="w-64 border-r border-border/60 bg-card/20 flex flex-col flex-shrink-0"
      >
        <div class="p-3 border-b border-border/60">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Layouts
          </h2>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <div
            v-for="cat in CATEGORIES"
            :key="cat.key"
            class="space-y-1"
          >
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-2 py-1">
              {{ cat.label }}
            </div>
            <button
              v-for="layout in layouts.filter((l) => l.category === cat.key)"
              :key="layout.id"
              type="button"
              class="w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors"
              :class="{
                'bg-[hsl(var(--tac-amber)/0.15)] text-[hsl(var(--tac-amber))] font-medium':
                  selectedLayoutId === layout.id,
                'hover:bg-muted/50': selectedLayoutId !== layout.id,
              }"
              @click="selectedLayoutId = layout.id"
              @dblclick="selectedLayoutId = layout.id"
            >
              <span class="truncate flex-1">{{ layout.name }}</span>
              <button
                type="button"
                class="opacity-0 group-hover:opacity-100 hover:text-destructive p-0.5"
                :class="{ 'opacity-100': selectedLayoutId === layout.id }"
                @click.stop="deleteLayout(layout.id)"
              >
                <Trash2 class="size-3" />
              </button>
            </button>
            <div
              v-if="!layouts.some((l) => l.category === cat.key)"
              class="text-[10px] text-muted-foreground/40 px-2 italic"
            >
              No layouts
            </div>
          </div>
        </div>
      </aside>

      <!-- CENTER: Canvas -->
      <main class="flex-1 flex flex-col min-w-0 bg-neutral-950 relative">
        <!-- Canvas toolbar -->
        <div
          class="h-10 border-b border-border/40 flex items-center gap-2 px-3 flex-shrink-0 bg-card/30"
        >
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground mr-2">
            Blocks
          </span>
          <button
            v-for="blockType in BLOCK_TYPES"
            :key="blockType.type"
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-border/40 hover:bg-muted/50 transition-colors"
            @click="addBlock(blockType.type)"
          >
            <component :is="blockType.icon" class="size-3" />
            {{ blockType.label }}
          </button>
        </div>

        <!-- Canvas area -->
        <div class="flex-1 overflow-auto p-4 flex items-center justify-center">
          <div
            id="hud-canvas"
            class="relative bg-black shadow-2xl"
            style="width: 960px; height: 540px"
            @mousemove="onCanvasMouseMove"
            @mouseup="onCanvasMouseUp"
            @mouseleave="onCanvasMouseUp"
          >
            <!-- 1920x1080 coordinate space scaled to 960x540 -->
            <div
              class="absolute inset-0"
              style="transform: scale(0.5); transform-origin: top left; width: 1920px; height: 1080px"
            >
              <!-- Grid -->
              <div
                class="absolute inset-0 opacity-10"
                style="
                  background-image:
                    linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px);
                  background-size: 50px 50px;
                "
              />

              <!-- Blocks -->
              <div
                v-for="block in blocks"
                :key="block.id"
                class="absolute border border-dashed transition-shadow cursor-move select-none"
                :class="{
                  'border-[hsl(var(--tac-amber))] shadow-[0_0_0_1px_hsl(var(--tac-amber)/0.3)]':
                    selectedBlockId === block.id,
                  'border-white/20': selectedBlockId !== block.id,
                }"
                :style="{
                  left: `${block.x}px`,
                  top: `${block.y}px`,
                  width: `${block.width}px`,
                  height: `${block.height}px`,
                  backgroundColor: block.style.backgroundColor as string,
                  color: block.style.color as string,
                }"
                @mousedown="onBlockMouseDown($event, block)"
              >
                <div class="text-xs font-mono p-1 opacity-70">
                  {{ BLOCK_TYPES.find((b) => b.type === block.type)?.label ?? block.type }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <!-- RIGHT: Properties -->
      <aside
        class="w-64 border-l border-border/60 bg-card/20 flex flex-col flex-shrink-0"
      >
        <div class="p-3 border-b border-border/60">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Properties
          </h2>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-4">
          <div v-if="!selectedBlock" class="text-xs text-muted-foreground italic">
            Select a block to edit properties
          </div>

          <template v-else>
            <div class="space-y-2">
              <Label class="text-[10px] uppercase tracking-wider">Type</Label>
              <div class="text-xs font-mono bg-muted px-2 py-1 rounded">
                {{ selectedBlock.type }}
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div class="space-y-1">
                <Label class="text-[10px] uppercase tracking-wider">X</Label>
                <Input
                  v-model.number="selectedBlock.x"
                  type="number"
                  class="h-7 text-xs"
                />
              </div>
              <div class="space-y-1">
                <Label class="text-[10px] uppercase tracking-wider">Y</Label>
                <Input
                  v-model.number="selectedBlock.y"
                  type="number"
                  class="h-7 text-xs"
                />
              </div>
              <div class="space-y-1">
                <Label class="text-[10px] uppercase tracking-wider">W</Label>
                <Input
                  v-model.number="selectedBlock.width"
                  type="number"
                  class="h-7 text-xs"
                />
              </div>
              <div class="space-y-1">
                <Label class="text-[10px] uppercase tracking-wider">H</Label>
                <Input
                  v-model.number="selectedBlock.height"
                  type="number"
                  class="h-7 text-xs"
                />
              </div>
            </div>

            <div class="space-y-2">
              <Label class="text-[10px] uppercase tracking-wider">Background</Label>
              <Input
                v-model="selectedBlock.style.backgroundColor"
                type="text"
                class="h-7 text-xs"
                placeholder="rgba(0,0,0,0.7)"
              />
            </div>

            <div class="space-y-2">
              <Label class="text-[10px] uppercase tracking-wider">Text Color</Label>
              <Input
                v-model="selectedBlock.style.color"
                type="text"
                class="h-7 text-xs"
                placeholder="#ffffff"
              />
            </div>

            <Button
              size="sm"
              variant="destructive"
              class="w-full"
              @click="removeBlock(selectedBlock.id)"
            >
              <Trash2 class="size-3.5 mr-1" />
              Delete Block
            </Button>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>
