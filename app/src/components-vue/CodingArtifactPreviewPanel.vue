<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Badge,
  Button,
  Input,
} from '@felinic/ui'
import {
  FileImage,
  LoaderCircle,
  Search,
} from 'lucide-vue-next'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { redactProviderCredentials } from '@/lib/redaction'
import {
  artifactKindLabel,
  buildArtifactHTMLDocument,
  isPreviewableArtifactPath,
  suggestedArtifactPaths,
} from '@/lib/codingArtifact'
import { t } from '@/lib/uiLocale'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

const props = defineProps<{
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  requestedPath?: string
}>()

const emit = defineEmits<{
  previewed: [preview: CodingArtifactPreview]
}>()

const relativePath = ref('')
const preview = ref<CodingArtifactPreview | null>(null)
const loading = ref(false)
const error = ref('')
const desktopRuntime = hasDesktopRuntime()

const suggestions = computed(() => suggestedArtifactPaths(props.environment))
const htmlSource = computed(() => (
  preview.value?.kind === 'html'
    ? buildArtifactHTMLDocument(redactPreviewText(preview.value.content ?? ''))
    : ''
))
const artifactNextStep = computed<{
  label: string
  detail: string
  cta: string
  disabled: boolean
}>(() => {
  if (!desktopRuntime) {
    return {
      label: t('打开桌面 App 验收产物', 'Open the desktop app to review artifacts'),
      detail: '',
      cta: t('桌面 App 中验收', 'Review in desktop app'),
      disabled: true,
    }
  }
  if (preview.value) {
    return {
      label: preview.value.relativePath,
      detail: `${artifactKindLabel(preview.value.kind)} · ${formatBytes(preview.value.sizeBytes)}`,
      cta: t('重新预览', 'Preview again'),
      disabled: loading.value,
    }
  }
  if (suggestions.value.length) {
    return {
      label: t('预览第一个候选产物', 'Preview the first candidate'),
      detail: t(`${suggestions.value.length} 个可预览候选`, `${suggestions.value.length} previewable candidates`),
      cta: t('预览候选', 'Preview candidate'),
      disabled: loading.value,
    }
  }
  return {
    label: t('输入产物相对路径', 'Enter an artifact relative path'),
    detail: '',
    cta: t('等待路径', 'Waiting for a path'),
    disabled: true,
  }
})

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function redactPreviewText(value: string) {
  return redactProviderCredentials(value)
}

async function refresh() {
  if (loading.value) return
  const path = relativePath.value.trim()
  error.value = ''
  if (!props.workspacePath) {
    preview.value = null
    error.value = t('请先选择 Coding 项目。', 'Choose a Coding project first.')
    return
  }
  if (!path) {
    preview.value = null
    error.value = t('请输入工作区内的相对路径。', 'Enter a relative path inside the workspace.')
    return
  }
  if (!isPreviewableArtifactPath(path)) {
    preview.value = null
    error.value = t('请输入工作区内支持的 Markdown、HTML、PNG、JPEG、GIF 或 WebP 相对路径。', 'Enter a workspace-relative Markdown, HTML, PNG, JPEG, GIF, or WebP path.')
    return
  }
  if (!desktopRuntime) {
    preview.value = null
    error.value = t('浏览器预览不能读取工作区文件；请在打包后的 MilkSU App 中验收真实 Markdown、HTML 或图片产物。', 'Browser preview cannot read workspace files. Review real Markdown, HTML, or image artifacts in the packaged MilkSU app.')
    return
  }
  loading.value = true
  try {
    preview.value = await invokeCommand<CodingArtifactPreview>(
      'get_coding_artifact_preview',
      {
        workspacePath: props.workspacePath,
        relativePath: path,
      },
    )
    relativePath.value = preview.value.relativePath
    emit('previewed', preview.value)
  } catch (reason) {
    preview.value = null
    error.value = reason instanceof Error
      ? reason.message
      : t('暂时无法预览这个产物。', 'This artifact cannot be previewed right now.')
  } finally {
    loading.value = false
  }
}

function selectSuggestion(path: string) {
  relativePath.value = path
  void refresh()
}

function runArtifactNextStep() {
  if (artifactNextStep.value.disabled) return
  if (preview.value || relativePath.value.trim()) {
    void refresh()
    return
  }
  const first = suggestions.value[0]
  if (first) selectSuggestion(first)
}

watch(
  () => props.workspacePath,
  () => {
    relativePath.value = ''
    preview.value = null
    error.value = ''
  },
)

