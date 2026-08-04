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
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

const props = defineProps<{
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
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
      label: '打开桌面 App 验收产物',
      detail: '浏览器预览只能验证入口；真实 Markdown、HTML 和图片读取必须在 MilkSU 桌面运行时完成。',
      cta: '桌面 App 中验收',
      disabled: true,
    }
  }
  if (preview.value) {
    return {
      label: '把当前预览作为用户可见证据',
      detail: `${artifactKindLabel(preview.value.kind)} · ${preview.value.relativePath} · ${formatBytes(preview.value.sizeBytes)}。如需真实交互，再补 Browser 或 Computer Use 证据。`,
      cta: '重新预览',
      disabled: loading.value,
    }
  }
  if (suggestions.value.length) {
    return {
      label: '预览第一个候选产物',
      detail: `${suggestions.value.length} 个可预览候选；先打开 ${suggestions.value[0]}，再决定是否需要 Browser/Computer Use。`,
      cta: '预览候选',
      disabled: loading.value,
    }
  }
  return {
    label: '输入产物相对路径',
    detail: '支持工作区内 Markdown、HTML、PNG、JPEG、GIF 或 WebP；没有产物候选时请手动填路径。',
    cta: '等待路径',
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
    error.value = '请先选择 Coding 项目。'
    return
  }
  if (!path) {
    preview.value = null
    error.value = '请输入工作区内的相对路径。'
    return
  }
  if (!isPreviewableArtifactPath(path)) {
    preview.value = null
    error.value = '请输入工作区内支持的 Markdown、HTML、PNG、JPEG、GIF 或 WebP 相对路径。'
    return
  }
  if (!desktopRuntime) {
    preview.value = null
    error.value = '浏览器预览不能读取工作区文件；请在打包后的 MilkSU App 中验收真实 Markdown、HTML 或图片产物。'
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
      : '暂时无法预览这个产物。'
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
          placeholder="例如 docs/report.md"
          aria-label="工作区产物相对路径"
        />
        <Button type="submit" size="sm" :disabled="loading">
          <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
          <Search v-else class="size-3.5" />
          预览
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
      <p v-else class="mt-2 text-caption leading-5 text-muted-foreground">
        可输入任意工作区内的 Markdown、HTML、PNG、JPEG、GIF 或 WebP 相对路径。
      </p>
      <p
        v-if="!desktopRuntime"
        class="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-caption leading-5 text-muted-foreground"
      >
        当前是浏览器预览，只能验证面板文案和入口；真实读取工作区产物需要 MilkSU 桌面运行时。
      </p>
      <div class="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3" aria-label="产物预览下一步">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-caption font-medium text-muted-foreground">下一步</p>
            <p class="mt-1 text-body font-medium">{{ artifactNextStep.label }}</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              {{ artifactNextStep.detail }}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="artifactNextStep.disabled"
            aria-label="执行产物预览下一步"
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
        title="Coding HTML 产物预览"
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
      <p class="mt-4 text-label font-medium">预览 Agent 交付的普通产物</p>
      <p class="mt-2 max-w-sm text-body leading-6 text-muted-foreground">
        文件必须位于当前工作区。HTML 会移除活动内容并在无脚本、无网络的隔离页面中渲染。
      </p>
    </div>
  </section>
</template>
