<script setup lang="ts">
import { computed } from 'vue'
import {
  modelVendorLabel,
  modelVendorLobeIcon,
  resolveModelVendor,
  type ModelVendorId,
} from '@/modelVendorIcon'

// Mono marks from https://icons.lobehub.com/ via @lobehub/icons-static-svg.
// Inline SVG (not <img>) so fill="currentColor" follows the product theme.
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw'
import claudeSvg from '@lobehub/icons-static-svg/icons/claude.svg?raw'
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini.svg?raw'
import grokSvg from '@lobehub/icons-static-svg/icons/grok.svg?raw'
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek.svg?raw'
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen.svg?raw'
import mistralSvg from '@lobehub/icons-static-svg/icons/mistral.svg?raw'
import metaSvg from '@lobehub/icons-static-svg/icons/meta.svg?raw'
import kimiSvg from '@lobehub/icons-static-svg/icons/kimi.svg?raw'
import zhipuSvg from '@lobehub/icons-static-svg/icons/zhipu.svg?raw'
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax.svg?raw'
import cohereSvg from '@lobehub/icons-static-svg/icons/cohere.svg?raw'
import perplexitySvg from '@lobehub/icons-static-svg/icons/perplexity.svg?raw'
import groqSvg from '@lobehub/icons-static-svg/icons/groq.svg?raw'

const LOBE_ICON_SVG: Record<string, string> = {
  openai: openaiSvg,
  claude: claudeSvg,
  gemini: geminiSvg,
  grok: grokSvg,
  deepseek: deepseekSvg,
  qwen: qwenSvg,
  mistral: mistralSvg,
  meta: metaSvg,
  kimi: kimiSvg,
  zhipu: zhipuSvg,
  minimax: minimaxSvg,
  cohere: cohereSvg,
  perplexity: perplexitySvg,
  groq: groqSvg,
}

const props = withDefaults(defineProps<{
  /** Model id (preferred) and/or display label used for keyword matching. */
  model?: string
  label?: string
  /** Force a vendor when the caller already resolved it. */
  vendor?: ModelVendorId
  size?: 'sm' | 'md'
  class?: string
}>(), {
  model: '',
  label: '',
  size: 'sm',
})

const resolved = computed(() => props.vendor ?? resolveModelVendor(props.model, props.label))
const title = computed(() => modelVendorLabel(resolved.value))
const sizeClass = computed(() => (props.size === 'md' ? 'size-4' : 'size-3.5'))
const lobeStem = computed(() => modelVendorLobeIcon(resolved.value))
const svgMarkup = computed(() => {
  const stem = lobeStem.value
  if (!stem) return ''
  // Strip the embedded <title> so screen readers use our aria-label once.
  return (LOBE_ICON_SVG[stem] ?? '').replace(/<title>[\s\S]*?<\/title>/i, '')
})
</script>

<template>
  <span
    class="model-vendor-icon inline-flex shrink-0 items-center justify-center text-foreground [&_svg]:size-full"
    :class="[sizeClass, props.class]"
    :title="title"
    :aria-label="title"
    role="img"
  >
    <span
      v-if="svgMarkup"
      class="contents"
      aria-hidden="true"
      v-html="svgMarkup"
    />
    <!-- Unknown / unmatched: generic chip, not a fake brand mark -->
    <svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="size-full opacity-70"
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 9h6M9 12h6M9 15h3" />
    </svg>
  </span>
</template>
