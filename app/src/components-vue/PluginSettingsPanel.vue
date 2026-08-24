<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Badge, Button, Switch } from '@felinic/ui'
import { Copy, PackagePlus, Puzzle, RotateCcw, ShieldX, Trash2, Undo2 } from 'lucide-vue-next'
import { desktopErrorMessage, invokeCommand } from '@/desktop'
import {
  buildPluginFrameDocument,
  buildPluginFrameThemeMessage,
  createPluginFrameNonce,
  pluginUIProtocol,
  type PluginFrameTheme,
} from '@/lib/pluginFrame'
import type {
  PluginBackgroundChoice,
  PluginDescriptor,
  PluginMCPConfig,
  PluginPublisherTrust,
  PluginSurfaceSlot,
  StagedPluginReview,
} from '@/pluginTypes'

const props = defineProps<{
  theme: PluginFrameTheme
}>()

const plugins = ref<PluginDescriptor[]>([])
const selectedId = ref('')
const loading = ref(false)
const toggling = ref('')
const error = ref('')
const iframe = ref<HTMLIFrameElement | null>(null)
const frameNonce = ref('')
const frameDocument = ref('')
const mcpConfig = ref<PluginMCPConfig | null>(null)
const staged = ref<StagedPluginReview | null>(null)
const publishers = ref<PluginPublisherTrust[]>([])
const trustApproved = ref(false)
const sensitiveApproved = ref(false)
const resetStorageApproved = ref(false)

const selected = computed(() => plugins.value.find(plugin => plugin.id === selectedId.value))

async function loadPlugins() {
  loading.value = true
  error.value = ''
  try {
    plugins.value = await invokeCommand<PluginDescriptor[]>('list_plugins')
    if (!plugins.value.some(plugin => plugin.id === selectedId.value)) {
      selectedId.value = plugins.value[0]?.id ?? ''
    }
    mcpConfig.value = await invokeCommand<PluginMCPConfig>('get_plugin_mcp_config').catch(() => null)
    publishers.value = await invokeCommand<PluginPublisherTrust[]>('list_plugin_publishers').catch(() => [])
    await loadSelectedFrame()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    loading.value = false
  }
}

async function choosePackage() {
  error.value = ''
  try {
		await discardStaged()
    const review = await invokeCommand<StagedPluginReview>('choose_plugin_package')
    staged.value = review.token ? review : null
    trustApproved.value = review.trusted
    sensitiveApproved.value = !(review.permission_expansion || review.major_version_change)
    resetStorageApproved.value = false
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  }
}

async function discardStaged() {
	const token = staged.value?.token
	staged.value = null
	if (token) await invokeCommand('discard_staged_plugin', { token }).catch(() => undefined)
}

async function installStaged() {
  if (!staged.value) return
  loading.value = true
  error.value = ''
  try {
    plugins.value = await invokeCommand<PluginDescriptor[]>('install_staged_plugin', {
      token: staged.value.token,
      trustPublisher: trustApproved.value,
      confirmSensitiveChange: sensitiveApproved.value,
      resetStorage: resetStorageApproved.value,
    })
    selectedId.value = staged.value.id
    staged.value = null
    await loadSelectedFrame()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    loading.value = false
  }
}

async function rollbackSelected() {
  if (!selected.value) return
  error.value = ''
  try {
    plugins.value = await invokeCommand<PluginDescriptor[]>('rollback_plugin', { id: selected.value.id })
    await loadSelectedFrame()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  }
}

async function uninstallSelected(deleteData: boolean) {
  if (!selected.value) return
  error.value = ''
  try {
    plugins.value = await invokeCommand<PluginDescriptor[]>('uninstall_plugin', { id: selected.value.id, deleteData })
    selectedId.value = plugins.value[0]?.id ?? ''
    await loadSelectedFrame()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  }
}

async function setExternal(plugin: PluginDescriptor, enabled: boolean) {
  error.value = ''
  try {
    plugins.value = await invokeCommand<PluginDescriptor[]>('set_plugin_external_enabled', { id: plugin.id, enabled })
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  }
}

async function revokePublisher(keyId: string) {
  error.value = ''
  try {
    plugins.value = await invokeCommand<PluginDescriptor[]>('revoke_plugin_publisher', { keyId })
    publishers.value = await invokeCommand<PluginPublisherTrust[]>('list_plugin_publishers')
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  }
}

