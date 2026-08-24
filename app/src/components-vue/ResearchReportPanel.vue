<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { invokeCommand } from '@/desktop'
import type { CodingArtifactPreview } from '@/codingEnvironmentTypes'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  workspacePath: string
  refreshKey?: number | string | boolean
}>()

const preview = ref<CodingArtifactPreview | null>(null)

async function load() {
  const workspace = props.workspacePath.trim()
  if (!workspace) {
    preview.value = null
    return
  }
  try {
    preview.value = await invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
      workspacePath: workspace,
      relativePath: 'report.md',
    })
  } catch {
    try {
      preview.value = await invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
        workspacePath: workspace,
        relativePath: 'report.html',
      })
    } catch {
      preview.value = null
    }
  }
}

onMounted(load)
watch(() => [props.workspacePath, props.refreshKey], load)
</script>

<template>
  <article class="research-report" data-testid="research-report">
    <MarkdownContent v-if="preview?.kind === 'markdown' && preview.content" :content="preview.content" />
    <iframe
      v-else-if="preview?.kind === 'html' && preview.content"
      class="research-report__html"
      sandbox=""
      :srcdoc="preview.content"
      :title="t('报告', 'Report')"
    />
  </article>
</template>

<style scoped>
.research-report {
  color: #171a1d;
}
.research-report__html {
  width: 100%;
  min-height: 24rem;
  border: 0;
  background: #fff;
}
</style>
