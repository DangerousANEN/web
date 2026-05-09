<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Upload, Trash2, Loader2, Star, Globe, Lock } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface Hud {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: string | null;
  uploader_steam_id: string | null;
  is_default: boolean;
  is_public: boolean;
  size_bytes: number;
  extracted_dir: string;
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

const huds = ref<Hud[]>([]);
const loading = ref(false);
const isUploading = ref(false);

const dialogOpen = ref(false);
const formName = ref("");
const formSlug = ref("");
const formDescription = ref("");
const formVersion = ref("");
const formIsPublic = ref(true);
const formFile = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

async function refresh() {
  loading.value = true;
  try {
    const res = await fetch(`${apiBase.value}/huds`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    huds.value = (await res.json()) as Hud[];
  } catch (e) {
    toast({
      title: "Failed to load HUDs",
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
  const file = input.files?.[0] ?? null;
  formFile.value = file;
  if (file) {
    if (!formName.value) formName.value = file.name.replace(/\.zip$/i, "");
    if (!formSlug.value) formSlug.value = slugify(formName.value);
  }
}

async function submit() {
  if (!formFile.value) {
    toast({
      title: "Pick a HUD .zip first",
      variant: "destructive",
    });
    return;
  }
  if (!formName.value || !formSlug.value) {
    toast({
      title: "Name and slug are required",
      variant: "destructive",
    });
    return;
  }
  isUploading.value = true;
  try {
    const fd = new FormData();
    fd.append("file", formFile.value);
    fd.append("name", formName.value);
    fd.append("slug", formSlug.value);
    if (formDescription.value) fd.append("description", formDescription.value);
    if (formVersion.value) fd.append("version", formVersion.value);
    fd.append("isPublic", formIsPublic.value ? "true" : "false");

    const res = await fetch(`${apiBase.value}/huds/upload`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    toast({ title: "HUD uploaded" });
    dialogOpen.value = false;
    formName.value = "";
    formSlug.value = "";
    formDescription.value = "";
    formVersion.value = "";
    formIsPublic.value = true;
    formFile.value = null;
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

async function setDefault(hud: Hud) {
  try {
    const res = await fetch(
      `${apiBase.value}/huds/${hud.id}/set-default`,
      { method: "POST", credentials: "include" },
    );
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    toast({ title: `Default HUD: ${hud.name}` });
    await refresh();
  } catch (e) {
    toast({
      title: "Failed to set default",
      description: (e as Error).message,
      variant: "destructive",
    });
  }
}

async function clearDefault() {
  try {
    const res = await fetch(`${apiBase.value}/huds/clear-default`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    toast({ title: "Default HUD cleared" });
    await refresh();
  } catch (e) {
    toast({
      title: "Failed to clear default",
      description: (e as Error).message,
      variant: "destructive",
    });
  }
}

async function remove(hud: Hud) {
  if (!confirm(`Delete HUD "${hud.name}"?`)) return;
  try {
    const res = await fetch(`${apiBase.value}/huds/${hud.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    toast({ title: "HUD deleted" });
    await refresh();
  } catch (e) {
    toast({
      title: "Delete failed",
      description: (e as Error).message,
      variant: "destructive",
    });
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(refresh);
</script>

<template>
  <PageTransition :delay="0">
    <div class="space-y-1">
      <h3 class="text-base font-semibold uppercase tracking-wide">
        Spectator HUDs
      </h3>
      <p class="text-sm text-muted-foreground">
        Upload OpenHud-compatible HUD packs. Set a default and / or override
        per-match in the match settings. HUDs ship to the streamer pod on
        match start.
      </p>
    </div>
  </PageTransition>

  <PageTransition :delay="50">
    <div class="flex items-center justify-between">
      <Button variant="outline" :disabled="loading" @click="refresh">
        Refresh
      </Button>
      <Dialog v-model:open="dialogOpen">
        <DialogTrigger as-child>
          <Button>
            <Upload class="size-4 mr-2" />
            Upload HUD
          </Button>
        </DialogTrigger>
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload spectator HUD</DialogTitle>
          </DialogHeader>
          <div class="grid gap-3">
            <div class="grid gap-1.5">
              <Label for="hud-file">HUD .zip</Label>
              <input
                ref="fileInput"
                id="hud-file"
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                class="hidden"
                @change="onFileSelected"
              />
              <Button variant="outline" type="button" @click="pickFile">
                {{ formFile ? formFile.name : "Choose .zip" }}
              </Button>
              <p class="text-xs text-muted-foreground">
                Must contain a <code>build/index.html</code> entry (OpenHud /
                Lexogrine layout).
              </p>
            </div>
            <div class="grid gap-1.5">
              <Label for="hud-name">Name</Label>
              <Input id="hud-name" v-model="formName" />
            </div>
            <div class="grid gap-1.5">
              <Label for="hud-slug">Slug</Label>
              <Input
                id="hud-slug"
                v-model="formSlug"
                placeholder="lowercase-with-dashes"
              />
            </div>
            <div class="grid gap-1.5">
              <Label for="hud-version">Version</Label>
              <Input id="hud-version" v-model="formVersion" />
            </div>
            <div class="grid gap-1.5">
              <Label for="hud-desc">Description</Label>
              <Textarea
                id="hud-desc"
                v-model="formDescription"
                rows="2"
              />
            </div>
            <div class="flex items-center gap-2">
              <Switch id="hud-public" v-model="formIsPublic" />
              <Label for="hud-public">Visible to all organizers</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" @click="dialogOpen = false">Cancel</Button>
            <Button :disabled="isUploading" @click="submit">
              <Loader2 v-if="isUploading" class="size-4 mr-2 animate-spin" />
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </PageTransition>

  <PageTransition :delay="100">
    <div class="grid gap-2">
      <Card v-if="!loading && huds.length === 0">
        <CardContent class="p-6 text-sm text-muted-foreground">
          No HUDs uploaded yet.
        </CardContent>
      </Card>

      <Card v-for="hud in huds" :key="hud.id">
        <CardHeader class="flex flex-row items-center gap-3 space-y-0 pb-2">
          <CardTitle class="text-base flex items-center gap-2 min-w-0">
            <Star
              v-if="hud.is_default"
              class="size-4 text-[hsl(var(--tac-amber))]"
            />
            <span class="truncate">{{ hud.name }}</span>
            <code class="text-xs font-mono text-muted-foreground">
              {{ hud.slug }}
            </code>
          </CardTitle>
          <span class="ml-auto inline-flex items-center gap-2 text-xs">
            <Globe v-if="hud.is_public" class="size-3.5" />
            <Lock v-else class="size-3.5" />
            <span>{{ fmtBytes(hud.size_bytes) }}</span>
            <span v-if="hud.version">v{{ hud.version }}</span>
          </span>
        </CardHeader>
        <CardContent class="flex flex-wrap items-center gap-2 pt-0">
          <p
            v-if="hud.description"
            class="flex-1 min-w-0 text-xs text-muted-foreground"
          >
            {{ hud.description }}
          </p>
          <div class="flex gap-2 ml-auto">
            <Button
              v-if="!hud.is_default"
              size="sm"
              variant="outline"
              @click="setDefault(hud)"
            >
              <Star class="size-3.5 mr-1" />
              Set as default
            </Button>
            <Button
              v-else
              size="sm"
              variant="outline"
              @click="clearDefault"
            >
              Clear default
            </Button>
            <Button size="sm" variant="destructive" @click="remove(hud)">
              <Trash2 class="size-3.5 mr-1" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </PageTransition>
</template>
