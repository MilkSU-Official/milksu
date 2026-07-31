<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@felinic/ui'
import {
  Bug,
  Code2,
  Flag,
  MessageSquarePlus,
  Search,
  Settings,
  Trash2,
} from 'lucide-vue-next'
import AbilityRadar from '@/components-vue/AbilityRadar.vue'
import milksuAppIcon from '@/assets/milksu-app-icon.png'
import type { NSSCTFTrainingDashboard } from '@/nssctfTrainingTypes'
import type { Conversation } from '@/types'

type Section = 'chat' | 'ctf' | 'vuln'

const props = defineProps<{
  activeSection: Section | 'settings'
  activeConversationId: string | null
  conversations: Conversation[]
  ctfDashboard: NSSCTFTrainingDashboard | null
}>()

defineEmits<{
  new: []
  navigate: [value: Section]
  selectConversation: [id: string]
  deleteConversation: [id: string]
  settings: []
}>()

const query = ref('')
const filtered = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  return normalized
    ? props.conversations.filter(item => item.title.toLowerCase().includes(normalized))
    : props.conversations
})
const abilitySourceText = computed(() => {
  const sources = props.ctfDashboard?.sources ?? []
  if (!sources.length) return '完成第一道真实平台题后开始校准'
  return sources.map(source => `${source.label} ${source.solved}/${source.attempts}`).join(' · ')
})

const navItems = [
  { id: 'ctf' as const, label: 'CTF', icon: Flag },
  { id: 'chat' as const, label: 'Coding', icon: Code2 },
  { id: 'vuln' as const, label: 'CVE', icon: Bug },
]
</script>

<template>
  <aside class="app-drag flex w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
    <div class="px-5 pb-4 pt-5">
      <p class="text-label font-semibold tracking-[-0.02em]">MilkSU</p>
      <p class="mt-0.5 text-caption text-muted-foreground">Security Agent Workspace</p>
    </div>

    <nav class="app-no-drag space-y-1 px-3" aria-label="主要功能">
      <Button
        v-for="item in navItems"
        :key="item.id"
        variant="ghost"
        block
        class="justify-start"
        :data-ui-selected="activeSection === item.id ? '' : undefined"
        @click="$emit('navigate', item.id)"
      >
        <component :is="item.icon" class="size-4" />
        <span class="flex-1 text-left">{{ item.label }}</span>
      </Button>
    </nav>

    <div v-if="activeSection === 'chat'" class="app-no-drag mt-5 flex min-h-0 flex-1 flex-col border-t border-border pt-4">
      <div class="px-3">
        <Button variant="outline" block class="justify-start" @click="$emit('new')">
          <MessageSquarePlus class="size-4" />
          新建编码任务
        </Button>
        <label class="relative mt-3 block">
          <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="query" size="sm" emphasis="subtle" class="pl-8" placeholder="搜索任务" />
        </label>
      </div>

      <div class="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        <p class="px-3 py-2 text-caption font-medium text-muted-foreground">最近任务</p>
        <div v-if="filtered.length" class="space-y-0.5">
          <div
            v-for="conversation in filtered"
            :key="conversation.id"
            class="group flex items-center rounded-md"
            :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
          >
            <Button
              variant="ghost"
              size="sm"
              class="min-w-0 flex-1 justify-start"
              @click="$emit('selectConversation', conversation.id)"
            >
              <span class="truncate">{{ conversation.title }}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="mr-1 opacity-0 group-hover:opacity-100"
              aria-label="删除编码任务"
              @click="$emit('deleteConversation', conversation.id)"
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>
        <p v-else class="px-3 py-3 text-body text-muted-foreground">还没有编码任务</p>
      </div>
    </div>
    <div v-else class="flex-1" />

    <div class="app-no-drag flex items-center justify-between border-t border-border p-3">
      <Popover>
        <PopoverTrigger as-child>
          <button
            type="button"
            class="group relative grid size-10 place-items-center overflow-hidden rounded-full border border-border bg-white transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="查看 CTF 能力"
          >
            <img :src="milksuAppIcon" alt="" class="size-full rounded-full object-cover">
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          :side-offset="12"
          class="w-[540px] max-w-[calc(100vw-5rem)] p-5"
          aria-label="CTF 能力"
        >
          <div class="flex items-center gap-3">
            <img
              :src="milksuAppIcon"
              alt="MilkSU"
              class="size-12 shrink-0 rounded-full border border-border bg-white object-cover"
            >
            <div>
              <p class="text-caption text-muted-foreground">综合分</p>
              <p class="font-mono text-3xl font-semibold leading-none">
                {{ ctfDashboard?.overallConfidence ? ctfDashboard.overallScore : '—' }}
              </p>
            </div>
            <div class="ml-auto text-right text-caption text-muted-foreground">
              <p>真实训练 {{ ctfDashboard?.realAttemptCount ?? 0 }}</p>
              <p class="mt-1">已完成 {{ ctfDashboard?.realSolvedCount ?? 0 }}</p>
            </div>
          </div>

          <div class="mt-5 grid grid-cols-[minmax(280px,1fr)_minmax(150px,.55fr)] items-center gap-6 border-t border-border pt-5">
            <AbilityRadar
              class="mx-auto w-full max-w-[300px]"
              :dimensions="ctfDashboard?.dimensions ?? []"
            />
            <div class="space-y-2.5 border-l border-border pl-5 text-label">
              <div
                v-for="dimension in ctfDashboard?.dimensions ?? []"
                :key="dimension.key"
                class="flex items-center justify-between gap-4"
              >
                <span class="text-muted-foreground">{{ dimension.label }}</span>
                <span class="font-mono text-foreground">
                  {{ dimension.confidence ? dimension.score : '—' }}
                </span>
              </div>
            </div>
          </div>

          <p class="mt-4 truncate border-t border-border pt-4 text-caption text-muted-foreground">
            {{ abilitySourceText }}
          </p>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        aria-label="设置"
        title="设置"
        @click="$emit('settings')"
      >
        <Settings class="size-4" />
      </Button>
    </div>
  </aside>
</template>
