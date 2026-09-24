import {
  modelVendorLabel,
  modelVendorLobeIcon,
  resolveModelVendor,
  type ModelVendorId,
} from '@/modelVendorIcon'
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
import basetenSvg from '@lobehub/icons-static-svg/icons/baseten.svg?raw'
import cerebrasSvg from '@lobehub/icons-static-svg/icons/cerebras.svg?raw'
import huggingfaceSvg from '@lobehub/icons-static-svg/icons/huggingface.svg?raw'
import nvidiaSvg from '@lobehub/icons-static-svg/icons/nvidia.svg?raw'
import openrouterSvg from '@lobehub/icons-static-svg/icons/openrouter.svg?raw'
import togetherSvg from '@lobehub/icons-static-svg/icons/together.svg?raw'
import zaiSvg from '@lobehub/icons-static-svg/icons/zai.svg?raw'
import { cn } from '@/lib/cn'

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
  baseten: basetenSvg,
  cerebras: cerebrasSvg,
  huggingface: huggingfaceSvg,
  nvidia: nvidiaSvg,
  openrouter: openrouterSvg,
  together: togetherSvg,
  zai: zaiSvg,
}

export default function ModelVendorIcon({
  model = '',
  label = '',
  vendor,
  icon,
  size = 'sm',
  className,
}: {
  model?: string
  label?: string
  vendor?: ModelVendorId
  /** LobeHub file stem, used when the row is a provider id rather than a model id. */
  icon?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const resolved = vendor ?? resolveModelVendor(model, label)
  const title = label || modelVendorLabel(resolved)
  const sizeClass = size === 'md' ? 'size-4' : 'size-3.5'
  const lobeStem = icon || modelVendorLobeIcon(resolved)
  const svgMarkup = lobeStem
    ? (LOBE_ICON_SVG[lobeStem] ?? '').replace(/<title>[\s\S]*?<\/title>/i, '')
    : ''

  return (
    <span
      className={cn(
        'model-vendor-icon inline-flex shrink-0 items-center justify-center text-foreground [&_svg]:size-full',
        sizeClass,
        className,
      )}
      title={title}
      aria-label={title}
      role="img"
    >
      {svgMarkup ? (
        <span className="contents" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-full opacity-70"
        >
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M9 9h6M9 12h6M9 15h3" />
        </svg>
      )}
    </span>
  )
}
