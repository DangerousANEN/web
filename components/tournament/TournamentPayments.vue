<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useMutation } from "@vue/apollo-composable";
import { generateQuery, generateMutation } from "~/graphql/graphqlGen";
const e_payment_status_enum = { none: 'none', pending: 'pending', paid: 'paid' };
import { Button } from "@/components/ui/button";
import { toast } from "~/components/ui/toast/use-toast";

const props = defineProps<{
  tournament: any;
}>();

// We fetch both individual players and teams that are 'pending' or 'paid'
const { result, refetch } = useQuery(
  generateQuery({
    tournaments_by_pk: [
      {
        id: props.tournament.id,
      },
      {
        roster: [
          {
            where: { payment_status: { _neq: e_payment_status_enum.none } },
          },
          {
            id: true,
            payment_status: true,
            player: {
              steam_id: true,
              name: true,
            },
          },
        ],
        teams: [
          {
            where: { payment_status: { _neq: e_payment_status_enum.none } },
          },
          {
            id: true,
            payment_status: true,
            team: {
              name: true,
            },
            roster: [
              {},
              {
                player: {
                  name: true,
                }
              }
            ]
          },
        ],
      },
    ],
  }),
  null,
  {
    fetchPolicy: "cache-and-network",
  }
);

const players = computed(() => result.value?.tournaments_by_pk?.roster || []);
const teams = computed(() => result.value?.tournaments_by_pk?.teams || []);

const updatePlayerPayment = async (rosterId: string, status: string) => {
  // Use graphql directly or manually fetch
  try {
    const { $apollo } = useNuxtApp();
    await $apollo.mutate({
      mutation: generateMutation({
        update_tournament_roster_by_pk: [
          {
            pk_columns: { id: rosterId },
            _set: { payment_status: status as any },
          },
          {
            id: true,
            payment_status: true,
          },
        ],
      }),
    });
    toast({ title: "Payment status updated" });
    refetch();
  } catch (e) {
    toast({ title: "Failed to update status", variant: "destructive" });
  }
};

const updateTeamPayment = async (teamId: string, status: string) => {
  try {
    const { $apollo } = useNuxtApp();
    await $apollo.mutate({
      mutation: generateMutation({
        update_tournament_teams_by_pk: [
          {
            pk_columns: { id: teamId },
            _set: { payment_status: status as any },
          },
          {
            id: true,
            payment_status: true,
          },
        ],
      }),
    });
    toast({ title: "Payment status updated" });
    refetch();
  } catch (e) {
    toast({ title: "Failed to update status", variant: "destructive" });
  }
};
</script>

<template>
  <div class="space-y-6">
    <div v-if="players.length > 0">
      <h3 class="font-bold text-lg mb-4">Individual Players</h3>
      <div v-for="roster in players" :key="roster.id" class="flex justify-between items-center p-4 bg-muted mb-2 rounded">
        <div>
          <p class="font-medium">{{ roster.player?.name }}</p>
          <p class="text-sm text-muted-foreground">Status: {{ roster.payment_status }}</p>
        </div>
        <div class="space-x-2">
          <Button size="sm" variant="outline" @click="updatePlayerPayment(roster.id, e_payment_status_enum.paid)" v-if="roster.payment_status === 'pending'">Approve</Button>
          <Button size="sm" variant="destructive" @click="updatePlayerPayment(roster.id, e_payment_status_enum.none)" v-if="roster.payment_status === 'pending'">Reject</Button>
          <Button size="sm" variant="outline" @click="updatePlayerPayment(roster.id, e_payment_status_enum.pending)" v-if="roster.payment_status === 'paid'">Revert</Button>
        </div>
      </div>
    </div>

    <div v-if="teams.length > 0">
      <h3 class="font-bold text-lg mb-4">Teams</h3>
      <div v-for="teamRoster in teams" :key="teamRoster.id" class="flex justify-between items-center p-4 bg-muted mb-2 rounded">
        <div>
          <p class="font-medium">{{ teamRoster.team?.name }}</p>
          <p class="text-sm text-muted-foreground">Status: {{ teamRoster.payment_status }}</p>
          <p class="text-xs text-muted-foreground">Players: {{ teamRoster.roster.map(r => r.player?.name).join(', ') }}</p>
        </div>
        <div class="space-x-2">
          <Button size="sm" variant="outline" @click="updateTeamPayment(teamRoster.id, e_payment_status_enum.paid)" v-if="teamRoster.payment_status === 'pending'">Approve</Button>
          <Button size="sm" variant="destructive" @click="updateTeamPayment(teamRoster.id, e_payment_status_enum.none)" v-if="teamRoster.payment_status === 'pending'">Reject</Button>
          <Button size="sm" variant="outline" @click="updateTeamPayment(teamRoster.id, e_payment_status_enum.pending)" v-if="teamRoster.payment_status === 'paid'">Revert</Button>
        </div>
      </div>
    </div>

    <div v-if="players.length === 0 && teams.length === 0" class="text-center p-8 text-muted-foreground">
      No pending or paid applications found.
    </div>
  </div>
</template>
