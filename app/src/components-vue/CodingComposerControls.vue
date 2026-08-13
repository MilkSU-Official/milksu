<script setup lang="ts">
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
  ChevronDown,
  Hand,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-vue-next'
import type { CodingApprovalPolicy } from '@/types'
import { useModelCatalog } from '@/modelCatalog'

const { providerGroups, providerModelLabel } = useModelCatalog()

defineProps<{
  running: boolean
  ctfSession: boolean
  approvalPolicy: CodingApprovalPolicy
  approvalLabel: string
  modelKey: string
  automaticModelLabel: string
  compactModelLabel: string
}>()

defineEmits<{
  changeApprovalPolicy: [value: string]
  changeModel: [value: string]
  showPermissions: []
}>()
</script>

<template>
  <div class="composer-controls app-no-drag flex min-w-0 flex-1 items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-1.5">
      <slot name="leading" />

      <DropdownMenu v-if="!ctfSession">
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
                项目内自动执行；越过项目边界或高风险操作时拦截
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
    </div>

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
          ? 'MilkSU 按任务角色自动选择模型；你可以仅为当前对话覆盖'
          : '当前对话固定使用所选模型'"
      >
        <SelectValue>{{ compactModelLabel }}</SelectValue>
      </SelectTrigger>
      <SelectContent size="sm" align="start" :align-offset="0" class="min-w-96">
        <SelectGroup>
          <SelectLabel>自动</SelectLabel>
          <SelectItem value="auto">
            {{ automaticModelLabel }}
          </SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <template
          v-for="(group, groupIndex) in providerGroups"
          :key="group.kind"
        >
          <SelectSeparator v-if="groupIndex > 0" />
          <SelectGroup>
            <SelectLabel>{{ group.label }}</SelectLabel>
            <template v-for="provider in group.providers" :key="provider.id">
              <SelectItem
                v-for="model in provider.models"
                :key="`${provider.id}:${model}`"
                :value="`manual:${provider.id}:${model}`"
              >
                {{ providerModelLabel(provider.id, model) }}
              </SelectItem>
            </template>
          </SelectGroup>
        </template>
      </SelectContent>
    </Select>
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
  width: auto;
  min-width: 7.75rem;
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
  width: min(14rem, 100%);
  min-width: 9rem;
  flex: 1 1 12rem;
  justify-self: end;
  padding-inline: 0.65rem;
}

@container chat-main (max-width: 52rem) {
  .composer-controls {
    flex-wrap: nowrap;
    gap: 0.25rem;
  }

  .composer-permission {
    min-width: 7.5rem;
  }

  .composer-model {
    min-width: 10rem;
    width: min(18rem, 100%);
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
    flex-basis: 10rem;
  }
}
</style>
