<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@felinic/ui'
import { Github, Globe2, Mail, ShieldCheck } from 'lucide-vue-next'
import brandLockup from '@/assets/milksu-brand-lockup.png'
import loginActivityMap from '@/assets/milksu-login-activity-map.png'
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
  <main class="account-login game-shell tactical-dark-surface flex min-h-screen min-w-0 bg-background text-foreground" aria-label="登录 MilkSU">
    <section class="flex min-w-0 flex-1 flex-col px-10 py-9 md:px-20 md:py-16">
      <header class="flex items-center gap-3">
        <img :src="brandLockup" alt="MilkSU" class="h-[2.6rem] w-auto object-contain">
      </header>

      <div class="my-auto w-full max-w-[540px] py-14">
        <p class="game-kicker">Private Beta Access</p>
        <h1 class="mt-3 text-5xl font-semibold tracking-[-0.05em]">
          登录 <span class="text-primary">MilkSU</span>
        </h1>
        <p class="mt-5 text-lg leading-7 text-muted-foreground">{{ stateMessage }}</p>
        <p v-if="error" class="mt-4 border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive" role="alert">
          {{ error }}
        </p>

        <Button
          size="lg"
          variant="brand"
          class="mt-10 h-16 w-full justify-start px-6 text-lg"
          :disabled="busy || status.state === 'authorizing'"
          :loading="busy"
          @click="$emit('login')"
        >
          <Github class="mr-5 size-7" />
          <span class="border-l border-white/25 pl-5">{{ loginLabel }}</span>
        </Button>

        <div class="mt-9 space-y-4 text-sm text-muted-foreground">
          <p class="flex items-center gap-3"><Globe2 class="size-4 text-info" />将在系统浏览器中完成登录</p>
          <p class="flex items-center gap-3"><ShieldCheck class="size-4 text-primary" />MilkSU 不保存你的 GitHub 密码</p>
        </div>

        <div class="mt-10 border-t border-border pt-8">
          <Button variant="ghost" class="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" @click="$emit('continueLocal')">
            暂不登录，使用自己的 API Key
          </Button>
          <a href="mailto:milksu@proton.me" class="mt-5 flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-primary">
            <Mail class="size-4" />尚未收到邀请？联系 milksu@proton.me
          </a>
        </div>
      </div>
    </section>

    <aside class="game-grid hidden w-[46%] shrink-0 items-center justify-end overflow-hidden border-l border-border bg-card/25 xl:flex" aria-hidden="true">
      <img :src="loginActivityMap" alt="" class="h-auto w-full max-w-[668px] object-contain object-right">
    </aside>
  </main>
</template>
