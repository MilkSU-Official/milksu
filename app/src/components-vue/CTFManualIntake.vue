<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  SegmentedControl,
  Textarea,
} from '@felinic/ui'
import { FilePlus2, Paperclip, X } from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import { t } from '@/lib/uiLocale'
import type {
  CTFChallengeRequest,
  CTFCollaborationMode,
  CTFMaterialRequest,
} from '@/ctfTypes'

const props = withDefaults(defineProps<{
  loading?: boolean
  error?: string
}>(), {
  loading: false,
  error: '',
})

const emit = defineEmits<{
  submit: [request: CTFChallengeRequest]
}>()

type ManualSourceKind = 'text' | 'url' | 'socket' | 'ssh'

const dialog = ref<HTMLDialogElement | null>(null)
const title = ref('')
const statement = ref('')
const category = ref('misc')
const sourceKind = ref<ManualSourceKind>('text')
const sourceValue = ref('')
const knowledge = ref('')
const collaborationMode = ref<CTFCollaborationMode>('copilot')
const materials = ref<CTFMaterialRequest[]>([])
const materialError = ref('')
const choosingMaterials = ref(false)

const modeItems = computed(() => [
  { value: 'coach' as const, label: t('教练', 'Coach') },
  { value: 'copilot' as const, label: t('搭档', 'Copilot') },
  { value: 'delegate' as const, label: t('代理', 'Delegate') },
])

const sourceLabel = computed(() => {
  switch (sourceKind.value) {
    case 'url': return t('题目或靶机 URL', 'Challenge or target URL')
    case 'socket': return t('TCP 地址', 'TCP address')
    case 'ssh': return t('SSH 地址', 'SSH address')
    default: return ''
  }
})

const sourcePlaceholder = computed(() => {
  switch (sourceKind.value) {
    case 'url': return 'https://ctf.example/challenges/123'
    case 'socket': return 'challenge.example:31337'
    case 'ssh': return 'ssh://player@challenge.example:2222'
    default: return ''
  }
})

const canSubmit = computed(() => (
  title.value.trim().length > 0
  && statement.value.trim().length > 0
  && (sourceKind.value === 'text' || sourceValue.value.trim().length > 0)
))

function open() {
  materialError.value = ''
  if (!dialog.value?.open) dialog.value?.showModal()
}

function close() {
  dialog.value?.close()
}

function resetAndClose() {
  title.value = ''
  statement.value = ''
  category.value = 'misc'
  sourceKind.value = 'text'
  sourceValue.value = ''
  knowledge.value = ''
  collaborationMode.value = 'copilot'
  materials.value = []
  materialError.value = ''
  close()
}

async function chooseMaterials() {
  materialError.value = ''
  choosingMaterials.value = true
  try {
    materials.value = await invokeCommand<CTFMaterialRequest[]>('choose_ctf_materials')
  } catch (reason) {
    materialError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    choosingMaterials.value = false
  }
}

function submit() {
  if (!canSubmit.value || props.loading) return
  const points = knowledge.value
    .split(/[,，\n]+/)
    .map(value => value.trim())
    .filter(Boolean)
  emit('submit', {
    title: title.value.trim(),
    statement: statement.value.trim(),
    category: category.value,
    collaborationMode: collaborationMode.value,
    deferAgent: true,
    trackName: t('自定义 CTF 训练', 'Custom CTF training'),
    humanGoal: t(`完成 ${title.value.trim()}，并保留可复现的假设、实验和平台判题证据。`, `Complete ${title.value.trim()} and keep reproducible hypotheses, experiments, and platform judge evidence.`),
    sourceKind: sourceKind.value,
    sourceUri: sourceKind.value === 'text' ? '' : sourceValue.value.trim(),
    expectedFlag: '',
    knowledgePoints: points,
    materials: materials.value,
  })
}