async function selectPlugin(id: string) {
  selectedId.value = id
  await loadSelectedFrame()
}

async function loadSelectedFrame() {
  frameDocument.value = ''
  frameNonce.value = ''
  const plugin = selected.value
  if (!plugin?.enabled || !plugin.has_settings || plugin.status === 'error') return
  try {
    const nonce = createPluginFrameNonce()
    frameNonce.value = nonce
    frameDocument.value = buildPluginFrameDocument(plugin.id, nonce, props.theme)
    await nextTick()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  }
}

function syncFrameTheme() {
  const plugin = selected.value
  const target = iframe.value?.contentWindow
  if (!plugin || !target || !frameNonce.value) return
  target.postMessage(buildPluginFrameThemeMessage(plugin.id, frameNonce.value, props.theme), '*')
}

async function setEnabled(plugin: PluginDescriptor, enabled: boolean) {
  toggling.value = plugin.id
  error.value = ''
  try {
    plugins.value = await invokeCommand<PluginDescriptor[]>('set_plugin_enabled', { id: plugin.id, enabled })
    await loadSelectedFrame()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    toggling.value = ''
  }
}

async function onPluginMessage(event: MessageEvent) {
  const frameWindow = iframe.value?.contentWindow
  const message = event.data
  if (
    !frameWindow
    || event.source !== frameWindow
    || message?.protocol !== pluginUIProtocol
    || message?.pluginId !== selected.value?.id
    || message?.nonce !== frameNonce.value
    || typeof message?.requestId !== 'string'
  ) return
  const response = {
    protocol: pluginUIProtocol,
    pluginId: message.pluginId,
    nonce: frameNonce.value,
    requestId: message.requestId,
  }
  try {
    let value: unknown
    if (message.method === 'call_ui' && typeof message.action === 'string') {
      value = await invokeCommand('call_plugin_ui', {
        id: message.pluginId,
        request: { action: message.action, input: message.input ?? {} },
      })
    } else if (message.method === 'choose_surface' && message.action === 'choose') {
      const slot = message.input?.slot as PluginSurfaceSlot
      value = await invokeCommand<PluginBackgroundChoice>('choose_plugin_surface', { id: message.pluginId, slot })
    } else if (message.method === 'choose_background' && message.action === 'choose') {
      value = await invokeCommand<PluginBackgroundChoice>('choose_plugin_background', { id: message.pluginId })
    } else {
      throw new Error('插件请求了未授权的设置能力')
    }
    frameWindow.postMessage({ ...response, value }, '*')
  } catch (reason) {
    frameWindow.postMessage({ ...response, error: desktopErrorMessage(reason) }, '*')
  }
}

async function copyMCPConfig() {
  if (!mcpConfig.value?.available) return
  await navigator.clipboard.writeText(JSON.stringify(mcpConfig.value.configuration, null, 2))
}

onMounted(() => {
  window.addEventListener('message', onPluginMessage)
  void loadPlugins()
})
watch(() => props.theme, syncFrameTheme)
onBeforeUnmount(() => {
	window.removeEventListener('message', onPluginMessage)
	void discardStaged()
})
</script>

