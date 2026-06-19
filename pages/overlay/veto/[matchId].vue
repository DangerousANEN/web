<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@vue/apollo-composable";
import { generateQuery } from "~/graphql/graphqlGen";
import { e_match_status_enum, e_veto_pick_types_enum } from "~/generated/zeus";

definePageMeta({
  layout: false,
});

const route = useRoute();
const matchId = computed(() => String(route.params.matchId));

const { result } = useQuery(
  generateQuery({
    matches_by_pk: [
      { id: matchId.value },
      {
        id: true,
        status: true,
        veto_picks: [
          { order_by: [{ order: "asc" }] },
          {
            id: true,
            type: true,
            map: { name: true, image_url: true },
            lineup: { team: { name: true, logo_url: true } },
          }
        ],
        lineups: [
          {},
          {
            team: { name: true, logo_url: true },
          }
        ]
      }
    ]
  }),
  null,
  {
    pollInterval: 1000,
    fetchPolicy: "network-only"
  }
);

const match = computed(() => result.value?.matches_by_pk);
const vetoes = computed(() => match.value?.veto_picks || []);
const team1 = computed(() => match.value?.lineups?.[0]?.team);
const team2 = computed(() => match.value?.lineups?.[1]?.team);

const isVetoing = computed(() => match.value?.status === e_match_status_enum.Veto);
</script>

<template>
  <div class="fixed inset-0 w-full h-full bg-transparent flex flex-col items-center justify-center pointer-events-none">
    <div class="bg-black/80 text-white p-8 rounded-xl shadow-2xl border border-white/10 w-[1200px]" v-if="match">
      
      <!-- Header -->
      <div class="flex justify-between items-center mb-8 border-b border-white/20 pb-6">
        <div class="flex items-center gap-4">
          <img :src="team1?.logo_url" v-if="team1?.logo_url" class="w-16 h-16 object-contain" />
          <div v-else class="w-16 h-16 bg-white/10 rounded flex items-center justify-center font-bold text-xl">{{ team1?.name?.charAt(0) || 'T1' }}</div>
          <h2 class="text-3xl font-bold">{{ team1?.name || 'Team 1' }}</h2>
        </div>
        
        <div class="flex flex-col items-center">
          <h1 class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 uppercase tracking-widest">
            Map Veto
          </h1>
          <div class="mt-2 text-white/60" v-if="isVetoing">Live Selection</div>
          <div class="mt-2 text-white/60" v-else>Veto Complete</div>
        </div>

        <div class="flex items-center gap-4">
          <h2 class="text-3xl font-bold">{{ team2?.name || 'Team 2' }}</h2>
          <img :src="team2?.logo_url" v-if="team2?.logo_url" class="w-16 h-16 object-contain" />
          <div v-else class="w-16 h-16 bg-white/10 rounded flex items-center justify-center font-bold text-xl">{{ team2?.name?.charAt(0) || 'T2' }}</div>
        </div>
      </div>

      <!-- Veto History -->
      <div class="flex flex-wrap justify-center gap-4">
        <transition-group name="veto-list">
          <div v-for="veto in vetoes" :key="veto.id" 
               class="relative w-48 h-64 rounded-lg overflow-hidden border-2 shadow-lg flex flex-col justify-end transition-all duration-500"
               :class="veto.type === e_veto_pick_types_enum.Ban ? 'border-red-500/50' : 'border-emerald-500/50'">
            
            <!-- Map Background -->
            <img :src="veto.map?.image_url" class="absolute inset-0 w-full h-full object-cover opacity-60" />
            
            <!-- Ban Overlay -->
            <div v-if="veto.type === e_veto_pick_types_enum.Ban" class="absolute inset-0 flex items-center justify-center bg-red-900/40 backdrop-blur-[2px]">
              <div class="w-24 h-24 border-4 border-red-500 rounded-full flex items-center justify-center transform rotate-45 opacity-80">
                <div class="w-full h-2 bg-red-500"></div>
              </div>
            </div>

            <!-- Team Selection Header -->
            <div class="absolute top-0 w-full bg-black/80 p-2 text-center text-sm font-bold flex items-center justify-center gap-2"
                 :class="veto.type === e_veto_pick_types_enum.Ban ? 'text-red-400' : 'text-emerald-400'">
              <img :src="veto.lineup?.team?.logo_url" v-if="veto.lineup?.team?.logo_url" class="w-4 h-4 object-contain" />
              {{ veto.lineup?.team?.name || 'Random' }}
              <span class="text-xs uppercase text-white/50 ml-1">{{ veto.type }}</span>
            </div>

            <!-- Map Name Footer -->
            <div class="relative z-10 w-full bg-gradient-to-t from-black via-black/80 to-transparent p-4 text-center mt-auto">
              <span class="font-bold text-xl uppercase tracking-wider text-white shadow-black drop-shadow-md">
                {{ veto.map?.name }}
              </span>
            </div>
          </div>
        </transition-group>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* Ensure fonts load and backgrounds composite over OBS correctly */
body {
  background: transparent !important;
}

.veto-list-enter-active,
.veto-list-leave-active {
  transition: all 0.5s ease;
}
.veto-list-enter-from {
  opacity: 0;
  transform: translateY(30px) scale(0.9);
}
.veto-list-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
