<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@felinic/ui'
import { Github, Globe2, Mail, ShieldCheck } from 'lucide-vue-next'
import appIcon from '@/assets/milksu-app-icon.png'
import type { AccountStatus } from '@/types'

const props = defineProps<{
  status: AccountStatus
  busy: boolean
  error?: string
}>()

defineEmits<{
  login: []
  continueLocal: []
}>()

const stateMessage = computed(() => {
  if (props.status.state === 'authorizing') return '浏览器授权完成后会自动回到 MilkSU。'
  if (props.status.state === 'invitation_required') return '这个 GitHub 账号尚未获得内测邀请。'
  if (props.status.state === 'suspended') return '这个内测账号当前已暂停访问。'
  if (props.status.state === 'unavailable') return '账户服务暂时不可用，你仍可使用自己的 API Key。'
  return '使用受邀的 GitHub 账号继续'
})

const loginLabel = computed(() => props.status.state === 'authorizing' ? '等待 GitHub 授权' : '使用 GitHub 登录')
</script>

<template>
  <main class="account-login flex min-h-screen min-w-0 bg-[#071524] text-slate-100" aria-label="登录 MilkSU">
    <section class="flex min-w-0 flex-1 flex-col px-10 py-9 md:px-20 md:py-16">
      <header class="flex items-center gap-3">
        <img :src="appIcon" alt="MilkSU" class="size-10 rounded-xl object-cover">
        <span class="text-xl font-semibold tracking-tight">MilkSU</span>
      </header>

      <div class="my-auto w-full max-w-[520px] py-14">
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-lime-300">Personal Security Workspace</p>
        <h1 class="mt-5 text-5xl font-semibold tracking-[-0.05em] text-white">
          登录 <span class="text-lime-300">MilkSU</span>
        </h1>
        <p class="mt-5 text-lg leading-7 text-slate-300">{{ stateMessage }}</p>
        <p v-if="error" class="mt-4 rounded-lg border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm leading-6 text-rose-100" role="alert">
          {{ error }}
        </p>

        <Button
          size="lg"
          class="mt-10 h-16 w-full justify-start border border-slate-500 bg-slate-950/60 px-6 text-lg text-white hover:bg-slate-900"
          :disabled="busy || status.state === 'authorizing'"
          :loading="busy"
          @click="$emit('login')"
        >
          <Github class="mr-5 size-7" />
          <span class="border-l border-slate-600 pl-5">{{ loginLabel }}</span>
        </Button>

        <div class="mt-9 space-y-4 text-sm text-slate-400">
          <p class="flex items-center gap-3"><Globe2 class="size-4 text-slate-300" />将在系统浏览器中完成登录</p>
          <p class="flex items-center gap-3"><ShieldCheck class="size-4 text-lime-300" />MilkSU 不保存你的 GitHub 密码</p>
        </div>

        <div class="mt-10 border-t border-slate-700/80 pt-8">
          <Button variant="ghost" class="px-0 text-slate-300 hover:bg-transparent hover:text-white" @click="$emit('continueLocal')">
            暂不登录，使用自己的 API Key
          </Button>
          <a href="mailto:milksu@proton.me" class="mt-5 flex w-fit items-center gap-2 text-sm text-slate-400 hover:text-lime-300">
            <Mail class="size-4" />尚未收到邀请？联系 milksu@proton.me
          </a>
        </div>
      </div>
    </section>

    <aside class="hidden w-[38%] shrink-0 border-l border-slate-800/80 xl:flex xl:items-center xl:justify-center">
      <div class="max-w-xs px-10">
        <img :src="appIcon" alt="" class="mx-auto size-40 rounded-[2.25rem] object-cover shadow-2xl shadow-lime-400/10">
        <p class="mt-8 text-center text-sm leading-6 text-slate-400">一个账户连接内测额度；你的项目、会话和个人 API Key 仍然留在本机。</p>
      </div>
    </aside>
  </main>
</template>