<template>
  <section class="plugin-settings-grid">
    <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div>
        <h2 class="text-lg font-semibold">插件框架</h2>
        <p class="mt-1 max-w-2xl text-caption leading-5 text-muted-foreground">
          支持本地签名的 milksu.plugin/v1 包；首次安装核对发布者指纹、权限、表面与工具后再加入本机信任库。
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" @click="choosePackage">
          <PackagePlus class="size-3.5" />安装插件
        </Button>
        <Button variant="outline" size="sm" :disabled="!mcpConfig?.available" @click="copyMCPConfig">
          <Copy class="size-3.5" />复制 MCP 配置
        </Button>
        <Button variant="outline" size="sm" :loading="loading" @click="loadPlugins">
          <RotateCcw class="size-3.5" />刷新
        </Button>
      </div>
    </header>

    <p v-if="error" class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-caption text-destructive">{{ error }}</p>

    <section v-if="staged" class="rounded-lg border border-primary/40 bg-card p-4 text-caption" data-plugin-surface="workspace-list">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h3 class="text-control font-semibold">{{ staged.upgrade ? '升级确认' : '首次安装确认' }} · {{ staged.name }} {{ staged.version }}</h3><p class="mt-1 text-muted-foreground">{{ staged.publisher.name }} · <span class="font-mono">{{ staged.fingerprint }}</span></p></div>
        <Badge :variant="staged.trusted ? 'secondary' : 'outline'">{{ staged.key_rotation ? '共同签名密钥轮换' : staged.trusted ? '发布者已信任' : '新发布者' }}</Badge>
      </div>
      <dl class="mt-3 grid grid-cols-[7rem_1fr] gap-2">
        <dt class="text-muted-foreground">兼容范围</dt><dd>MilkSU ≥ {{ staged.host_min_version }}</dd>
        <dt class="text-muted-foreground">权限</dt><dd>{{ staged.permissions.join(' · ') || '无' }}</dd>
        <dt class="text-muted-foreground">表面</dt><dd>{{ staged.surfaces.join(' · ') || '无' }}</dd>
        <dt class="text-muted-foreground">只读工具</dt><dd>{{ staged.tools.map(tool => tool.name).join(' · ') || '无' }}</dd>
        <dt class="text-muted-foreground">摘要</dt><dd class="truncate font-mono" :title="staged.digest">{{ staged.digest }}</dd>
      </dl>
      <label v-if="!staged.trusted" class="mt-3 flex items-center gap-2"><input v-model="trustApproved" type="checkbox">我已核对指纹，并信任此发布者</label>
      <label v-if="staged.permission_expansion || staged.major_version_change" class="mt-2 flex items-center gap-2"><input v-model="sensitiveApproved" type="checkbox">我确认权限扩大或主版本变化</label>
      <p v-if="staged.storage_migration" class="mt-2 text-muted-foreground">此升级包含可回滚的存储迁移。</p>
      <label v-if="staged.storage_reset_required" class="mt-2 flex items-center gap-2 text-destructive"><input v-model="resetStorageApproved" type="checkbox">新版本缺少迁移：删除此插件现有存储后继续</label>
      <div class="mt-4 flex gap-2"><Button size="sm" :disabled="(!staged.trusted && !trustApproved) || ((staged.permission_expansion || staged.major_version_change) && !sensitiveApproved) || (staged.storage_reset_required && !resetStorageApproved)" @click="installStaged">确认{{ staged.upgrade ? '升级' : '安装' }}</Button><Button variant="ghost" size="sm" @click="discardStaged">取消</Button></div>
    </section>

    <div class="plugin-settings-shell grid min-h-[34rem] grid-cols-[minmax(15rem,0.8fr)_minmax(20rem,1.4fr)] overflow-hidden rounded-lg border border-border">
      <div class="plugin-settings-list border-r border-border" data-plugin-surface="workspace-list">
        <button
          v-for="plugin in plugins"
          :key="`${plugin.source}:${plugin.id}`"
          type="button"
          class="plugin-settings-row flex w-full items-start gap-3 border-b border-border px-4 py-4 text-left"
          :class="{ 'is-selected': selectedId === plugin.id }"
          @click="selectPlugin(plugin.id)"
        >
          <span class="plugin-settings-icon mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-border"><Puzzle class="size-4" /></span>
          <span class="min-w-0 flex-1">
            <span class="flex flex-wrap items-center gap-2"><strong class="truncate text-control">{{ plugin.name }}</strong><Badge variant="outline">{{ plugin.runtime }}</Badge></span>
            <span class="mt-1 block truncate font-mono text-caption text-muted-foreground">{{ plugin.id }} · {{ plugin.version }}</span>
            <span v-if="plugin.error" class="mt-1 block text-caption text-destructive">{{ plugin.error }}</span>
          </span>
          <Switch
            :model-value="plugin.enabled"
            :disabled="plugin.status === 'error' || Boolean(toggling)"
            :aria-label="`${plugin.enabled ? '停用' : '启用'}${plugin.name}`"
            @click.stop
            @update:model-value="setEnabled(plugin, Boolean($event))"
          />
        </button>
        <p v-if="!plugins.length && !loading" class="p-5 text-caption text-muted-foreground">没有可用插件。</p>
      </div>

      <div class="plugin-settings-detail min-w-0 p-5">
        <template v-if="selected">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-lg font-semibold">{{ selected.name }}</h3>
            <Badge :variant="selected.source === 'official' ? 'secondary' : 'outline'">{{ selected.source === 'official' ? '官方锁定' : selected.source === 'installed' ? '本地签名包' : '开发目录' }}</Badge>
            <Badge :variant="selected.status === 'error' ? 'destructive' : 'outline'">{{ selected.status }}</Badge>
          </div>
          <dl class="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-caption">
            <dt class="text-muted-foreground">API</dt><dd class="font-mono">{{ selected.api_version }}</dd>
            <dt class="text-muted-foreground">SHA-256</dt><dd class="truncate font-mono" :title="selected.digest">{{ selected.digest || '不可用' }}</dd>
            <dt class="text-muted-foreground">权限</dt><dd class="flex flex-wrap gap-1"><Badge v-for="permission in selected.permissions" :key="permission" variant="outline">{{ permission }}</Badge><span v-if="!selected.permissions.length">无</span></dd>
            <dt v-if="selected.publisher?.name" class="text-muted-foreground">发布者</dt><dd v-if="selected.publisher?.name">{{ selected.publisher.name }}<span v-if="selected.publisher.keyId" class="ml-2 font-mono">{{ selected.publisher.keyId.slice(0, 16) }}…</span></dd>
            <dt class="text-muted-foreground">插槽</dt><dd>{{ selected.contributions.slots?.join(' · ') || '无' }}</dd>
            <dt class="text-muted-foreground">工具</dt><dd>{{ selected.contributions.tools?.map(tool => `${tool.name} (${tool.effect})`).join(' · ') || '无' }}</dd>
          </dl>
          <div v-if="selected.permissions.includes('mcp.external.read')" class="mt-4 flex items-center justify-between rounded-md border border-border p-3 text-caption"><div><strong>外部 MCP</strong><p class="mt-1 text-muted-foreground">默认关闭；修改后不支持工具通知的客户端需要重新连接。</p></div><Switch :model-value="Boolean(selected.external_enabled)" :disabled="!selected.enabled" @update:model-value="setExternal(selected, Boolean($event))" /></div>
          <div v-if="selected.source === 'installed'" class="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" :disabled="!selected.can_rollback" @click="rollbackSelected"><Undo2 class="size-3.5" />回滚上一版本</Button>
            <Button variant="outline" size="sm" @click="uninstallSelected(false)"><Trash2 class="size-3.5" />卸载并保留数据</Button>
            <Button variant="destructive" size="sm" @click="uninstallSelected(true)"><Trash2 class="size-3.5" />卸载并删除数据</Button>
          </div>
          <div v-if="selected.enabled && frameDocument" class="plugin-settings-frame mt-5 overflow-hidden rounded-lg border border-border">
            <iframe ref="iframe" :title="`${selected.name} 设置`" :srcdoc="frameDocument" sandbox="allow-scripts" referrerpolicy="no-referrer" class="h-96 w-full border-0" @load="syncFrameTheme" />
          </div>
          <p v-else-if="!selected.enabled" class="mt-5 rounded-md border border-border bg-muted/20 p-4 text-caption text-muted-foreground">启用插件后才会创建隔离的设置面板。</p>
          <p v-else-if="!selected.has_settings" class="mt-5 text-caption text-muted-foreground">此插件没有设置面板。</p>
        </template>
      </div>
    </div>

    <section v-if="publishers.length" class="rounded-lg border border-border bg-card p-4" data-plugin-surface="workspace-list">
      <h3 class="text-control font-semibold">已信任发布者</h3>
      <div v-for="publisher in publishers" :key="publisher.key_id" class="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-caption"><div class="min-w-0"><strong>{{ publisher.name }}</strong><p class="truncate font-mono text-muted-foreground" :title="publisher.key_id">{{ publisher.key_id }}</p></div><Button variant="outline" size="sm" @click="revokePublisher(publisher.key_id)"><ShieldX class="size-3.5" />撤销信任</Button></div>
    </section>
  </section>
</template>

<style scoped>
.plugin-settings-grid { display: grid; gap: 1.25rem; }
.plugin-settings-shell { background-color: var(--card); color: var(--card-foreground); }
.plugin-settings-list { background-color: color-mix(in srgb, var(--muted) 34%, var(--card)); }
.plugin-settings-row { background-color: transparent; color: var(--foreground); transition: background-color 120ms ease, box-shadow 120ms ease; }
.plugin-settings-row:hover { background-color: var(--overlay-hover-light); }
.plugin-settings-row.is-selected { background-color: var(--overlay-active); box-shadow: inset 3px 0 0 var(--brand); }
.plugin-settings-icon, .plugin-settings-frame { background-color: var(--background); }
.plugin-settings-detail { background-color: var(--card); }
</style>
