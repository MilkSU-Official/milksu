<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Badge, Button, Input, NativeSelect, NativeSelectOption, SettingsSection } from '@felinic/ui'
import { Check, ShieldAlert, X } from 'lucide-vue-next'
import { redactProviderCredentials } from '@/lib/redaction'
import { t } from '@/lib/uiLocale'
import type {
  CTFEndpointProtocol,
  CTFEndpointRequest,
  CTFEndpointRequestInput,
  CTFScopeGrant,
} from '@/ctfTypes'

const props = defineProps<{
  sourceScope: CTFScopeGrant
  networkScopes: CTFScopeGrant[]
  requests: CTFEndpointRequest[]
  working?: boolean
  terminal?: boolean
  pendingOnly?: boolean
  reviewOnly?: boolean
  embedded?: boolean
}>()

const emit = defineEmits<{
  request: [request: CTFEndpointRequestInput]
  approve: [requestId: string]
  deny: [requestId: string]
}>()

const protocol = ref<CTFEndpointProtocol>('https')
const endpoint = ref('')
const source = ref('')
const purpose = ref('')

const pending = computed(() => props.requests.filter(request => request.status === 'pending'))
const decided = computed(() => props.requests.filter(request => request.status !== 'pending'))
const endpointPlaceholder = computed(() => (
  protocol.value === 'http'
    ? 'http://challenge.example:8080'
    : protocol.value === 'https'
      ? 'https://challenge.example'
      : protocol.value === 'tcp'
        ? 'challenge.example:31337'
        : 'challenge.example:22'
))
const formComplete = computed(() => (
  Boolean(endpoint.value.trim() && source.value.trim() && purpose.value.trim())
))

watch(
  () => props.requests.length,
  (next, previous) => {
    if (next <= previous) return
    endpoint.value = ''
    source.value = ''
    purpose.value = ''
  },
)

function protocolLabel(value: CTFEndpointProtocol) {
  if (value === 'http') return 'HTTP'
  if (value === 'https') return 'HTTPS'
  if (value === 'tcp') return 'TCP'
  return 'SSH'
}

function targetKindLabel(kind: string) {
  return ({
    origin: 'HTTP Origin',
    socket: 'TCP Socket',
    ssh: 'SSH Banner',
    directory: t('目录', 'Directory'),
    lab: 'Lab',
    browser_tab: t('浏览器', 'Browser'),
  } as Record<string, string>)[kind] ?? kind
}

function requesterLabel(request: CTFEndpointRequest) {
  if (request.requestedBy === 'agent') return t('Agent 提出', 'Requested by Agent')
  if (request.requestedBy === 'page') return t('页面发现', 'Found on page')
  return t('你提出', 'Requested by you')
}

function redacted(value: string | number) {
  return redactProviderCredentials(String(value))
}

function submitRequest() {
  if (!formComplete.value || props.working || props.terminal) return
  emit('request', {
    protocol: protocol.value,
    endpoint: endpoint.value.trim(),
    source: source.value.trim(),
    purpose: purpose.value.trim(),
  })
}
</script>

