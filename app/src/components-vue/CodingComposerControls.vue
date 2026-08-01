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
  FolderOpen,
  Hand,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-vue-next'
import type {
  CodingApprovalPolicy,
  CodingExecutionMode,
} from '@/types'
import { PROVIDER_GROUPS, providerModelLabel } from '@/types'

defineProps<{
  workspaceName: string
  workspaceLocked: boolean
  running: boolean
  ctfSession: boolean
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  approvalLabel: string
  modelKey: string
  automaticModelLabel: string
  compactModelLabel: string
}>()

defineEmits<{
  chooseWorkspace: []
  changeExecutionMode: [value: string]
  changeApprovalPolicy: [value: string]
  changeModel: [value: string]
  showPermissions: []
}>()
</script>

<template>
  <div class="composer-controls app-no-drag mb-2 flex min-w-0 items-center gap-1.5 px-1">
    <Button
      variant="ghost"
      size="sm"
      class="composer-control composer-workspace min-w-0"
      :disabled="workspaceLocked"
      :title="workspaceLocked
        ? '项目目录在任务开始后锁定；请新建任务来切换项目'
        : '选择项目目录'"
      @click="$emit('chooseWorkspace')"
    >
      <FolderOpen class="size-3.5 shrink-0" />
      <span class="truncate">{{ workspaceName }}</span>
    </Button>

    <Select
      v-if="!ctfSession"
      :model-value="executionMode"
      :disabled="running"
      @update:model-value="value => $emit('changeExecutionMode', String(value ?? ''))"
    >
      <SelectTrigger
        size="sm"
        class="composer-control w-16 border-0 bg-transparent shadow-none"
        aria-label="Coding 执行模式"
        title="Plan 只分析和规划；Go 按右侧权限策略使用工具。"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent size="sm" align="start">
        <SelectItem value="plan">Plan</SelectItem>
        <SelectItem value="go">Go</SelectItem>
      </SelectContent>
    </Select>

    <DropdownMenu v-if="!ctfSession">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="composer-control composer-permission min-w-32 justify-start"
          :class="{ 'composer-permission--full': approvalPolicy === 'full-auto' }"
          :disabled="running"
          aria-label="Coding 权限策略"
        >
          <ShieldAlert
            v-if="approvalPolicy === 'full-auto'"
            class="size-3.5 shrink-0 text-warning"
          />
          <LockKeyhole v-else class="size-3.5 shrink-0" />
          {{ approvalLabel }}
          <ChevronDown class="ml-auto size-3.5 shrink-0 text-muted-foreground" />
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

    <Select
      :model-value="modelKey"
      :disabled="running"
      @update:model-value="value => $emit('changeModel', String(value ?? ''))"
    >
      <SelectTrigger
        size="sm"
        class="composer-control composer-model min-w-0 border-0 bg-transparent shadow-none"
        :class="{ 'ml-auto': ctfSession }"
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
          v-for="(group, groupIndex) in PROVIDER_GROUPS"
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
.composer-workspace {
  max-width: 9rem;
}

.composer-control {
  font-size: var(--text-body, 0.75rem);
  line-height: var(--text-body--line-height, 1rem);
}

.composer-control[data-slot='select-trigger'] {
  font-size: var(--text-body, 0.75rem) !important;
  line-height: var(--text-body--line-height, 1rem) !important;
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
  width: auto;
  flex: 1 1 10rem;
  max-width: 15rem;
}

@container chat-main (max-width: 52rem) {
  .composer-controls {
    flex-wrap: nowrap;
    gap: 0.25rem;
  }

  .composer-workspace {
    max-width: 6rem;
  }

  .composer-permission {
    min-width: 6rem;
  }

  .composer-model {
    min-width: 6rem;
    flex: 1 1 8rem;
    width: auto;
  }
}
</style>
