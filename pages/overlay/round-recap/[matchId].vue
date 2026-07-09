<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useQuery, useSubscription } from "@vue/apollo-composable";
import { generateQuery, generateSubscription } from "~/graphql/graphqlGen";
import { order_by } from "~/generated/zeus";

definePageMeta({ layout: false });

const route = useRoute();
const matchId = computed(() => route.params.matchId as string);

// ── State ──────────────────────────────────────────────────
const showRecap = ref(false);
const currentClip = ref<{
  id: string;
  title: string | null;
  file: string | null;
  thumbnail_url: string | null;
  kills_count: number | null;
  target_steam_id: string | null;
} | null>(null);

const previousRound = ref<number | null>(null);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// ── Query: latest round highlights with auto-clip ──────────
const QUERY = generateQuery({
  round_highlights: [
    {
      where: {
        match_id: { _eq: matchId.value },
        auto_clip_status: { _is_null: false },
      },
      order_by: [{ round_number: order_by.desc }],
      limit: 5,
    },
    {
      id: true,
      round_number: true,
      steam_id: true,
      player_name: true,
      kills: true,
      label: true,
      auto_clip_status: true,
      auto_clip_id: true,
    },
  ],
});

const { result: highlightsResult, refetch } = useQuery(QUERY);

// ── Subscription: new round highlight inserted ──────────────
const SUB = generateSubscription({
  round_highlights: [
    {
      where: {
        match_id: { _eq: matchId.value },
        auto_clip_status: { _is_null: false },
      },
      limit: 1,
      order_by: [{ round_number: order_by.desc }],
    },
    {
      id: true,
      round_number: true,
      player_name: true,
      kills: true,
      label: true,
      auto_clip_status: true,
    },
  ],
}) as any;

const { onResult: onSubResult } = useSubscription(SUB);
onSubResult(({ data }: any) => {
  const rh = data?.round_highlights?.[0];
  if (!rh) return;
  if (previousRound.value !== null && rh.round_number === previousRound.value) return;
  previousRound.value = rh.round_number;
  showRecap.value = true;
  countdown.value = 10;
  startCountdown();
});

// ── Countdown ──────────────────────────────────────────────
function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      showRecap.value = false;
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }
  }, 1000);
}

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});

const latestHighlight = computed(() => {
  const rows = highlightsResult.value?.round_highlights ?? [];
  return rows[0] ?? null;
});

const labelDisplay = computed(() => {
  if (!latestHighlight.value) return "";
  const label = latestHighlight.value.label as string;
  const kills = latestHighlight.value.kills as number;
  if (label === "ace") return "ACE";
  if (label === "quadra") return "QUADRA KILL";
  if (label === "triple") return "TRIPLE KILL";
  if (kills >= 5) return "ACE";
  if (kills >= 4) return "QUADRA KILL";
  if (kills >= 3) return "TRIPLE KILL";
  return `${kills} KILLS`;
});

const playerName = computed(() => {
  return latestHighlight.value?.player_name ?? "Player";
});
</script>

<template>
  <div class="recap-overlay">
    <Transition name="recap-slide">
      <div v-if="showRecap && latestHighlight" class="recap-card">
        <div class="recap-glow"></div>
        <div class="recap-content">
          <div class="recap-label">{{ labelDisplay }}</div>
          <div class="recap-player">{{ playerName }}</div>
          <div class="recap-round">Round {{ latestHighlight.round_number }}</div>
          <div class="recap-countdown" v-if="countdown > 0">{{ countdown }}</div>
        </div>
        <div class="recap-clip-badge" v-if="latestHighlight.auto_clip_status === 'queued'">
          <svg class="recap-icon" viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M8 5v14l11-7z" />
          </svg>
          <span>Auto-clip</span>
        </div>
        <div class="recap-clip-badge recap-done" v-else-if="latestHighlight.auto_clip_status === 'done'">
          <svg class="recap-icon" viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
          <span>Clip ready</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.recap-overlay {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  pointer-events: none;
  font-family: 'Inter', 'Segoe UI', sans-serif;
}

.recap-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 32px;
  background: linear-gradient(135deg, rgba(15, 15, 25, 0.92), rgba(25, 25, 40, 0.92));
  border: 2px solid rgba(255, 180, 0, 0.6);
  border-radius: 16px;
  box-shadow: 0 0 40px rgba(255, 180, 0, 0.3), 0 4px 20px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  min-width: 320px;
}

.recap-glow {
  position: absolute;
  inset: -2px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(255, 180, 0, 0.3), transparent, rgba(255, 180, 0, 0.3));
  opacity: 0.6;
  z-index: -1;
  animation: glow-pulse 2s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

.recap-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recap-label {
  font-size: 28px;
  font-weight: 900;
  background: linear-gradient(135deg, #ffb800, #ff8800);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.recap-player {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.5px;
}

.recap-round {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 500;
}

.recap-countdown {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 180, 0, 0.9);
  color: #0a0a0a;
  font-size: 14px;
  font-weight: 900;
  border-radius: 50%;
  box-shadow: 0 0 12px rgba(255, 180, 0, 0.6);
}

.recap-clip-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 180, 0, 0.15);
  border: 1px solid rgba(255, 180, 0, 0.4);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 180, 0, 0.9);
}

.recap-clip-badge.recap-done {
  background: rgba(0, 200, 100, 0.15);
  border-color: rgba(0, 200, 100, 0.4);
  color: rgba(0, 200, 100, 0.9);
}

.recap-icon {
  flex-shrink: 0;
}

.recap-slide-enter-active,
.recap-slide-leave-active {
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.recap-slide-enter-from {
  opacity: 0;
  transform: translateY(-30px) scale(0.9);
}

.recap-slide-leave-to {
  opacity: 0;
  transform: translateY(-20px) scale(0.95);
}
</style>
