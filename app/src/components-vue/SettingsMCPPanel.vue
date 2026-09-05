<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  SettingsRow,
  SettingsSection,
  Switch,
  Textarea,
} from '@felinic/ui'
import { Braces, Plus, Trash2 } from 'lucide-vue-next'
import { desktopErrorMessage, invokeCommand, listenEvent } from '@/desktop'
import { t } from '@/lib/uiLocale'
import {
  emptyAgentResourceCatalog,
  type AgentResourceCatalog,
  type AgentResourceMCPInput,
  type AgentResourceMCPServer,
  type AgentResourceMCPTransport,
  type BuiltinConfigHandoff,
} from '@/agentResourceTypes'
import type { SecurityToolSetupSnapshot, SecurityToolSnapshot } from '@/securityToolsTypes'

const emit = defineEmits<{
  codingHandoff: [handoff: BuiltinConfigHandoff]
}>()

const catalog = ref<AgentResourceCatalog>(emptyAgentResourceCatalog())
const tools = ref<SecurityToolSnapshot[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editorOpen = ref(false)
const jsonOpen = ref(false)
const builtinEditorOpen = ref(false)
const formJSON = ref('')
const jsonEditor = ref<{ $el?: HTMLTextAreaElement } | null>(null)
const editingName = ref('')
const formName = ref('')
const formTransport = ref<AgentResourceMCPTransport>('command')
const formCommand = ref('')
const formArgs = ref('')
const formURL = ref('')
const formSocket = ref('')
const formEnv = ref('')
const formHeaders = ref('')
const formBearer = ref('')
const formEnabled = ref(true)
const builtinName = ref('')
const builtinCommand = ref('')
const builtinArgs = ref('')
const setup = ref<SecurityToolSetupSnapshot | null>(null)
let unlistenSetup: (() => void) | undefined

const servers = computed(() => catalog.value.mcpServers)
const editing = computed(() => Boolean(editingName.value))
const builtinRows = computed(() => tools.value.map(tool => {
  const overlay = (catalog.value.builtinMCP ?? []).find(item => item.name === tool.id)
  return {
    tool,
    overlay,
    enabled: overlay?.enabled ?? tool.enabled,
    customized: Boolean(overlay?.customized || overlay?.command),
    command: overlay?.command || '',
    args: overlay?.args ?? [],
  }
}))

function transportLabel(transport: string) {
  switch (transport) {
    case 'command':
      return t('本地进程', 'Local process')
    case 'url':
      return t('远程 HTTP', 'Remote HTTP')
    case 'socket':
      return t('本地 Socket', 'Local socket')
    default:
      return transport
  }
}

function parsePairs(value: string) {
  const result: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    const next = trimmed.slice(index + 1)
    if (key) result[key] = next
  }
  return result
}

function parseArgs(value: string) {
  return value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
}

function builtinDescription(row: (typeof builtinRows.value)[number]) {
  return [
    row.tool.statusLabel,
    row.tool.purpose,
    row.customized ? t('已修改', 'Modified') : '',
  ].filter(Boolean).join(' · ')
}

async function loadCatalog() {
  loading.value = true
  error.value = ''
  const errors: string[] = []
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('list_agent_resource_catalog')
  } catch (reason) {
    errors.push(desktopErrorMessage(reason))
    catalog.value = emptyAgentResourceCatalog()
  }
  try {
    tools.value = await invokeCommand<SecurityToolSnapshot[]>('list_security_tools')
  } catch (reason) {
    errors.push(desktopErrorMessage(reason))
    tools.value = []
  }
  error.value = errors.filter(Boolean).join(' ')
  loading.value = false
}

function startJSONImport() {
  closeEditor()
  closeBuiltinEditor()
  formJSON.value = ''
  jsonOpen.value = true
}

function closeJSONImport() {
  jsonOpen.value = false
  formJSON.value = ''
}

function startCreate() {
  closeJSONImport()
  closeBuiltinEditor()
  editingName.value = ''
  formName.value = ''
  formTransport.value = 'command'
  formCommand.value = ''
  formArgs.value = ''
  formURL.value = ''
  formSocket.value = ''
  formEnv.value = ''
  formHeaders.value = ''
  formBearer.value = ''
  formEnabled.value = true
  editorOpen.value = true
}

