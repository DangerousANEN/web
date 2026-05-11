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
import { useApolloClient } from "@vue/apollo-composable";
import { generateQuery, generateMutation } from "~/graphql/graphqlGen";
import type { ApolloQueryResult } from "@apollo/client";

const props = defineProps<{
  matchId: string;
  matchOptionsId: string;
  canEdit: boolean;
}>();

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

async function load() {
  loading.value = true;
  try {
    const [layoutsRes, overlayRes] = await Promise.all([
      apolloClient.query({
        query: generateQuery({
          hud_layouts: [
            { order_by: [{ name: "asc" as const }] },
            { id: true, name: true, slug: true, category: true, is_public: true },
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
                slot_key: { _eq: "game" },
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
      title: "Failed to load HUD layouts",
      description: e?.message ?? String(e),
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
    const layoutId = value === SENTINEL_NONE ? null : value;
    if (layoutId) {
      // Upsert: update existing or insert new
      await apolloClient.mutate({
        mutation: generateMutation({
          insert_match_overlay_huds_one: [
            {
              object: {
                match_options_id: props.matchOptionsId,
                slot_key: "game",
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
    } else {
      // Clear layout_id by updating the row
      const existing = await apolloClient.query({
        query: generateQuery({
          match_overlay_huds: [
            {
              where: {
                match_options_id: { _eq: props.matchOptionsId },
                slot_key: { _eq: "game" },
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
    }
    toast({ title: "HUD layout updated" });
    await load();
  } catch (e: any) {
    toast({
      title: "Failed to update HUD layout",
      description: e?.message ?? String(e),
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
      Overlay Layout
    </span>
    <Select v-if="canEdit" v-model="selected" :disabled="loading || saving">
      <SelectTrigger class="w-56 h-8">
        <SelectValue placeholder="Loading…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="SENTINEL_NONE">
          Default (built-in)
        </SelectItem>
        <SelectItem v-for="layout in layouts" :key="layout.id" :value="layout.id">
          {{ layout.name }}
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