watch(
  () => props.requestedPath,
  path => {
    const next = String(path ?? '').trim()
    if (!next || next === relativePath.value) return
    relativePath.value = next
    void refresh()
  },
)

watch(suggestions, paths => {
  if (!relativePath.value && paths.length) relativePath.value = paths[0]
}, { immediate: true })

watch(
  () => props.environment?.capturedAt,
  (current, previous) => {
    if (current && previous && current !== previous && preview.value && relativePath.value) {
      void refresh()
    }
  },
)

defineExpose({ refresh })
</script>

<template>
  <section class="flex min-h-full flex-col">
    <form class="border-b border-border px-4 py-3" @submit.prevent="refresh">
      <div class="flex items-center gap-2">
        <Input
          v-model="relativePath"
          class="min-w-0 font-mono text-caption"
          autocomplete="off"
          :disabled="loading"
          spellcheck="false"
          :placeholder="t('例如 docs/report.md', 'e.g. docs/report.md')"
          :aria-label="t('工作区产物相对路径', 'Workspace artifact relative path')"
        />
        <Button type="submit" size="sm" :disabled="loading">
          <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
          <Search v-else class="size-3.5" />
          {{ t('预览', 'Preview') }}
        </Button>
      </div>
      <div v-if="suggestions.length" class="mt-2 flex flex-wrap gap-1.5">
        <Button
          v-for="path in suggestions"
          :key="path"
          type="button"
          variant="outline"
          size="sm"
          class="h-7 max-w-full font-mono text-caption"
          :title="redactPreviewText(path)"
          :disabled="loading"
          @click="selectSuggestion(path)"
        >
          <span class="truncate">{{ redactPreviewText(path) }}</span>
        </Button>
      </div>

      <p
        v-if="!desktopRuntime"
        class="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-caption leading-5 text-muted-foreground"
      >
        {{ t('当前是浏览器预览，只能验证面板文案和入口；真实读取工作区产物需要 MilkSU 桌面运行时。', 'This is a browser preview for copy and entry points only. Reading real workspace artifacts needs the MilkSU desktop runtime.') }}
      </p>
      <div class="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3" :aria-label="t('产物预览下一步', 'Artifact preview next step')">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-caption font-medium text-muted-foreground">{{ t('下一步', 'Next step') }}</p>
            <p class="mt-1 text-body font-medium">{{ artifactNextStep.label }}</p>
            <p v-if="artifactNextStep.detail" class="mt-1 text-caption leading-5 text-muted-foreground">
              {{ artifactNextStep.detail }}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="artifactNextStep.disabled"
            :aria-label="t('执行产物预览下一步', 'Run the next artifact preview step')"
            @click="runArtifactNextStep"
          >
            {{ artifactNextStep.cta }}
          </Button>
        </div>
      </div>
    </form>

    <p
      v-if="error"
      class="border-b border-border px-4 py-3 text-caption leading-5 text-destructive"
      role="alert"
    >
      {{ error }}
    </p>

    <template v-if="preview">
      <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <p class="min-w-0 truncate font-mono text-caption" :title="redactPreviewText(preview.relativePath)">
          {{ redactPreviewText(preview.relativePath) }}
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{{ artifactKindLabel(preview.kind) }}</Badge>
          <span class="text-caption text-muted-foreground">
            {{ formatBytes(preview.sizeBytes) }}
          </span>
        </div>
      </div>

      <div
        v-if="preview.kind === 'markdown'"
        class="min-h-0 flex-1 overflow-auto px-6 py-5"
      >
        <MarkdownContent :content="redactPreviewText(preview.content ?? '')" />
      </div>

      <iframe
        v-else-if="preview.kind === 'html'"
        class="min-h-[32rem] flex-1 bg-white"
        :srcdoc="htmlSource"
        sandbox=""
        :title="t('Coding HTML 产物预览', 'Coding HTML artifact preview')"
      />

      <div
        v-else
        class="flex min-h-[28rem] flex-1 items-center justify-center overflow-auto bg-black/20 p-4"
      >
        <img
          :src="preview.dataUrl"
          :alt="redactPreviewText(preview.relativePath)"
          class="max-h-full max-w-full object-contain"
        >
      </div>
    </template>

    <div
      v-else-if="!loading"
      class="flex min-h-80 flex-1 flex-col items-center justify-center px-8 text-center"
    >
      <FileImage class="size-7 text-muted-foreground" />
    </div>
  </section>
</template>