function startEdit(server: AgentResourceMCPServer) {
  closeJSONImport()
  closeBuiltinEditor()
  editingName.value = server.name
  formName.value = server.name
  formTransport.value = server.transport
  formCommand.value = server.command ?? ''
  formArgs.value = (server.args ?? []).join('\n')
  formURL.value = server.url ?? ''
  formSocket.value = server.socket ?? ''
  formEnv.value = (server.envNames ?? []).map(name => `${name}=`).join('\n')
  formHeaders.value = (server.headerNames ?? []).map(name => `${name}=`).join('\n')
  formBearer.value = ''
  formEnabled.value = server.enabled
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
  editingName.value = ''
}

function startBuiltinEdit(row: (typeof builtinRows.value)[number]) {
  closeJSONImport()
  closeEditor()
  builtinName.value = row.tool.id
  builtinCommand.value = row.command
  builtinArgs.value = row.args.join('\n')
  builtinEditorOpen.value = true
}

function closeBuiltinEditor() {
  builtinEditorOpen.value = false
  builtinName.value = ''
}

function buildInput(): AgentResourceMCPInput {
  const env = parsePairs(formEnv.value)
  const headers = parsePairs(formHeaders.value)
  const removeEnv = editing.value
    ? (catalog.value.mcpServers.find(server => server.name === editingName.value)?.envNames ?? [])
      .filter(name => !Object.hasOwn(env, name))
    : []
  const removeHeaders = editing.value
    ? (catalog.value.mcpServers.find(server => server.name === editingName.value)?.headerNames ?? [])
      .filter(name => !Object.hasOwn(headers, name))
    : []
  return {
    name: formName.value.trim(),
    enabled: formEnabled.value,
    transport: formTransport.value,
    command: formCommand.value.trim(),
    args: parseArgs(formArgs.value),
    url: formURL.value.trim(),
    socket: formSocket.value.trim(),
    env,
    headers,
    bearerToken: formBearer.value,
    removeEnv,
    removeHeaders,
  }
}

function readJSONDocument() {
  const fromModel = formJSON.value.trim()
  if (fromModel) return fromModel
  return String(jsonEditor.value?.$el?.value ?? '').trim()
}

