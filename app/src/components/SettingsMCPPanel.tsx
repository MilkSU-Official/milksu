import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  SettingsRow,
  SettingsSection,
  Switch,
  Textarea,
} from '@/components/ui'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, isMissingDesktopRuntime, listenEvent } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import {
  emptyAgentResourceCatalog,
  type AgentResourceCatalog,
  type AgentResourceMCPInput,
  type AgentResourceMCPServer,
  type AgentResourceMCPTransport,
  type BuiltinConfigHandoff,
} from '@/agentResourceTypes'
import type { SecurityToolSetupSnapshot, SecurityToolSnapshot } from '@/securityToolsTypes'

export default function SettingsMCPPanel({
  onCodingHandoff,
}: {
  onCodingHandoff?: (handoff: BuiltinConfigHandoff) => void
}) {
  const t = useT()
  const [catalog, setCatalog] = useState<AgentResourceCatalog>(emptyAgentResourceCatalog())
  const [tools, setTools] = useState<SecurityToolSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [builtinEditorOpen, setBuiltinEditorOpen] = useState(false)
  const [formJSON, setFormJSON] = useState('')
  const jsonEditor = useRef<HTMLTextAreaElement | null>(null)
  const [editingName, setEditingName] = useState('')
  const [formName, setFormName] = useState('')
  const [formTransport, setFormTransport] = useState<AgentResourceMCPTransport>('command')
  const [formCommand, setFormCommand] = useState('')
  const [formArgs, setFormArgs] = useState('')
  const [formURL, setFormURL] = useState('')
  const [formSocket, setFormSocket] = useState('')
  const [formEnv, setFormEnv] = useState('')
  const [formHeaders, setFormHeaders] = useState('')
  const [formBearer, setFormBearer] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)
  const [builtinName, setBuiltinName] = useState('')
  const [builtinCommand, setBuiltinCommand] = useState('')
  const [builtinArgs, setBuiltinArgs] = useState('')
  const [setup, setSetup] = useState<SecurityToolSetupSnapshot | null>(null)

  const servers = catalog.mcpServers
  const editing = Boolean(editingName)
  const builtinRows = useMemo(() => tools.map(tool => {
    const overlay = (catalog.builtinMCP ?? []).find(item => item.name === tool.id)
    return {
      tool,
      overlay,
      enabled: overlay?.enabled ?? tool.enabled,
      customized: Boolean(overlay?.customized || overlay?.command),
      command: overlay?.command || '',
      args: overlay?.args ?? [],
    }
  }), [tools, catalog.builtinMCP])

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
    return value.split('\n').map(item => item.trim()).filter(Boolean)
  }

  function builtinDescription(row: (typeof builtinRows)[number]) {
    return [
      row.tool.statusLabel,
      row.tool.purpose,
      row.customized ? t('已修改', 'Modified') : '',
    ].filter(Boolean).join(' · ')
  }

  async function loadCatalog() {
    if (!hasDesktopRuntime()) {
      setCatalog(emptyAgentResourceCatalog())
      setTools([])
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const errors: string[] = []
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('list_agent_resource_catalog'))
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) errors.push(desktopErrorMessage(reason))
      setCatalog(emptyAgentResourceCatalog())
    }
    try {
      setTools(await invokeCommand<SecurityToolSnapshot[]>('list_security_tools'))
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) errors.push(desktopErrorMessage(reason))
      setTools([])
    }
    setError(errors.filter(Boolean).join(' '))
    setLoading(false)
  }

  function closeJSONImport() {
    setJsonOpen(false)
    setFormJSON('')
  }

  function closeEditor() {
    setEditorOpen(false)
    setEditingName('')
  }

  function closeBuiltinEditor() {
    setBuiltinEditorOpen(false)
    setBuiltinName('')
  }

  function startJSONImport() {
    closeEditor()
    closeBuiltinEditor()
    setFormJSON('')
    setJsonOpen(true)
  }

  function startCreate() {
    closeJSONImport()
    closeBuiltinEditor()
    setEditingName('')
    setFormName('')
    setFormTransport('command')
    setFormCommand('')
    setFormArgs('')
    setFormURL('')
    setFormSocket('')
    setFormEnv('')
    setFormHeaders('')
    setFormBearer('')
    setFormEnabled(true)
    setEditorOpen(true)
  }

  function startEdit(server: AgentResourceMCPServer) {
    closeJSONImport()
    closeBuiltinEditor()
    setEditingName(server.name)
    setFormName(server.name)
    setFormTransport(server.transport)
    setFormCommand(server.command ?? '')
    setFormArgs((server.args ?? []).join('\n'))
    setFormURL(server.url ?? '')
    setFormSocket(server.socket ?? '')
    setFormEnv((server.envNames ?? []).map(name => `${name}=`).join('\n'))
    setFormHeaders((server.headerNames ?? []).map(name => `${name}=`).join('\n'))
    setFormBearer('')
    setFormEnabled(server.enabled)
    setEditorOpen(true)
  }

  function startBuiltinEdit(row: (typeof builtinRows)[number]) {
    closeJSONImport()
    closeEditor()
    setBuiltinName(row.tool.id)
    setBuiltinCommand(row.command)
    setBuiltinArgs(row.args.join('\n'))
    setBuiltinEditorOpen(true)
  }

  function buildInput(): AgentResourceMCPInput {
    const env = parsePairs(formEnv)
    const headers = parsePairs(formHeaders)
    const removeEnv = editing
      ? (catalog.mcpServers.find(server => server.name === editingName)?.envNames ?? [])
        .filter(name => !Object.hasOwn(env, name))
      : []
    const removeHeaders = editing
      ? (catalog.mcpServers.find(server => server.name === editingName)?.headerNames ?? [])
        .filter(name => !Object.hasOwn(headers, name))
      : []
    return {
      name: formName.trim(),
      enabled: formEnabled,
      transport: formTransport,
      command: formCommand.trim(),
      args: parseArgs(formArgs),
      url: formURL.trim(),
      socket: formSocket.trim(),
      env,
      headers,
      bearerToken: formBearer,
      removeEnv,
      removeHeaders,
    }
  }

  function readJSONDocument() {
    const fromModel = formJSON.trim()
    if (fromModel) return fromModel
    return String(jsonEditor.current?.value ?? '').trim()
  }

  async function importJSON() {
    const document = readJSONDocument()
    if (!document) return
    setSaving(true)
    setError('')
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('import_user_mcp_json', { document }))
      closeJSONImport()
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function saveServer() {
    setSaving(true)
    setError('')
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('upsert_user_mcp_server', { input: buildInput() }))
      closeEditor()
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function setEnabled(name: string, enabled: boolean) {
    setSaving(true)
    setError('')
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('set_user_mcp_server_enabled', { name, enabled }))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function removeServer(name: string) {
    setSaving(true)
    setError('')
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('delete_user_mcp_server', { name }))
      if (editingName === name) closeEditor()
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function setBuiltinEnabled(name: string, enabled: boolean) {
    setSaving(true)
    setError('')
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('set_builtin_mcp_enabled', { name, enabled }))
      setTools(current => current.map(item => item.id === name
        ? { ...item, enabled, usableByAgent: enabled && item.status === 'ready' && item.codingSupported }
        : item))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function saveBuiltin() {
    if (!builtinName) return
    setSaving(true)
    setError('')
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('upsert_builtin_mcp', {
        input: {
          name: builtinName,
          command: builtinCommand.trim(),
          args: parseArgs(builtinArgs),
        },
      }))
      closeBuiltinEditor()
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function restoreBuiltin(name: string) {
    setSaving(true)
    setError('')
    try {
      setCatalog(await invokeCommand<AgentResourceCatalog>('restore_builtin_mcp', { name }))
      if (builtinName === name) closeBuiltinEditor()
      setTools(await invokeCommand<SecurityToolSnapshot[]>('list_security_tools'))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function startSetup(id: string) {
    setSaving(true)
    setError('')
    try {
      setSetup(await invokeCommand<SecurityToolSetupSnapshot>('start_security_tool_setup', { id }))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function checkTool(id: string) {
    setSaving(true)
    setError('')
    try {
      const checked = await invokeCommand<SecurityToolSnapshot>('check_security_tool', { id })
      setTools(current => current.map(item => item.id === checked.id ? checked : item))
      if (checked.status === 'ready') setSetup(null)
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function openBuiltinConversation(name: string) {
    setSaving(true)
    setError('')
    try {
      onCodingHandoff?.(await invokeCommand<BuiltinConfigHandoff>('prepare_builtin_config_handoff', {
        kind: 'mcp',
        name,
      }))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void (async () => {
      unlisten = await listenEvent<SecurityToolSetupSnapshot>('security-tool-setup', event => {
        setSetup(event.payload)
        if (event.payload.state === 'completed' || event.payload.state === 'failed') {
          void loadCatalog()
        }
      })
      await loadCatalog()
    })()
    return () => unlisten?.()
  }, [])

  return (
    <>
      <SettingsSection title={t('内置 MCP', 'Built-in MCP')}>
        {error ? <p className="px-4 py-3 text-caption text-destructive">{error}</p> : null}
        {setup && setup.state === 'running' ? (
          <SettingsRow
            label={t('正在准备', 'Preparing')}
            description={setup.summary}
            trailing={<span className="font-mono text-caption text-primary">{setup.percent}%</span>}
          />
        ) : null}
        {builtinRows.map(row => (
          <SettingsRow
            key={row.tool.id}
            label={row.tool.name}
            description={builtinDescription(row)}
            trailing={(
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => startBuiltinEdit(row)}>
                  {t('编辑', 'Edit')}
                </Button>
                {row.customized ? (
                  <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void restoreBuiltin(row.tool.id)}>
                    {t('恢复默认', 'Restore default')}
                  </Button>
                ) : null}
                {row.tool.setupSupported && row.tool.status !== 'ready' ? (
                  <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void startSetup(row.tool.id)}>
                    {row.tool.primaryAction || t('准备', 'Set up')}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void checkTool(row.tool.id)}>
                  {t('健康检查', 'Health check')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void openBuiltinConversation(row.tool.id)}>
                  {t('用对话配置', 'Configure in chat')}
                </Button>
                <Switch
                  checked={row.enabled}
                  disabled={saving || loading}
                  aria-label={t(`启用${row.tool.name}`, `Enable ${row.tool.name}`)}
                  onCheckedChange={value => void setBuiltinEnabled(row.tool.id, Boolean(value))}
                />
              </div>
            )}
          />
        ))}
      </SettingsSection>

      {builtinEditorOpen ? (
        <SettingsSection
          title={t('编辑内置 MCP', 'Edit built-in MCP')}
          footer={(
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={closeBuiltinEditor}>
                {t('取消', 'Cancel')}
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void saveBuiltin()}>
                {t('保存', 'Save')}
              </Button>
            </div>
          )}
        >
          <SettingsRow
            label={t('命令', 'Command')}
            trailing={(
              <Input
                value={builtinCommand}
                onChange={event => setBuiltinCommand(event.target.value)}
                className="w-72 max-w-full"
                disabled={saving}
                aria-label={t('覆盖启动命令', 'Override launch command')}
              />
            )}
          />
          <SettingsRow
            label={t('参数', 'Arguments')}
            divider={false}
            trailing={(
              <Textarea
                value={builtinArgs}
                onChange={event => setBuiltinArgs(event.target.value)}
                className="w-72 max-w-full"
                disabled={saving}
                aria-label={t('每行一个覆盖参数', 'One override argument per line')}
              />
            )}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection
        title={t('用户 MCP', 'User MCP')}
        actions={(
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('导入 MCP JSON', 'Import MCP JSON')}
              title={t('导入 MCP JSON', 'Import MCP JSON')}
              onClick={startJSONImport}
            >
              <Braces className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('添加 MCP 服务器', 'Add an MCP server')}
              title={t('添加 MCP 服务器', 'Add an MCP server')}
              onClick={startCreate}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        )}
      >
        {servers.map(server => (
          <SettingsRow
            key={server.name}
            label={server.name}
            description={[
              transportLabel(server.transport),
              server.command || server.url || server.socket,
            ].filter(Boolean).join(' · ')}
            trailing={(
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => startEdit(server)}>
                  {t('编辑', 'Edit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={saving}
                  aria-label={t(`删除 ${server.name}`, `Delete ${server.name}`)}
                  onClick={() => void removeServer(server.name)}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Switch
                  checked={server.enabled}
                  disabled={saving || loading}
                  aria-label={t(`启用${server.name}`, `Enable ${server.name}`)}
                  onCheckedChange={value => void setEnabled(server.name, Boolean(value))}
                />
              </div>
            )}
          />
        ))}
      </SettingsSection>

      {editorOpen ? (
        <SettingsSection
          title={editing ? t('编辑服务器', 'Edit server') : t('添加服务器', 'Add server')}
          footer={(
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={closeEditor}>
                {t('取消', 'Cancel')}
              </Button>
              <Button type="button" size="sm" disabled={saving || !formName.trim()} onClick={() => void saveServer()}>
                {t('保存', 'Save')}
              </Button>
            </div>
          )}
        >
          <SettingsRow
            label={t('名称', 'Name')}
            trailing={(
              <Input
                value={formName}
                onChange={event => setFormName(event.target.value)}
                className="w-72 max-w-full"
                disabled={editing || saving}
                aria-label={t('服务器名称', 'Server name')}
              />
            )}
          />
          <SettingsRow
            label={t('传输', 'Transport')}
            trailing={(
              <NativeSelect
                value={formTransport}
                aria-label={t('传输方式', 'Transport')}
                onChange={event => setFormTransport(event.target.value as AgentResourceMCPTransport)}
              >
                <NativeSelectOption value="command">{t('本地进程', 'Local process')}</NativeSelectOption>
                <NativeSelectOption value="url">{t('远程 HTTP', 'Remote HTTP')}</NativeSelectOption>
                <NativeSelectOption value="socket">{t('本地 Socket', 'Local socket')}</NativeSelectOption>
              </NativeSelect>
            )}
          />
          {formTransport === 'command' ? (
            <SettingsRow
              label={t('命令', 'Command')}
              trailing={(
                <Input
                  value={formCommand}
                  onChange={event => setFormCommand(event.target.value)}
                  className="w-72 max-w-full"
                  disabled={saving}
                  aria-label={t('启动命令', 'Launch command')}
                />
              )}
            />
          ) : null}
          {formTransport === 'command' ? (
            <SettingsRow
              label={t('参数', 'Arguments')}
              trailing={(
                <Textarea
                  value={formArgs}
                  onChange={event => setFormArgs(event.target.value)}
                  className="w-72 max-w-full"
                  disabled={saving}
                  aria-label={t('每行一个参数', 'One argument per line')}
                />
              )}
            />
          ) : null}
          {formTransport === 'url' ? (
            <SettingsRow
              label={t('地址', 'URL')}
              trailing={(
                <Input
                  value={formURL}
                  onChange={event => setFormURL(event.target.value)}
                  className="w-72 max-w-full"
                  disabled={saving}
                  aria-label={t('远程地址', 'Remote URL')}
                />
              )}
            />
          ) : null}
          {formTransport === 'socket' ? (
            <SettingsRow
              label={t('Socket', 'Socket')}
              trailing={(
                <Input
                  value={formSocket}
                  onChange={event => setFormSocket(event.target.value)}
                  className="w-72 max-w-full"
                  disabled={saving}
                  aria-label={t('本地 Socket', 'Local socket')}
                />
              )}
            />
          ) : null}
          <SettingsRow
            label={t('环境变量', 'Environment')}
            trailing={(
              <Textarea
                value={formEnv}
                onChange={event => setFormEnv(event.target.value)}
                className="w-72 max-w-full"
                disabled={saving}
                aria-label={t('每行一个 KEY=value，留空值表示保持原值', 'One KEY=value per line; empty values keep the stored secret')}
              />
            )}
          />
          <SettingsRow
            label={t('请求头', 'Headers')}
            trailing={(
              <Textarea
                value={formHeaders}
                onChange={event => setFormHeaders(event.target.value)}
                className="w-72 max-w-full"
                disabled={saving}
                aria-label={t('每行一个 Header=value', 'One Header=value per line')}
              />
            )}
          />
          <SettingsRow
            label={t('Bearer', 'Bearer')}
            divider={false}
            trailing={(
              <Input
                value={formBearer}
                onChange={event => setFormBearer(event.target.value)}
                type="password"
                className="w-72 max-w-full"
                disabled={saving}
                aria-label={t('Bearer 令牌', 'Bearer token')}
              />
            )}
          />
        </SettingsSection>
      ) : null}

      {jsonOpen ? (
        <SettingsSection
          title={t('导入 JSON', 'Import JSON')}
          footer={(
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={closeJSONImport}>
                {t('取消', 'Cancel')}
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void importJSON()}>
                {t('导入', 'Import')}
              </Button>
            </div>
          )}
        >
          <SettingsRow
            label={t('配置', 'Config')}
            divider={false}
            trailing={(
              <Textarea
                ref={jsonEditor}
                value={formJSON}
                onChange={event => setFormJSON(event.target.value)}
                className="w-[28rem] max-w-full min-h-40"
                disabled={saving}
                aria-label={t('MCP JSON', 'MCP JSON')}
              />
            )}
          />
        </SettingsSection>
      ) : null}
    </>
  )
}
