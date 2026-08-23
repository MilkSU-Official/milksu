<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { invokeCommand } from '@/desktop'
import type { CodingArtifactPreview } from '@/codingEnvironmentTypes'

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
      relativePath: 'related.md',
    })
  } catch {
    preview.value = null
  }
}

onMounted(load)
watch(() => [props.workspacePath, props.refreshKey], load)
</script>

<template>
  <article class="related-cve-panel" data-testid="related-cves">
    <MarkdownContent v-if="preview?.kind === 'markdown' && preview.content" :content="preview.content" />
  </article>
</template>