async function importJSON() {
  const document = readJSONDocument()
  if (!document) return
  saving.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('import_user_mcp_json', {
      document,
    })
    closeJSONImport()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function saveServer() {
  saving.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('upsert_user_mcp_server', {
      input: buildInput(),
    })
    closeEditor()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function setEnabled(name: string, enabled: boolean) {
  saving.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('set_user_mcp_server_enabled', {
      name,
      enabled,
    })
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function removeServer(name: string) {
  saving.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('delete_user_mcp_server', { name })
    if (editingName.value === name) closeEditor()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function setBuiltinEnabled(name: string, enabled: boolean) {
  saving.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('set_builtin_mcp_enabled', {
      name,
      enabled,
    })
    tools.value = tools.value.map(item => item.id === name
      ? { ...item, enabled, usableByAgent: enabled && item.status === 'ready' && item.codingSupported }
      : item)
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function saveBuiltin() {
  if (!builtinName.value) return
  saving.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('upsert_builtin_mcp', {
      input: {
        name: builtinName.value,
        command: builtinCommand.value.trim(),
        args: parseArgs(builtinArgs.value),
      },
    })
    closeBuiltinEditor()
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function restoreBuiltin(name: string) {
  saving.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('restore_builtin_mcp', { name })
    if (builtinName.value === name) closeBuiltinEditor()
    tools.value = await invokeCommand<SecurityToolSnapshot[]>('list_security_tools')
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function startSetup(id: string) {
  saving.value = true
  error.value = ''
  try {
    setup.value = await invokeCommand<SecurityToolSetupSnapshot>('start_security_tool_setup', { id })
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function checkTool(id: string) {
  saving.value = true
  error.value = ''
  try {
    const checked = await invokeCommand<SecurityToolSnapshot>('check_security_tool', { id })
    tools.value = tools.value.map(item => item.id === checked.id ? checked : item)
    if (checked.status === 'ready') setup.value = null
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

async function openBuiltinConversation(name: string) {
  saving.value = true
  error.value = ''
  try {
    emit('codingHandoff', await invokeCommand<BuiltinConfigHandoff>('prepare_builtin_config_handoff', {
      kind: 'mcp',
      name,
    }))
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  unlistenSetup = await listenEvent<SecurityToolSetupSnapshot>('security-tool-setup', event => {
    setup.value = event.payload
    if (event.payload.state === 'completed' || event.payload.state === 'failed') {
      void loadCatalog()
    }
  })
  await loadCatalog()
})

onBeforeUnmount(() => unlistenSetup?.())
</script>

<template>
  <SettingsSection :title="t('内置 MCP', 'Built-in MCP')">
    <p v-if="error" class="px-4 py-3 text-caption text-destructive">{{ error }}</p>
    <SettingsRow
      v-if="setup && setup.state === 'running'"
      :label="t('正在准备', 'Preparing')"
      :description="setup.summary"
    >
      <span class="font-mono text-caption text-primary">{{ setup.percent }}%</span>
    </SettingsRow>
    <SettingsRow
      v-for="row in builtinRows"
      :key="row.tool.id"
      :label="row.tool.name"
      :description="builtinDescription(row)"
    >
      <div class="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="saving"
          @click="startBuiltinEdit(row)"
        >
          {{ t('编辑', 'Edit') }}
        </Button>
        <Button
          v-if="row.customized"
          type="button"
          variant="outline"
          size="sm"
          :disabled="saving"
          @click="restoreBuiltin(row.tool.id)"
        >
          {{ t('恢复默认', 'Restore default') }}
        </Button>
        <Button
          v-if="row.tool.setupSupported && row.tool.status !== 'ready'"
          type="button"
          variant="outline"
          size="sm"
          :disabled="saving"
          @click="startSetup(row.tool.id)"
        >
          {{ row.tool.primaryAction || t('准备', 'Set up') }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="saving"
          @click="checkTool(row.tool.id)"
        >
          {{ t('健康检查', 'Health check') }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="saving"
          @click="openBuiltinConversation(row.tool.id)"
        >
          {{ t('用对话配置', 'Configure in chat') }}
        </Button>
        <Switch
          :model-value="row.enabled"
          :disabled="saving || loading"
          :aria-label="t(`启用${row.tool.name}`, `Enable ${row.tool.name}`)"
          @update:model-value="setBuiltinEnabled(row.tool.id, Boolean($event))"
        />
      </div>
    </SettingsRow>
  </SettingsSection>

  <SettingsSection v-if="builtinEditorOpen" :title="t('编辑内置 MCP', 'Edit built-in MCP')">
    <SettingsRow :label="t('命令', 'Command')">
      <Input
        v-model="builtinCommand"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('覆盖启动命令', 'Override launch command')"
      />
    </SettingsRow>
    <SettingsRow :label="t('参数', 'Arguments')" :divider="false">
      <Textarea
        v-model="builtinArgs"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('每行一个覆盖参数', 'One override argument per line')"
      />
    </SettingsRow>
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="saving" @click="closeBuiltinEditor">
          {{ t('取消', 'Cancel') }}
        </Button>
        <Button type="button" size="sm" :loading="saving" @click="saveBuiltin">
          {{ t('保存', 'Save') }}
        </Button>
      </div>
    </template>
  </SettingsSection>

  <SettingsSection :title="t('用户 MCP', 'User MCP')">
    <template #actions>
      <div class="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          :aria-label="t('导入 MCP JSON', 'Import MCP JSON')"
          :title="t('导入 MCP JSON', 'Import MCP JSON')"
          @click="startJSONImport"
        >
          <Braces class="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          :aria-label="t('添加 MCP 服务器', 'Add an MCP server')"
          :title="t('添加 MCP 服务器', 'Add an MCP server')"
          @click="startCreate"
        >
          <Plus class="size-4" />
        </Button>
      </div>
    </template>
    <SettingsRow
      v-for="server in servers"
      :key="server.name"
      :label="server.name"
      :description="[
        transportLabel(server.transport),
        server.command || server.url || server.socket,
      ].filter(Boolean).join(' · ')"
    >
      <div class="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="saving"
          @click="startEdit(server)"
        >
          {{ t('编辑', 'Edit') }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          :disabled="saving"
          :aria-label="t(`删除 ${server.name}`, `Delete ${server.name}`)"
          @click="removeServer(server.name)"
        >
          <Trash2 class="size-4" />
        </Button>
        <Switch
          :model-value="server.enabled"
          :disabled="saving || loading"
          :aria-label="t(`启用${server.name}`, `Enable ${server.name}`)"
          @update:model-value="setEnabled(server.name, Boolean($event))"
        />
      </div>
    </SettingsRow>
  </SettingsSection>

  <SettingsSection v-if="editorOpen" :title="editing ? t('编辑服务器', 'Edit server') : t('添加服务器', 'Add server')">
    <SettingsRow :label="t('名称', 'Name')">
      <Input
        v-model="formName"
        size="sm"
        class="w-72 max-w-full"
        :disabled="editing || saving"
        :aria-label="t('服务器名称', 'Server name')"
      />
    </SettingsRow>
    <SettingsRow :label="t('传输', 'Transport')">
      <NativeSelect
        :model-value="formTransport"
        size="sm"
        :aria-label="t('传输方式', 'Transport')"
        @update:model-value="formTransport = String($event) as AgentResourceMCPTransport"
      >
        <NativeSelectOption value="command">{{ t('本地进程', 'Local process') }}</NativeSelectOption>
        <NativeSelectOption value="url">{{ t('远程 HTTP', 'Remote HTTP') }}</NativeSelectOption>
        <NativeSelectOption value="socket">{{ t('本地 Socket', 'Local socket') }}</NativeSelectOption>
      </NativeSelect>
    </SettingsRow>
    <SettingsRow v-if="formTransport === 'command'" :label="t('命令', 'Command')">
      <Input
        v-model="formCommand"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('启动命令', 'Launch command')"
      />
    </SettingsRow>
    <SettingsRow v-if="formTransport === 'command'" :label="t('参数', 'Arguments')">
      <Textarea
        v-model="formArgs"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('每行一个参数', 'One argument per line')"
      />
    </SettingsRow>
    <SettingsRow v-if="formTransport === 'url'" :label="t('地址', 'URL')">
      <Input
        v-model="formURL"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('远程地址', 'Remote URL')"
      />
    </SettingsRow>
    <SettingsRow v-if="formTransport === 'socket'" :label="t('Socket', 'Socket')">
      <Input
        v-model="formSocket"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('本地 Socket', 'Local socket')"
      />
    </SettingsRow>
    <SettingsRow :label="t('环境变量', 'Environment')">
      <Textarea
        v-model="formEnv"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('每行一个 KEY=value，留空值表示保持原值', 'One KEY=value per line; empty values keep the stored secret')"
      />
    </SettingsRow>
    <SettingsRow :label="t('请求头', 'Headers')">
      <Textarea
        v-model="formHeaders"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('每行一个 Header=value', 'One Header=value per line')"
      />
    </SettingsRow>
    <SettingsRow :label="t('Bearer', 'Bearer')" :divider="false">
      <Input
        v-model="formBearer"
        type="password"
        size="sm"
        class="w-72 max-w-full"
        :disabled="saving"
        :aria-label="t('Bearer 令牌', 'Bearer token')"
      />
    </SettingsRow>
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="saving" @click="closeEditor">
          {{ t('取消', 'Cancel') }}
        </Button>
        <Button type="button" size="sm" :loading="saving" :disabled="!formName.trim()" @click="saveServer">
          {{ t('保存', 'Save') }}
        </Button>
      </div>
    </template>
  </SettingsSection>

  <SettingsSection v-if="jsonOpen" :title="t('导入 JSON', 'Import JSON')">
    <SettingsRow :label="t('配置', 'Config')" :divider="false">
      <Textarea
        ref="jsonEditor"
        v-model="formJSON"
        size="lg"
        class="w-[28rem] max-w-full min-h-40"
        :disabled="saving"
        :aria-label="t('MCP JSON', 'MCP JSON')"
      />
    </SettingsRow>
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="saving" @click="closeJSONImport">
          {{ t('取消', 'Cancel') }}
        </Button>
        <Button type="button" size="sm" :loading="saving" @click="importJSON">
          {{ t('导入', 'Import') }}
        </Button>
      </div>
    </template>
  </SettingsSection>
</template>
