<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Upload, Trash2, Loader2, Play } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import PageTransition from "~/components/ui/transitions/PageTransition.vue";

definePageMeta({
  layout: "application-settings",
});

interface Intro {
  id: string;
  map_name: string;
  display_name: string | null;
  uploader_steam_id: string | null;
  size_bytes: number;
  s3_key: string;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
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

const intros = ref<Intro[]>([]);
const knownMaps = ref<string[]>([]);
const loading = ref(false);
const isUploading = ref(false);
const previewMap = ref<string | null>(null);

const dialogOpen = ref(false);
const formMap = ref("");
const formDisplayName = ref("");
const formFile = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function refresh() {
  loading.value = true;
  try {
    const [introsRes, mapsRes] = await Promise.all([
      fetch(`${apiBase.value}/intros`, { credentials: "include" }),
      fetch(`${apiBase.value}/intros/known-maps`, { credentials: "include" }),
    ]);
    if (!introsRes.ok) throw new Error(`${introsRes.status} ${introsRes.statusText}`);
    intros.value = (await introsRes.json()) as Intro[];
    if (mapsRes.ok) {
      const data = (await mapsRes.json()) as { maps: string[] };
      knownMaps.value = data.maps ?? [];
    }
  } catch (e) {
    toast({
      title: "Failed to load flythroughs",
      description: (e as Error).message,
      variant: "destructive",
    });
  } finally {
    loading.value = false;
  }
}

function pickFile() {
  fileInput.value?.click();
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  formFile.value = input.files?.[0] ?? null;
}

async function submit() {
  if (!formFile.value) {
    toast({
      title: "No file selected",
      description: "Pick an mp4 first.",
      variant: "destructive",
    });
    return;
  }
  if (!formMap.value) {
    toast({
      title: "Map required",
      description: "Select or type a map name (e.g. de_inferno).",
      variant: "destructive",
    });
    return;
  }
  isUploading.value = true;
  try {
    const fd = new FormData();
    fd.append("file", formFile.value);
    fd.append("map_name", formMap.value);
    if (formDisplayName.value) fd.append("display_name", formDisplayName.value);
    const res = await fetch(`${apiBase.value}/intros/upload`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    toast({ title: `Flythrough uploaded for ${formMap.value}` });
    dialogOpen.value = false;
    formMap.value = "";
    formDisplayName.value = "";
    formFile.value = null;
    if (fileInput.value) fileInput.value.value = "";
    await refresh();
  } catch (e) {
    toast({
      title: "Upload failed",
      description: (e as Error).message,
      variant: "destructive",
    });
  } finally {
    isUploading.value = false;
  }
}

async function remove(mapName: string) {
  if (!confirm(`Delete flythrough for ${mapName}?`)) return;
  try {
    const res = await fetch(`${apiBase.value}/intros/map/${mapName}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    toast({ title: `Removed flythrough for ${mapName}` });
    if (previewMap.value === mapName) previewMap.value = null;
    await refresh();
  } catch (e) {
    toast({
      title: "Delete failed",
      description: (e as Error).message,
      variant: "destructive",
    });
  }
}

function preview(mapName: string) {
  previewMap.value = previewMap.value === mapName ? null : mapName;
}

function fileUrlFor(mapName: string): string {
  return `${apiBase.value}/intros/map/${mapName}/file`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

const missingMaps = computed(() => {
  const have = new Set(intros.value.map((i) => i.map_name));
  return knownMaps.value.filter((m) => !have.has(m));
});

onMounted(refresh);
</script>

<template>
  <PageTransition>
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Map Flythroughs</h1>
          <p class="text-sm text-muted-foreground">
            Pre-match warmup intro videos played in the live HLS stream
            before the first round starts. One mp4 per map.
          </p>
        </div>
        <Dialog v-model:open="dialogOpen">
          <DialogTrigger as-child>
            <Button>
              <Upload class="mr-2 h-4 w-4" />
              Upload flythrough
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload flythrough mp4</DialogTitle>
            </DialogHeader>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <Label for="map_name">Map</Label>
                <Input
                  id="map_name"
                  v-model="formMap"
                  list="known-maps-list"
                  placeholder="de_inferno"
                />
                <datalist id="known-maps-list">
                  <option v-for="m in knownMaps" :key="m" :value="m" />
                </datalist>
              </div>
              <div class="flex flex-col gap-1">
                <Label for="display_name">Display name (optional)</Label>
                <Input
                  id="display_name"
                  v-model="formDisplayName"
                  placeholder="Inferno community flythrough"
                />
              </div>
              <div class="flex flex-col gap-1">
                <Label>Video file (mp4 / webm, ≤256 MiB)</Label>
                <input
                  ref="fileInput"
                  type="file"
                  accept="video/mp4,video/webm"
                  class="hidden"
                  @change="onFileSelected"
                />
                <Button variant="secondary" @click="pickFile">
                  {{ formFile ? formFile.name : "Choose file…" }}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button :disabled="isUploading" @click="submit">
                <Loader2
                  v-if="isUploading"
                  class="mr-2 h-4 w-4 animate-spin"
                />
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card v-if="missingMaps.length">
        <CardHeader>
          <CardTitle>Missing flythroughs</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="mb-2 text-sm text-muted-foreground">
            These maps have no flythrough uploaded yet. Matches on these
            maps will skip the warmup intro.
          </p>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="m in missingMaps"
              :key="m"
              class="rounded-md border px-2 py-1 font-mono text-xs"
            >
              {{ m }}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card v-if="loading">
        <CardContent class="flex justify-center py-12">
          <Loader2 class="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>

      <Card v-else-if="!intros.length">
        <CardContent class="py-12 text-center text-muted-foreground">
          No flythroughs uploaded yet. Click <strong>Upload flythrough</strong>
          to add one.
        </CardContent>
      </Card>

      <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card v-for="intro in intros" :key="intro.id">
          <CardHeader class="flex flex-row items-center justify-between">
            <div>
              <CardTitle class="font-mono text-base">
                {{ intro.map_name }}
              </CardTitle>
              <p
                v-if="intro.display_name"
                class="text-sm text-muted-foreground"
              >
                {{ intro.display_name }}
              </p>
            </div>
            <div class="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                title="Preview"
                @click="preview(intro.map_name)"
              >
                <Play class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Delete"
                @click="remove(intro.map_name)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent class="flex flex-col gap-2 text-sm">
            <div class="flex justify-between text-muted-foreground">
              <span>{{ formatBytes(intro.size_bytes) }}</span>
              <span v-if="intro.duration_seconds">
                {{ intro.duration_seconds }}s
              </span>
            </div>
            <video
              v-if="previewMap === intro.map_name"
              controls
              :src="fileUrlFor(intro.map_name)"
              class="w-full rounded-md border"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  </PageTransition>
</template>
