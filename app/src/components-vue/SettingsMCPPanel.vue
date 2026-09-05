<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
import { desktopErrorMessage, invokeCommand } from '@/desktop'
import { t } from '@/lib/uiLocale'
import {
  emptyAgentResourceCatalog,
  type AgentResourceCatalog,
  type AgentResourceMCPInput,
  type AgentResourceMCPServer,
  type AgentResourceMCPTransport,
} from '@/agentResourceTypes'

const catalog = ref<AgentResourceCatalog>(emptyAgentResourceCatalog())
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editorOpen = ref(false)
const jsonOpen = ref(false)
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

const servers = computed(() => catalog.value.mcpServers)
const editing = computed(() => Boolean(editingName.value))

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

async function loadCatalog() {
  loading.value = true
  error.value = ''
  try {
    catalog.value = await invokeCommand<AgentResourceCatalog>('list_agent_resource_catalog')
  } catch (reason) {
    error.value = desktopErrorMessage(reason)
    catalog.value = emptyAgentResourceCatalog()
  } finally {
    loading.value = false
  }
}

function startJSONImport() {
  closeEditor()
  formJSON.value = ''
  jsonOpen.value = true
}

function closeJSONImport() {
  jsonOpen.value = false
  formJSON.value = ''
}

function startCreate() {
  closeJSONImport()
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

onMounted(() => {
  void loadCatalog()
})
</script>

<template>
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
    <p v-if="error" class="px-4 py-3 text-caption text-destructive">{{ error }}</p>
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
