<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Badge, Button, Input, NativeSelect, NativeSelectOption } from '@felinic/ui'
import { Check, Network, ShieldAlert, X } from 'lucide-vue-next'
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
    directory: '目录',
    lab: 'Lab',
    browser_tab: '浏览器',
  } as Record<string, string>)[kind] ?? kind
}

function requesterLabel(request: CTFEndpointRequest) {
  if (request.requestedBy === 'agent') return 'Agent 提出'
  if (request.requestedBy === 'page') return '页面发现'
  return '你提出'
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
  <section
    v-if="!pendingOnly || pending.length"
    :class="embedded ? '' : 'rounded-xl border border-border bg-card p-5'"
    aria-labelledby="endpoint-authorization-title"
  >
    <div class="flex items-start gap-3">
      <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Network class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <h2 id="endpoint-authorization-title" class="text-label font-medium">
          {{ pendingOnly ? '批准新的 Endpoint' : 'Endpoint 授权' }}
        </h2>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          {{ pendingOnly
            ? '这个地址仍只是一项申请。你批准后只生成一个协议、一个目标的 Scope；通用 Shell 仍然禁网。'
            : '新地址只会进入待确认列表。批准一项只生成一个协议、一个目标的 Scope；通用 Shell 始终禁网。' }}
        </p>
      </div>
      <Badge v-if="pending.length" variant="outline">{{ pending.length }} 待确认</Badge>
    </div>

    <div v-if="pending.length" class="mt-4 space-y-3" aria-label="待确认 Endpoint">
      <article
        v-for="request in pending"
        :key="request.id"
        class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{{ protocolLabel(request.protocol) }}</Badge>
          <span class="font-mono text-caption">{{ request.host }}:{{ request.port }}</span>
          <span class="text-caption text-muted-foreground">{{ requesterLabel(request) }}</span>
        </div>
        <dl class="mt-3 space-y-2 text-caption leading-5">
          <div>
            <dt class="text-muted-foreground">来源</dt>
            <dd>{{ request.source }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">用途</dt>
            <dd>{{ request.purpose }}</dd>
          </div>
        </dl>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            :disabled="working || terminal"
            @click="emit('approve', request.id)"
          >
            <Check class="size-3.5" />
            仅批准此 Endpoint
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="working || terminal"
            @click="emit('deny', request.id)"
          >
            <X class="size-3.5" />
            拒绝
          </Button>
        </div>
      </article>
    </div>

    <form
      v-if="!pendingOnly"
      class="mt-4 space-y-3 border-t border-border pt-4"
      @submit.prevent="submitRequest"
    >
      <p class="text-caption font-medium">手动提出一个地址</p>
      <div class="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)]">
        <label class="space-y-1">
          <span class="text-caption text-muted-foreground">协议</span>
          <NativeSelect v-model="protocol" aria-label="Endpoint 协议">
            <NativeSelectOption value="http">HTTP</NativeSelectOption>
            <NativeSelectOption value="https">HTTPS</NativeSelectOption>
            <NativeSelectOption value="tcp">TCP</NativeSelectOption>
            <NativeSelectOption value="ssh">SSH</NativeSelectOption>
          </NativeSelect>
        </label>
        <label class="space-y-1">
          <span class="text-caption text-muted-foreground">域名 / IP 与端口</span>
          <Input v-model="endpoint" :placeholder="endpointPlaceholder" maxlength="4096" />
        </label>
      </div>
      <label class="block space-y-1">
        <span class="text-caption text-muted-foreground">来源</span>
        <Input
          v-model="source"
          placeholder="例如：题目页面、Agent 对附件的观察"
          maxlength="240"
        />
      </label>
      <label class="block space-y-1">
        <span class="text-caption text-muted-foreground">用途</span>
        <Input
          v-model="purpose"
          placeholder="说明为什么需要访问这个精确目标"
          maxlength="500"
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        :disabled="!formComplete || working || terminal"
      >
        提交授权申请
      </Button>
    </form>

    <div v-if="!pendingOnly" class="mt-4 border-t border-border pt-4">
      <p class="text-caption font-medium">当前授权目标</p>
      <div class="mt-2 space-y-2">
        <div
          v-for="target in sourceScope.targets"
          :key="`source:${target.kind}:${target.value}`"
          class="rounded-lg bg-muted/50 px-3 py-2"
        >
          <p class="text-caption text-muted-foreground">
            {{ targetKindLabel(target.kind) }} · 题目准入
          </p>
          <p class="mt-1 break-all font-mono text-caption leading-5">{{ target.value }}</p>
        </div>
        <template v-for="scope in networkScopes" :key="scope.id">
          <div
            v-for="target in scope.targets"
            :key="`${scope.id}:${target.kind}:${target.value}`"
            class="rounded-lg bg-muted/50 px-3 py-2"
          >
            <p class="text-caption text-muted-foreground">
              {{ targetKindLabel(target.kind) }} · 单独批准
            </p>
            <p class="mt-1 break-all font-mono text-caption leading-5">{{ target.value }}</p>
          </div>
        </template>
      </div>
      <p class="mt-3 flex gap-2 text-caption leading-5 text-muted-foreground">
        <ShieldAlert class="mt-0.5 size-3.5 shrink-0" />
        HTTP 不继承 Cookie 或浏览器会话；SSH 目前只读服务 Banner，不发送用户名、密钥或命令。
      </p>
    </div>

    <details v-if="!pendingOnly && decided.length" class="mt-4 border-t border-border pt-3">
      <summary class="cursor-pointer text-caption text-muted-foreground">
        已处理申请 {{ decided.length }} 项
      </summary>
      <ul class="mt-2 space-y-1 text-caption text-muted-foreground">
        <li v-for="request in decided" :key="request.id">
          {{ protocolLabel(request.protocol) }} · {{ request.host }}:{{ request.port }} ·
          {{ request.status === 'approved' ? '已批准' : '已拒绝' }}
        </li>
      </ul>
    </details>
  </section>
</template>
