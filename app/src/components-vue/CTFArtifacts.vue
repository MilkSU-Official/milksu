<script setup lang="ts">
import { computed, ref } from 'vue'
import { Badge, Button } from '@felinic/ui'
import {
  ChevronDown,
  ChevronUp,
  FileArchive,
  FileText,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import { t } from '@/lib/uiLocale'
import type { CTFArtifactPreview, CTFProjection } from '@/ctfTypes'
import type { ArtifactRecord } from '@/runtimeTypes'

const props = defineProps<{
  projection: CTFProjection
}>()

const selectedId = ref('')
const preview = ref<CTFArtifactPreview | null>(null)
const loading = ref(false)
const error = ref('')
const expanded = ref(false)

const artifacts = computed(() => (
  expanded.value || props.projection.artifacts.length <= 5
    ? props.projection.artifacts
    : props.projection.artifacts.slice(-5)
))

function artifactLabel(artifact: ArtifactRecord) {
  const material = props.projection.challenge.materials.find(item => item.artifactId === artifact.id)
  if (material) return material.name
  if (artifact.source.startsWith('action:')) return t('Agent 生成制品', 'Agent-generated artifact')
  return artifact.source || t('Runtime 制品', 'Runtime artifact')
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}

async function selectArtifact(artifact: ArtifactRecord) {
  if (selectedId.value === artifact.id && preview.value) {
    selectedId.value = ''
    preview.value = null
    return
  }
  selectedId.value = artifact.id
  preview.value = null
  error.value = ''
  loading.value = true
  try {
    preview.value = await invokeCommand<CTFArtifactPreview>('get_ctf_artifact_preview', {
      id: props.projection.job.id,
      artifactId: artifact.id,
    })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <details class="group overflow-hidden rounded-menu-shell border border-border bg-card px-5 py-4" aria-labelledby="artifacts-title">
    <summary class="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
      <div>
        <h2 id="artifacts-title" class="flex items-center gap-2 text-label font-medium">
          <FileArchive class="size-4" />
          {{ t('证据制品', 'Evidence artifacts') }}
        </h2>

      </div>
      <span class="flex items-center gap-2"><Badge variant="outline">{{ projection.artifacts.length }}</Badge><ChevronDown class="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></span>
    </summary>

    <div class="mt-4 space-y-2 border-t border-border pt-4">
      <article
        v-for="artifact in artifacts"
        :key="artifact.id"
        class="overflow-hidden rounded-lg border border-border"
      >
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50"
          :aria-expanded="selectedId === artifact.id"
          @click="selectArtifact(artifact)"
        >
          <FileText class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-control font-medium">{{ artifactLabel(artifact) }}</span>
            <span class="mt-0.5 block truncate text-caption text-muted-foreground">
              {{ artifact.mediaType }} · {{ formatBytes(artifact.size) }}
            </span>
          </span>
          <ChevronUp v-if="selectedId === artifact.id" class="size-4 shrink-0" />
          <ChevronDown v-else class="size-4 shrink-0 text-muted-foreground" />
        </button>

        <div v-if="selectedId === artifact.id" class="border-t border-border bg-muted/20 p-3">
          <LoaderCircle v-if="loading" class="size-4 animate-spin text-muted-foreground" />
          <p v-else-if="error" class="text-caption leading-5 text-destructive">{{ error }}</p>
          <template v-else-if="preview">
            <dl class="grid gap-2 text-caption sm:grid-cols-[88px_minmax(0,1fr)]">
              <dt class="text-muted-foreground">SHA-256</dt>
              <dd class="break-all font-mono">{{ preview.artifact.sha256 }}</dd>
              <dt class="text-muted-foreground">{{ t('来源', 'Source') }}</dt>
              <dd class="break-all">{{ preview.artifact.source }}</dd>
              <dt class="text-muted-foreground">{{ t('存储标识', 'Storage ID') }}</dt>
              <dd class="break-all font-mono">{{ preview.artifact.relativePath }}</dd>
            </dl>

            <div v-if="preview.previewable" class="mt-3">
              <div class="mb-2 flex items-center justify-between gap-3">
                <p class="text-caption font-medium">{{ t('只读文本预览', 'Read-only text preview') }}</p>
                <Badge v-if="preview.truncated" variant="secondary">{{ t('前 128 KiB', 'First 128 KiB') }}</Badge>
              </div>
              <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-caption leading-5">{{ preview.content }}</pre>
            </div>
            <p v-else class="mt-3 flex gap-2 rounded-md border border-border bg-background p-3 text-caption leading-5 text-muted-foreground">
              <ShieldCheck class="mt-0.5 size-3.5 shrink-0" />
              {{ preview.reason }}
            </p>
          </template>
        </div>
      </article>
    </div>

    <Button
      v-if="projection.artifacts.length > 5"
      variant="link"
      size="text"
      class="mt-3"
      @click="expanded = !expanded"
    >
      <ChevronUp v-if="expanded" class="size-3.5" />
      <ChevronDown v-else class="size-3.5" />
      {{ expanded ? t('只看最近 5 个', 'Show last 5') : t(`查看全部 ${projection.artifacts.length} 个`, `View all ${projection.artifacts.length}`) }}
    </Button>
  </details>
</template>