<template>
  <SettingsSection
    v-if="!pendingOnly || pending.length"
    :title="pendingOnly ? t('批准新的 Endpoint', 'Approve a new Endpoint') : reviewOnly ? t('Endpoint 授权记录', 'Endpoint authorization history') : t('Endpoint 授权', 'Endpoint authorization')"
    :class="embedded ? 'contents' : ''"
    aria-labelledby="endpoint-authorization-title"
  >
    <template #actions>
      <Badge v-if="!reviewOnly && pending.length" variant="outline">{{ t(`${pending.length} 待确认`, `${pending.length} pending`) }}</Badge>
    </template>
    <div class="px-5 py-4">

    <div
      v-if="!reviewOnly && pending.length"
      class="mt-4 space-y-3"
      :aria-label="t('待确认 Endpoint', 'Pending Endpoints')"
    >
      <article
        v-for="request in pending"
        :key="request.id"
        class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{{ protocolLabel(request.protocol) }}</Badge>
          <span class="font-mono text-caption">{{ redacted(request.host) }}:{{ redacted(request.port) }}</span>
          <span class="text-caption text-muted-foreground">{{ requesterLabel(request) }}</span>
        </div>
        <dl class="mt-3 space-y-2 text-caption leading-5">
          <div>
            <dt class="text-muted-foreground">{{ t('来源', 'Source') }}</dt>
            <dd>{{ redacted(request.source) }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('用途', 'Purpose') }}</dt>
            <dd>{{ redacted(request.purpose) }}</dd>
          </div>
        </dl>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            :disabled="working || terminal"
            @click="emit('approve', request.id)"
          >
            <Check class="size-3.5" />
            {{ t('仅批准此 Endpoint', 'Approve only this Endpoint') }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="working || terminal"
            @click="emit('deny', request.id)"
          >
            <X class="size-3.5" />
            {{ t('拒绝', 'Deny') }}
          </Button>
        </div>
      </article>
    </div>

    <form
      v-if="!pendingOnly && !reviewOnly"
      class="mt-4 space-y-3 border-t border-border pt-4"
      @submit.prevent="submitRequest"
    >
      <p class="text-caption font-medium">{{ t('手动提出一个地址', 'Request an address manually') }}</p>
      <div class="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)]">
        <label class="space-y-1">
          <span class="text-caption text-muted-foreground">{{ t('协议', 'Protocol') }}</span>
          <NativeSelect v-model="protocol" size="sm" :aria-label="t('Endpoint 协议', 'Endpoint protocol')">
            <NativeSelectOption value="http">HTTP</NativeSelectOption>
            <NativeSelectOption value="https">HTTPS</NativeSelectOption>
            <NativeSelectOption value="tcp">TCP</NativeSelectOption>
            <NativeSelectOption value="ssh">SSH</NativeSelectOption>
          </NativeSelect>
        </label>
        <label class="space-y-1">
          <span class="text-caption text-muted-foreground">{{ t('域名 / IP 与端口', 'Host / IP and port') }}</span>
          <Input v-model="endpoint" size="sm" :placeholder="endpointPlaceholder" maxlength="4096" />
        </label>
      </div>
      <label class="block space-y-1">
        <span class="text-caption text-muted-foreground">{{ t('来源', 'Source') }}</span>
        <Input
          v-model="source"
          :placeholder="t('例如：题目页面、Agent 对附件的观察', 'Example: challenge page, Agent observation of an attachment')"
          maxlength="240"
        />
      </label>
      <label class="block space-y-1">
        <span class="text-caption text-muted-foreground">{{ t('用途', 'Purpose') }}</span>
        <Input
          v-model="purpose"
          :placeholder="t('说明为什么需要访问这个精确目标', 'Explain why this exact target needs to be reached')"
          maxlength="500"
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        :disabled="!formComplete || working || terminal"
      >
        {{ t('提交授权申请', 'Submit authorization request') }}
      </Button>
    </form>

    <div v-if="!pendingOnly" class="mt-4 border-t border-border pt-4">
      <p class="text-caption font-medium">{{ t('当前授权目标', 'Currently authorized targets') }}</p>
      <div class="mt-2 space-y-2">
        <div
          v-for="target in sourceScope.targets"
          :key="`source:${target.kind}:${target.value}`"
          class="rounded-lg bg-muted/50 px-3 py-2"
        >
          <p class="text-caption text-muted-foreground">
            {{ t(`${targetKindLabel(redacted(target.kind))} · 题目准入`, `${targetKindLabel(redacted(target.kind))} · challenge admission`) }}
          </p>
          <p class="mt-1 break-all font-mono text-caption leading-5">{{ redacted(target.value) }}</p>
        </div>
        <template v-for="scope in networkScopes" :key="scope.id">
          <div
            v-for="target in scope.targets"
            :key="`${scope.id}:${target.kind}:${target.value}`"
            class="rounded-lg bg-muted/50 px-3 py-2"
          >
            <p class="text-caption text-muted-foreground">
              {{ t(`${targetKindLabel(redacted(target.kind))} · 单独批准`, `${targetKindLabel(redacted(target.kind))} · separately approved`) }}
            </p>
            <p class="mt-1 break-all font-mono text-caption leading-5">{{ redacted(target.value) }}</p>
          </div>
        </template>
      </div>
      <p class="mt-3 flex gap-2 text-caption leading-5 text-muted-foreground">
        <ShieldAlert class="mt-0.5 size-3.5 shrink-0" />
        {{ t('HTTP 不带浏览器会话；SSH 仅读取 Banner。', 'HTTP does not include the browser session; SSH only reads the Banner.') }}
      </p>
    </div>

    <div
      v-if="reviewOnly && decided.length"
      class="mt-4 border-t border-border pt-3"
    >
      <p class="text-caption font-medium">{{ t(`已处理申请 ${decided.length} 项`, `${decided.length} processed requests`) }}</p>
      <ul class="mt-2 space-y-1 text-caption text-muted-foreground">
        <li v-for="request in decided" :key="request.id">
          {{ protocolLabel(request.protocol) }} · {{ redacted(request.host) }}:{{ redacted(request.port) }} ·
          {{ request.status === 'approved' ? t('已批准', 'Approved') : t('已拒绝', 'Denied') }}
        </li>
      </ul>
    </div>

    <details
      v-else-if="!pendingOnly && decided.length"
      class="mt-4 border-t border-border pt-3"
    >
      <summary class="cursor-pointer text-caption text-muted-foreground">
        {{ t(`已处理申请 ${decided.length} 项`, `${decided.length} processed requests`) }}
      </summary>
      <ul class="mt-2 space-y-1 text-caption text-muted-foreground">
        <li v-for="request in decided" :key="request.id">
          {{ protocolLabel(request.protocol) }} · {{ redacted(request.host) }}:{{ redacted(request.port) }} ·
          {{ request.status === 'approved' ? t('已批准', 'Approved') : t('已拒绝', 'Denied') }}
        </li>
      </ul>
    </details>
    </div>
  </SettingsSection>
</template>