defineExpose({ open, resetAndClose })
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto max-h-[calc(100vh-3rem)] w-[min(680px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border-menu-elevated bg-card p-0 text-foreground shadow-[var(--shadow-modal)] backdrop:bg-foreground/20 backdrop:backdrop-blur-[2px]"
    aria-labelledby="manual-ctf-title"
  >
    <form class="flex max-h-[calc(100vh-3rem)] flex-col" @submit.prevent="submit">
      <header class="game-grid flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div class="flex items-center gap-3">
          <span class="grid size-9 place-items-center bg-action-soft text-primary">
            <FilePlus2 class="size-4" />
          </span>
          <div>
            <h2 id="manual-ctf-title" class="text-lg font-semibold tracking-[-0.02em]">
              {{ t('新建自定义题目', 'New custom challenge') }}
            </h2>
            <p class="mt-0.5 text-caption text-muted-foreground">{{ t('在本机创建工作区', 'Create a workspace on this machine') }}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" :aria-label="t('关闭', 'Close')" @click="close">
          <X class="size-4" />
        </Button>
      </header>

      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <label class="block">
          <span class="mb-2 block text-label font-medium">{{ t('题目名称', 'Challenge name') }}</span>
          <Input
            v-model="title"
            autofocus
            required
            maxlength="120"
            :placeholder="t('例如：Web warmup', 'Example: Web warmup')"
          />
        </label>

        <label class="block">
          <span class="mb-2 block text-label font-medium">{{ t('题面', 'Statement') }}</span>
          <Textarea
            v-model="statement"
            required
            maxlength="12000"
            class="min-h-32 resize-y"
            :placeholder="t('粘贴题面、Flag 格式和已知限制', 'Paste the statement, flag format, and known constraints')"
          />
        </label>

        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-label font-medium">{{ t('题型', 'Category') }}</span>
            <NativeSelect v-model="category" size="sm">
              <NativeSelectOption value="web">Web</NativeSelectOption>
              <NativeSelectOption value="pwn">Pwn</NativeSelectOption>
              <NativeSelectOption value="reverse">Reverse</NativeSelectOption>
              <NativeSelectOption value="crypto">Crypto</NativeSelectOption>
              <NativeSelectOption value="forensics">Forensics</NativeSelectOption>
              <NativeSelectOption value="misc">Misc</NativeSelectOption>
            </NativeSelect>
          </label>

          <label class="block">
            <span class="mb-2 block text-label font-medium">{{ t('入口', 'Entry') }}</span>
            <NativeSelect v-model="sourceKind" size="sm">
              <NativeSelectOption value="text">{{ t('题面 / 附件', 'Statement / attachment') }}</NativeSelectOption>
              <NativeSelectOption value="url">Web URL</NativeSelectOption>
              <NativeSelectOption value="socket">{{ t('TCP 服务', 'TCP service') }}</NativeSelectOption>
              <NativeSelectOption value="ssh">{{ t('SSH 服务', 'SSH service') }}</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>

        <label v-if="sourceKind !== 'text'" class="block">
          <span class="mb-2 block text-label font-medium">{{ sourceLabel }}</span>
          <Input
            v-model="sourceValue"
            required
            :placeholder="sourcePlaceholder"
            autocomplete="off"
            spellcheck="false"
          />
        </label>

        <label class="block">
          <span class="mb-2 block text-label font-medium">{{ t('知识点', 'Knowledge points') }}</span>
          <Input
            v-model="knowledge"
            :placeholder="t('可选，用逗号分隔', 'Optional, comma-separated')"
          />
        </label>

        <div>
          <span class="mb-2 block text-label font-medium">{{ t('协作方式', 'Collaboration mode') }}</span>
          <SegmentedControl
            v-model="collaborationMode"
            :aria-label="t('协作方式', 'Collaboration mode')"
            :items="modeItems"
          />
        </div>

        <div class="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :loading="choosingMaterials"
            @click="chooseMaterials"
          >
            <Paperclip class="size-4" />
            {{ t('选择附件或截图', 'Choose attachments or screenshots') }}
          </Button>
          <span
            v-if="materials.length"
            class="min-w-0 truncate text-caption text-muted-foreground"
            :title="materials.map(material => material.name).join(' · ')"
          >
            {{ t(`${materials.length} 项 · ${materials.map(material => material.name).join(' · ')}`, `${materials.length} items · ${materials.map(material => material.name).join(' · ')}`) }}
          </span>
        </div>

        <Alert v-if="materialError || error" variant="destructive">
          <AlertDescription>{{ materialError || error }}</AlertDescription>
        </Alert>
      </div>

      <footer class="flex shrink-0 items-center justify-end gap-3 border-t border-border px-6 py-4">
        <Button type="button" variant="ghost" @click="close">{{ t('取消', 'Cancel') }}</Button>
        <Button
          type="submit"
          :disabled="!canSubmit"
          :loading="loading"
          loading-mode="leading"
        >
          {{ t('创建本地工作区', 'Create local workspace') }}
        </Button>
      </footer>
    </form>
  </dialog>
</template>
