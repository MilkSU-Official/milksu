<script setup lang="ts">
import { computed } from 'vue'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@felinic/ui'
import {
  Check,
  BrainCircuit,
  ChevronDown,
  Hand,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-vue-next'
import type { CodingApprovalPolicy, ModelThinkingLevel } from '@/types'
import { MODEL_THINKING_LEVEL_LABELS } from '@/lib/modelThinking'
import {
  encodeComposerModelKey,
  parseComposerModelKey,
  useModelCatalog,
} from '@/modelCatalog'
import ModelVendorIcon from '@/components-vue/ModelVendorIcon.vue'

const { pickerGroups, pickerModelLabel } = useModelCatalog()

const props = defineProps<{
  running: boolean
  ctfSession: boolean
  approvalPolicy: CodingApprovalPolicy
  approvalLabel: string
  modelKey: string
  automaticModelLabel: string
  compactModelLabel: string
  thinkingLevels?: ModelThinkingLevel[]
  thinkingLevel?: ModelThinkingLevel
}>()

const emit = defineEmits<{
  changeApprovalPolicy: [value: string]
  changeModel: [value: string]
  changeThinkingLevel: [level: ModelThinkingLevel]
  showPermissions: []
}>()

const thinkingLevels = computed(() => props.thinkingLevels ?? [])
const thinkingIndex = computed(() => Math.max(
  0,
  thinkingLevels.value.indexOf(props.thinkingLevel ?? thinkingLevels.value[0]),
))
const thinkingProgress = computed(() => (
  thinkingLevels.value.length <= 1
    ? 100
    : (thinkingIndex.value / (thinkingLevels.value.length - 1)) * 100
))
const thinkingLabel = computed(() => (
  props.thinkingLevel ? MODEL_THINKING_LEVEL_LABELS[props.thinkingLevel] : ''
))

function changeThinkingIndex(value: string) {
  const level = thinkingLevels.value[Number(value)]
  if (level) emit('changeThinkingLevel', level)
}

/** Text fed to keyword matching for the closed trigger. */
function triggerModelText() {
  if (props.modelKey === 'auto') {
    return `${props.automaticModelLabel} ${props.compactModelLabel}`
  }
  const parsed = parseComposerModelKey(props.modelKey)
  return `${parsed.model ?? ''} ${props.compactModelLabel}`
}
</script>

<template>
  <div class="composer-controls app-no-drag flex min-w-0 flex-1 items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-1.5">
      <slot name="leading" />

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="composer-control composer-permission justify-start rounded-full"
            :class="{ 'composer-permission--full': approvalPolicy === 'full-auto' }"
            :disabled="running"
            aria-label="Coding 权限策略"
            :title="approvalLabel"
          >
            <ShieldAlert
              v-if="approvalPolicy === 'full-auto'"
              class="size-3.5 shrink-0 text-warning"
            />
            <LockKeyhole v-else class="size-3.5 shrink-0" />
            <span class="composer-permission__label">{{ approvalLabel }}</span>
            <ChevronDown class="composer-permission__chevron size-3.5 shrink-0 text-muted-foreground opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          :side-offset="8"
          class="w-[25rem] max-w-[calc(100vw-2rem)] p-0"
        >
          <div class="flex items-center justify-between gap-4 px-4 pb-2 pt-3">
            <p class="text-label font-medium text-muted-foreground">
              应如何批准 MilkSU 操作？
            </p>
            <button
              type="button"
              class="shrink-0 text-label font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
              @click.stop="$emit('showPermissions')"
            >
              了解更多
            </button>
          </div>
          <DropdownMenuItem
            class="approval-option"
            @select="$emit('changeApprovalPolicy', 'ask')"
          >
            <Hand class="approval-option__icon" />
            <div class="min-w-0 flex-1">
              <p class="approval-option__title">请求批准</p>
              <p class="approval-option__description">
                编辑文件、运行命令或使用互联网前始终询问
              </p>
            </div>
            <Check
              v-if="approvalPolicy === 'ask' || approvalPolicy === 'read-only'"
              class="approval-option__check"
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            class="approval-option"
            @select="$emit('changeApprovalPolicy', 'workspace-auto')"
          >
            <ShieldCheck class="approval-option__icon" />
            <div class="min-w-0 flex-1">
              <p class="approval-option__title">替我审批</p>
              <p class="approval-option__description">
                项目内和内置浏览器自动执行；用户浏览器、外部账户或高风险操作仍会拦截
              </p>
            </div>
            <Check
              v-if="approvalPolicy === 'workspace-auto'"
              class="approval-option__check"
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="approval-option approval-option--full"
            @select="$emit('changeApprovalPolicy', 'full-auto')"
          >
            <ShieldAlert class="approval-option__icon" />
            <div class="min-w-0 flex-1">
              <p class="approval-option__title">完全访问权限</p>
              <p class="approval-option__description">
                可不受限制地访问互联网和当前用户可访问的任何文件
              </p>
            </div>
            <Check
              v-if="approvalPolicy === 'full-auto'"
              class="approval-option__check"
            />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <slot name="status" />
    </div>

    <div class="flex min-w-0 items-center gap-1.5">
      <slot name="context" />
      <DropdownMenu v-if="thinkingLevels.length">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="composer-control composer-thinking rounded-full"
            :disabled="running"
            :aria-label="`思考层级：${thinkingLabel}`"
            title="调整当前对话的思考层级"
          >
            <BrainCircuit class="size-3.5 shrink-0" />
            <span>{{ thinkingLabel }}</span>
            <ChevronDown class="size-3.5 shrink-0 text-muted-foreground opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          :side-offset="8"
          class="thinking-menu w-[21rem] max-w-[calc(100vw-2rem)] p-4"
        >
          <div class="flex items-center justify-between gap-4">
            <p class="text-label font-medium">思考层级</p>
            <span class="text-caption font-medium text-primary">{{ thinkingLabel }}</span>
          </div>
          <input
            class="thinking-slider mt-4"
            type="range"
            min="0"
            :max="Math.max(thinkingLevels.length - 1, 0)"
            step="1"
            :value="thinkingIndex"
            :style="{ '--thinking-progress': `${thinkingProgress}%` }"
            aria-label="当前对话思考层级"
            @input="changeThinkingIndex(($event.target as HTMLInputElement).value)"
          >
          <div
            class="mt-2 flex items-center justify-between gap-1"
          >
            <button
              v-for="level in thinkingLevels"
              :key="level"
              type="button"
              class="whitespace-nowrap text-center text-[0.625rem] text-muted-foreground hover:text-foreground"
              :class="{ 'font-semibold text-foreground': level === thinkingLevel }"
              @click.stop="emit('changeThinkingLevel', level)"
            >
              {{ MODEL_THINKING_LEVEL_LABELS[level] }}
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <Select
        :model-value="modelKey"
        :disabled="running"
        @update:model-value="value => $emit('changeModel', String(value ?? ''))"
      >
        <SelectTrigger
          size="sm"
          class="composer-control composer-model min-w-0 rounded-full border-0 bg-transparent shadow-none"
          aria-label="选择本任务模型"
          :title="modelKey === 'auto'
            ? '使用 MilkSU 默认模型；你可以仅为当前对话覆盖'
            : '当前对话固定使用所选模型'"
        >
          <SelectValue>
            <span class="inline-flex min-w-0 items-center gap-1.5">
              <ModelVendorIcon :model="triggerModelText()" class="opacity-90" />
              <span class="min-w-0 truncate">{{ compactModelLabel }}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent size="sm" align="start" :align-offset="0" class="min-w-96">
          <SelectGroup>
            <SelectLabel>Default</SelectLabel>
            <SelectItem value="auto">
              <span class="inline-flex min-w-0 items-center gap-2">
                <ModelVendorIcon :model="automaticModelLabel" />
                <span class="min-w-0 truncate">{{ automaticModelLabel }}</span>
              </span>
            </SelectItem>
          </SelectGroup>
          <SelectSeparator v-if="pickerGroups.length" />
          <template
            v-for="(group, groupIndex) in pickerGroups"
            :key="group.key"
          >
            <SelectSeparator v-if="groupIndex > 0" />
            <SelectGroup>
              <SelectLabel>{{ group.label }}</SelectLabel>
              <SelectItem
                v-for="model in group.models"
                :key="`${group.key}:${model}`"
                :value="encodeComposerModelKey(group.providerId, model, group.source)"
              >
                <span class="inline-flex min-w-0 items-center gap-2">
                  <ModelVendorIcon
                    :model="model"
                    :label="pickerModelLabel(group, model)"
                  />
                  <span class="min-w-0 truncate">{{ pickerModelLabel(group, model) }}</span>
                </span>
              </SelectItem>
            </SelectGroup>
          </template>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>

<style scoped>
.composer-controls {
  flex: 1 1 auto;
}

/*
 * Permission / model share one pill language:
 * transparent at rest, the same soft fill on hover and while open.
 * SelectTrigger normally uses --ui-hover + field hairline; ghost Button uses
 * a ::before shell with --btn-ghost-hover. Normalize both here so the two
 * composer choosers do not flash different hover chips.
 */
.composer-control {
  height: 2rem;
  min-height: 2rem;
  gap: 0.35rem;
  border-radius: 9999px;
  font-size: var(--text-body, 0.75rem);
  line-height: var(--text-body--line-height, 1rem);
  transition:
    background-color 110ms ease,
    color 110ms ease;
}

.composer-control[data-slot='select-trigger'] {
  font-size: var(--text-body, 0.75rem) !important;
  line-height: var(--text-body--line-height, 1rem) !important;
  background-color: transparent !important;
  box-shadow: none !important;
}

.composer-control[data-slot='select-trigger']:hover:not(:disabled),
.composer-control[data-slot='select-trigger'][data-state='open'] {
  background-color: var(--btn-ghost-hover) !important;
}

.composer-control[data-button][data-variant='ghost']::before {
  border-radius: inherit;
  transition:
    background-color 110ms ease,
    scale 0.255s linear(0, 0.3505, 0.7432, 0.9336, 0.9951, 1.0062, 1.0045, 1.0019, 1.0005, 1);
}

.composer-control[data-button][data-variant='ghost']:hover::before,
.composer-control[data-button][data-variant='ghost'][data-state='open']::before,
.composer-control[data-button][data-variant='ghost'][aria-expanded='true']::before {
  background-color: var(--btn-ghost-hover);
}

.composer-permission {
  width: fit-content;
  min-width: 0;
  max-width: 11rem;
  flex: 0 0 auto;
  padding-inline: 0.55rem 0.45rem;
}

.composer-permission__label {
  min-width: 0;
  flex: 0 1 auto;
  overflow: visible;
  white-space: nowrap;
}

.composer-permission--full,
.composer-permission--full:hover {
  color: var(--warning);
}

.approval-option {
  display: flex;
  min-height: 4.5rem;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}

.approval-option__icon {
  width: 1.15rem;
  height: 1.15rem;
  margin-top: 0.15rem;
  flex: none;
}

.approval-option__title {
  font-size: var(--text-label, 0.875rem);
  line-height: 1.25rem;
  font-weight: 600;
}

.approval-option__description {
  margin-top: 0.1rem;
  color: var(--muted-foreground);
  font-size: var(--text-control, 0.875rem);
  line-height: 1.25rem;
}

.approval-option__check {
  width: 1rem;
  height: 1rem;
  margin-top: 0.15rem;
  flex: none;
}

.approval-option--full,
.approval-option--full .approval-option__description,
.approval-option--full .approval-option__icon,
.approval-option--full .approval-option__check {
  color: var(--warning);
}

.composer-model {
  width: fit-content;
  min-width: 0;
  max-width: min(18rem, 100%);
  flex: 0 1 auto;
  justify-self: end;
  margin-left: auto;
  padding-inline: 0.65rem;
}

.composer-thinking {
  flex: 0 0 auto;
  padding-inline: 0.6rem 0.45rem;
}

.thinking-slider {
  --thinking-progress: 0%;
  width: 100%;
  height: 1.5rem;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.thinking-slider::-webkit-slider-runnable-track {
  height: 0.5rem;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    var(--brand) 0 var(--thinking-progress),
    var(--muted) var(--thinking-progress) 100%
  );
}

.thinking-slider::-webkit-slider-thumb {
  width: 1.35rem;
  height: 1.35rem;
  margin-top: -0.425rem;
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 9999px;
  background: var(--background);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--foreground) 18%, transparent);
}

.thinking-slider:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 9999px;
}

@container chat-main (max-width: 52rem) {
  .composer-controls {
    flex-wrap: nowrap;
    gap: 0.25rem;
  }

  .composer-model {
    width: fit-content;
    max-width: min(18rem, 100%);
  }

  .composer-thinking span,
  .composer-thinking svg:last-child {
    display: none;
  }

  .composer-thinking {
    width: 2rem;
    padding-inline: 0;
  }
}

@container chat-main (max-width: 36rem) {
  .composer-permission {
    width: 2rem;
    min-width: 2rem;
    max-width: 2rem;
    flex: 0 0 2rem;
    justify-content: center;
    padding-inline: 0;
  }

  .composer-permission__label,
  .composer-permission__chevron {
    display: none;
  }

  .composer-model {
    min-width: 0;
    max-width: calc(100% - 2.5rem);
  }
}
</style>
