<script setup lang="ts">
import { ref, computed } from "vue";
import { Bot, Plus, X, ChevronDown } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
const { t } = useI18n();

/**
 * AddBotToLineup — кнопка "Добавить бота" для тестовых матчей.
 * Создаёт fake player entries с специально зарезервированными Steam ID.
 * Боты используются только для тестирования overlay/HUD и заполнения слотов.
 *
 * Steam ID ботов: генерируются из диапазона BOT_STEAM_ID_START (99000000000000000)
 * Боты помечаются is_bot=true в match_lineup_players.
 */

const props = defineProps<{
  lineup: { id: string; team_id?: string | null };
  matchId: string;
  exclude?: Array<{ steam_id: string }>;
  botCount?: number;
}>();

const emit = defineEmits<{
  (e: "bot-added", steamId: string): void;
  (e: "changed"): void;
}>();

const BOT_STEAM_ID_START = "99000000000000000";

// Predefined bot names for variety
const BOT_NAMES = [
  "Bot_Boom",
  "Bot_Hunter",
  "Bot_Sniper",
  "Bot_Rush",
  "Bot_Pro",
  "Bot_Ninja",
  "Bot_AWP",
  "Bot_Clutch",
  "Bot Ace",
  "Bot King",
  "Bot Queen",
  "Bot Rook",
];

const showPicker = ref(false);
const customName = ref("");

const usedNames = computed(() => {
  const names = new Set<string>();
  // Mark used names from botCount or existing bots in exclude
  if (props.botCount) {
    for (let i = 0; i < props.botCount; i++) {
      names.add(BOT_NAMES[i % BOT_NAMES.length]);
    }
  }
  return names;
});

const availableNames = computed(() =>
  BOT_NAMES.filter((n) => !usedNames.value.has(n)),
);

function generateBotSteamId(): string {
  // Use botCount to offset the Steam ID
  const offset = (props.botCount ?? 0) + Math.floor(Math.random() * 1000);
  // Add random suffix for uniqueness across lineups
  return String(BigInt(BOT_STEAM_ID_START) + BigInt(offset) + BigInt(Date.now() % 100000));
}

async function addBot(name?: string) {
  const botName = name || customName.value.trim() || availableNames.value[0];
  if (!botName) {
    toast({
      variant: "destructive",
      title: t("match.no_bot_names"),
      description: t("match.all_bot_names_used"),
    });
    return;
  }

  const botSteamId = generateBotSteamId();

  try {
    // Use Apollo to insert the bot as a lineup player
    const { useApolloClient } = await import("@vue/apollo-composable");
    const { client } = useApolloClient();
    const { generateMutation } = await import("~/graphql/graphqlGen");

    // Insert fake player first (upsert — if already exists, skip)
    await client.mutate({
      mutation: generateMutation({
        insert_players_one: [
          {
            object: {
              steam_id: botSteamId,
              name: botName,
              avatar_url: null,
              country: "RU",
            },
            on_conflict: {
              constraint: "players_pkey",
              update_columns: ["name"],
            },
          },
          { steam_id: true },
        ],
      }),
    });

    // Insert into lineup
    await client.mutate({
      mutation: generateMutation({
        insert_match_lineup_players_one: [
          {
            object: {
              steam_id: botSteamId,
              match_lineup_id: props.lineup.id,
            },
          },
          { __typename: true },
        ],
      }),
    });

    showPicker.value = false;
    customName.value = "";
    emit("bot-added", botSteamId);
    emit("changed");

    toast({
      title: t("match.bot_added"),
      description: t("match.bot_added_desc", { name: botName }),
    });
  } catch (e: any) {
    console.error("[add-bot] failed", e);
    toast({
      variant: "destructive",
      title: t("common.error"),
      description: e?.message ?? t("match.bot_add_failed"),
    });
  }
}
</script>

<template>
  <Popover v-model:open="showPicker">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        class="gap-1.5 text-xs"
      >
        <Bot class="size-3.5" />
        {{ $t("match.add_bot") }}
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-64 p-3" align="start">
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <Bot class="size-4 text-muted-foreground" />
          <h4 class="text-xs font-semibold uppercase tracking-wider">
            {{ $t("match.add_bot") }}
          </h4>
        </div>

        <!-- Quick pick -->
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="name in availableNames.slice(0, 6)"
            :key="name"
            type="button"
            class="px-2 py-1 rounded text-[10px] border border-border/40 hover:bg-muted/60 transition-colors"
            @click="addBot(name)"
          >
            {{ name }}
          </button>
        </div>

        <!-- Custom name -->
        <div class="flex gap-2">
          <Input
            v-model="customName"
            :placeholder="$t('match.bot_name')"
            class="h-7 text-xs"
            @keydown.enter="addBot()"
          />
          <Button
            size="sm"
            variant="outline"
            :disabled="!customName.trim()"
            @click="addBot()"
          >
            <Plus class="size-3" />
          </Button>
        </div>

        <div class="text-[10px] text-muted-foreground">
          {{ $t("match.bot_disclaimer") }}
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
