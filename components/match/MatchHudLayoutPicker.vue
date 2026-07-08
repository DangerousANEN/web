<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-vue-next";
import { toast } from "@/components/ui/toast";
import { useApolloClient } from "@vue/apollo-composable";
import { generateQuery, generateMutation } from "~/graphql/graphqlGen";
import type { ApolloQueryResult } from "@apollo/client";

// Per-slot overlay layout picker. A wrapper around the `match_overlay_huds`
// table keyed by (match_options_id, slot_key). Allows the match organizer
// to bind a `hud_layouts` row to a named OBS scene slot — e.g. `game`,
// `operator`, `veto`, `intermission`, `casters`, etc. Each slot renders as
// a separate overlay URL (`/overlay/hud/<matchId>?slot=<key>`), so OBS
// Browser Sources compose different HUDs per scene.

const props = withDefaults(
  defineProps<{
    matchId: string;
    matchOptionsId: string;
    canEdit: boolean;
    /** Which slot_key this picker binds. Defaults to "game" (back-compat). */
    slotKey?: string;
    /** Optional label shown next to the picker (e.g. "Operator HUD"). */
    label?: string;
  }>(),
  { slotKey: "game", label: "" },
);

const SENTINEL_NONE = "__none__";

interface HudLayout {
  id: string;
  name: string;
  slug: string;
  category: string;
  is_public: boolean;
}

interface OverlayHud {
  id: string;
  slot_key: string;
  layout_id: string | null;
  layout?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

const { client: apolloClient } = useApolloClient();
const loading = ref(false);
const saving = ref(false);
const layouts = ref<HudLayout[]>([]);
const selected = ref<string>(SENTINEL_NONE);
const activeName = ref<string | null>(null);

// Filter layouts by slot's category when slot-key maps to a known category.
const SLOT_CATEGORY_MAP: Record<string, string> = {
  game: "game",
  operator: "operator",
  veto: "veto",
  intermission: "intermission",
  casters: "casters",
  brackets: "brackets",
};

const filteredLayouts = computed(() => {
  const cat = SLOT_CATEGORY_MAP[props.slotKey];
  if (!cat) return layouts.value;
  return layouts.value.filter(
    (l) => l.category === cat || l.category === "custom",
  );
});

async function load() {
  loading.value = true;
  try {
    const [layoutsRes, overlayRes] = await Promise.all([
      apolloClient.query({
        query: generateQuery({
          hud_layouts: [
            { order_by: [{ name: "asc" as const }] },
            {
              id: true,
              name: true,
              slug: true,
              category: true,
              is_public: true,
            },
          ],
        }),
        fetchPolicy: "network-only",
      }) as Promise<ApolloQueryResult<{ hud_layouts: HudLayout[] }>>,
      apolloClient.query({
        query: generateQuery({
          match_overlay_huds: [
            {
              where: {
                match_options_id: { _eq: props.matchOptionsId },
                slot_key: { _eq: props.slotKey },
              },
              limit: 1,
            },
            {
              id: true,
              slot_key: true,
              layout_id: true,
              layout: { id: true, name: true, slug: true },
            },
          ],
        }),
        fetchPolicy: "network-only",
      }) as Promise<ApolloQueryResult<{ match_overlay_huds: OverlayHud[] }>>,
    ]);
    layouts.value = layoutsRes.data.hud_layouts ?? [];
    const overlay = overlayRes.data.match_overlay_huds?.[0];
    if (overlay?.layout_id) {
      selected.value = overlay.layout_id;
      activeName.value = overlay.layout?.name ?? null;
    } else {
      selected.value = SENTINEL_NONE;
      activeName.value = null;
    }
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to load HUD layouts",
      description: e?.message ?? String(e),
    });
  } finally {
    loading.value = false;
  }
}

async function save(value: string) {
  if (!props.canEdit) return;
  saving.value = true;
  try {
    const layoutId = value === SENTINEL_NONE ? null : value;
    if (layoutId) {
      // Upsert: update existing or insert new
      await apolloClient.mutate({
        mutation: generateMutation({
          insert_match_overlay_huds_one: [
            {
              object: {
                match_options_id: props.matchOptionsId,
                slot_key: props.slotKey,
                layout_id: layoutId,
              },
              on_conflict: {
                constraint: "match_overlay_huds_match_options_slot_unique" as any,
                update_columns: ["layout_id" as any],
              },
            },
            { id: true },
          ],
        }),
      });
      activeName.value =
        layouts.value.find((l) => l.id === layoutId)?.name ?? null;
    } else {
      // Clear layout_id by updating the row
      const existing = await apolloClient.query({
        query: generateQuery({
          match_overlay_huds: [
            {
              where: {
                match_options_id: { _eq: props.matchOptionsId },
                slot_key: { _eq: props.slotKey },
              },
              limit: 1,
            },
            { id: true },
          ],
        }),
        fetchPolicy: "network-only",
      });
      const rowId = (existing.data as any)?.match_overlay_huds?.[0]?.id;
      if (rowId) {
        await apolloClient.mutate({
          mutation: generateMutation({
            update_match_overlay_huds_by_pk: [
              {
                pk_columns: { id: rowId },
                _set: { layout_id: null },
              },
              { id: true },
            ],
          }),
        });
      }
      activeName.value = null;
    }
  } catch (e: any) {
    toast({
      variant: "destructive",
      title: "Failed to save HUD layout",
      description: e?.message ?? String(e),
    });
    // Revert selection on failure
    selected.value = SENTINEL_NONE;
  } finally {
    saving.value = false;
  }
}

watch(selected, (next) => {
  if (!loading.value) void save(next);
});

// Re-load when slotKey changes (e.g. parent switches tab)
watch(
  () => props.slotKey,
  () => void load(),
);

onMounted(load);
</script>

<template>
  <div class="flex items-center gap-2 flex-wrap">
    <Label
      v-if="label"
      class="text-xs text-muted-foreground font-medium"
    >
      {{ label }}
    </Label>
    <Select v-model="selected" :disabled="!canEdit || loading || saving">
      <SelectTrigger class="h-8 w-auto min-w-[160px] text-xs">
        <SelectValue :placeholder="loading ? 'Loading...' : 'Default built-in'" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="SENTINEL_NONE">
          Default built-in ({{ slotKey }})
        </SelectItem>
        <SelectItem
          v-for="layout in filteredLayouts"
          :key="layout.id"
          :value="layout.id"
        >
          {{ layout.name }}
          <span class="text-muted-foreground ml-1 text-[10px]">
            ({{ layout.category }})
          </span>
        </SelectItem>
        <!-- Show other-category layouts too, dimmed -->
        <template v-if="filteredLayouts.length !== layouts.length">
          <div class="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Other layouts
          </div>
          <SelectItem
            v-for="layout in layouts.filter(
              (l) => !filteredLayouts.includes(l)
            )"
            :key="layout.id"
            :value="layout.id"
          >
            {{ layout.name }}
            <span class="text-muted-foreground ml-1 text-[10px]">
              ({{ layout.category }})
            </span>
          </SelectItem>
        </template>
      </SelectContent>
    </Select>
    <span class="text-sm">
      {{ activeName ?? "Default" }}
    </span>
    <Loader2
      v-if="loading || saving"
      class="size-3.5 animate-spin text-muted-foreground"
    />
  </div>
</template>
