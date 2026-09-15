import { useEffect, useRef, useState } from 'react'
import { Copy, PackagePlus, Puzzle, RotateCcw, ShieldX, Trash2, Undo2 } from 'lucide-react'
import { Badge, Button, Switch } from '@/components/ui'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, isMissingDesktopRuntime } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
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

export default function PluginSettingsPanel({
  theme,
}: {
  theme: PluginFrameTheme
}) {
  const t = useT()
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState('')
  const [error, setError] = useState('')
  const iframe = useRef<HTMLIFrameElement | null>(null)
  const [frameNonce, setFrameNonce] = useState('')
  const [frameDocument, setFrameDocument] = useState('')
  const [mcpConfig, setMcpConfig] = useState<PluginMCPConfig | null>(null)
  const [staged, setStaged] = useState<StagedPluginReview | null>(null)
  const [publishers, setPublishers] = useState<PluginPublisherTrust[]>([])
  const [trustApproved, setTrustApproved] = useState(false)
  const [sensitiveApproved, setSensitiveApproved] = useState(false)
  const [resetStorageApproved, setResetStorageApproved] = useState(false)

  const selected = plugins.find(plugin => plugin.id === selectedId)

  async function loadSelectedFrame(list: PluginDescriptor[], id: string) {
    setFrameDocument('')
    setFrameNonce('')
    const plugin = list.find(item => item.id === id)
    if (!plugin?.enabled || !plugin.has_settings || plugin.status === 'error') return
    try {
      const nonce = createPluginFrameNonce()
      setFrameNonce(nonce)
      setFrameDocument(buildPluginFrameDocument(plugin.id, nonce, theme))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    }
  }

  async function loadPlugins() {
    if (!hasDesktopRuntime()) {
      setPlugins([])
      setLoading(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const next = await invokeCommand<PluginDescriptor[]>('list_plugins')
      setPlugins(next)
      const nextId = next.some(plugin => plugin.id === selectedId) ? selectedId : (next[0]?.id ?? '')
      setSelectedId(nextId)
      setMcpConfig(await invokeCommand<PluginMCPConfig>('get_plugin_mcp_config').catch(() => null))
      setPublishers(await invokeCommand<PluginPublisherTrust[]>('list_plugin_publishers').catch(() => []))
      await loadSelectedFrame(next, nextId)
    } catch (reason) {
      if (!isMissingDesktopRuntime(reason)) setError(desktopErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  async function discardStaged() {
    const token = staged?.token
    setStaged(null)
    if (token) await invokeCommand('discard_staged_plugin', { token }).catch(() => undefined)
  }

  async function choosePackage() {
    setError('')
    try {
      await discardStaged()
      const review = await invokeCommand<StagedPluginReview>('choose_plugin_package')
      setStaged(review.token ? review : null)
      setTrustApproved(review.trusted)
      setSensitiveApproved(!(review.permission_expansion || review.major_version_change))
      setResetStorageApproved(false)
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    }
  }

  async function installStaged() {
    if (!staged) return
    setLoading(true)
    setError('')
    try {
      const next = await invokeCommand<PluginDescriptor[]>('install_staged_plugin', {
        token: staged.token,
        trustPublisher: trustApproved,
        confirmSensitiveChange: sensitiveApproved,
        resetStorage: resetStorageApproved,
      })
      setPlugins(next)
      setSelectedId(staged.id)
      setStaged(null)
      await loadSelectedFrame(next, staged.id)
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  async function rollbackSelected() {
    if (!selected) return
    setError('')
    try {
      const next = await invokeCommand<PluginDescriptor[]>('rollback_plugin', { id: selected.id })
      setPlugins(next)
      await loadSelectedFrame(next, selected.id)
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    }
  }

  async function uninstallSelected(deleteData: boolean) {
    if (!selected) return
    setError('')
    try {
      const next = await invokeCommand<PluginDescriptor[]>('uninstall_plugin', { id: selected.id, deleteData })
      setPlugins(next)
      const nextId = next[0]?.id ?? ''
      setSelectedId(nextId)
      await loadSelectedFrame(next, nextId)
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    }
  }

  async function setExternal(plugin: PluginDescriptor, enabled: boolean) {
    setError('')
    try {
      setPlugins(await invokeCommand<PluginDescriptor[]>('set_plugin_external_enabled', { id: plugin.id, enabled }))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    }
  }

  async function revokePublisher(keyId: string) {
    setError('')
    try {
      setPlugins(await invokeCommand<PluginDescriptor[]>('revoke_plugin_publisher', { keyId }))
      setPublishers(await invokeCommand<PluginPublisherTrust[]>('list_plugin_publishers'))
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    }
  }

  async function selectPlugin(id: string) {
    setSelectedId(id)
    await loadSelectedFrame(plugins, id)
  }

  function syncFrameTheme() {
    const plugin = selected
    const target = iframe.current?.contentWindow
    if (!plugin || !target || !frameNonce) return
    target.postMessage(buildPluginFrameThemeMessage(plugin.id, frameNonce, theme), '*')
  }

  async function setEnabled(plugin: PluginDescriptor, enabled: boolean) {
    setToggling(plugin.id)
    setError('')
    try {
      const next = await invokeCommand<PluginDescriptor[]>('set_plugin_enabled', { id: plugin.id, enabled })
      setPlugins(next)
      await loadSelectedFrame(next, plugin.id)
    } catch (reason) {
      setError(desktopErrorMessage(reason))
    } finally {
      setToggling('')
    }
  }

  async function onPluginMessage(event: MessageEvent) {
    const frameWindow = iframe.current?.contentWindow
    const message = event.data
    if (
      !frameWindow
      || event.source !== frameWindow
      || message?.protocol !== pluginUIProtocol
      || message?.pluginId !== selected?.id
      || message?.nonce !== frameNonce
      || typeof message?.requestId !== 'string'
    ) return
    const response = {
      protocol: pluginUIProtocol,
      pluginId: message.pluginId,
      nonce: frameNonce,
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
        throw new Error(t('插件请求了未授权的设置能力', 'The plugin requested an unauthorized settings capability'))
      }
      frameWindow.postMessage({ ...response, value }, '*')
    } catch (reason) {
      frameWindow.postMessage({ ...response, error: desktopErrorMessage(reason) }, '*')
    }
  }

  async function copyMCPConfig() {
    if (!mcpConfig?.available) return
    await navigator.clipboard.writeText(JSON.stringify(mcpConfig.configuration, null, 2))
  }

  useEffect(() => {
    window.addEventListener('message', onPluginMessage)
    void loadPlugins()
    return () => {
      window.removeEventListener('message', onPluginMessage)
      void discardStaged()
    }
  }, [])

  useEffect(() => {
    syncFrameTheme()
  }, [theme, frameNonce, selectedId])

  return (
    <section className="plugin-settings-grid">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-semibold">{t('插件框架', 'Plugin framework')}</h2>
          <p className="mt-1 max-w-2xl text-caption leading-5 text-muted-foreground">
            {t('支持本地签名的 milksu.plugin/v1 包；首次安装核对发布者指纹、权限、表面与工具后再加入本机信任库。', 'Supports locally signed milksu.plugin/v1 packages. First install checks the publisher fingerprint, permissions, surfaces, and tools before adding them to this machine\'s trust store.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void choosePackage()}>
            <PackagePlus className="size-3.5" />{t('安装插件', 'Install plugin')}
          </Button>
          <Button variant="outline" size="sm" disabled={!mcpConfig?.available} onClick={() => void copyMCPConfig()}>
            <Copy className="size-3.5" />{t('复制 MCP 配置', 'Copy MCP config')}
          </Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadPlugins()}>
            <RotateCcw className="size-3.5" />{t('刷新', 'Refresh')}
          </Button>
        </div>
      </header>

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-caption text-destructive">{error}</p> : null}

      {staged ? (
        <section className="rounded-lg border border-primary/40 bg-card p-4 text-caption" data-plugin-surface="workspace-list">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-control font-semibold">{staged.upgrade ? t('升级确认', 'Upgrade confirmation') : t('首次安装确认', 'First-install confirmation')} · {staged.name} {staged.version}</h3>
              <p className="mt-1 text-muted-foreground">{staged.publisher.name} · <span className="font-mono">{staged.fingerprint}</span></p>
            </div>
            <Badge variant={staged.trusted ? 'secondary' : 'outline'}>
              {staged.key_rotation ? t('共同签名密钥轮换', 'Cosign key rotation') : staged.trusted ? t('发布者已信任', 'Publisher trusted') : t('新发布者', 'New publisher')}
            </Badge>
          </div>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">{t('兼容范围', 'Compatibility')}</dt><dd>MilkSU ≥ {staged.host_min_version}</dd>
            <dt className="text-muted-foreground">{t('权限', 'Permissions')}</dt><dd>{staged.permissions.join(' · ') || t('无', 'None')}</dd>
            <dt className="text-muted-foreground">{t('表面', 'Surfaces')}</dt><dd>{staged.surfaces.join(' · ') || t('无', 'None')}</dd>
            <dt className="text-muted-foreground">{t('只读工具', 'Read-only tools')}</dt><dd>{staged.tools.map(tool => tool.name).join(' · ') || t('无', 'None')}</dd>
            <dt className="text-muted-foreground">{t('摘要', 'Digest')}</dt><dd className="truncate font-mono" title={staged.digest}>{staged.digest}</dd>
          </dl>
          {!staged.trusted ? (
            <label className="mt-3 flex items-center gap-2">
              <input checked={trustApproved} onChange={event => setTrustApproved(event.target.checked)} type="checkbox" />
              {t('我已核对指纹，并信任此发布者', 'I have checked the fingerprint and trust this publisher')}
            </label>
          ) : null}
          {staged.permission_expansion || staged.major_version_change ? (
            <label className="mt-2 flex items-center gap-2">
              <input checked={sensitiveApproved} onChange={event => setSensitiveApproved(event.target.checked)} type="checkbox" />
              {t('我确认权限扩大或主版本变化', 'I confirm the permission expansion or major-version change')}
            </label>
          ) : null}
          {staged.storage_migration ? (
            <p className="mt-2 text-muted-foreground">{t('此升级包含可回滚的存储迁移。', 'This upgrade includes a reversible storage migration.')}</p>
          ) : null}
          {staged.storage_reset_required ? (
            <label className="mt-2 flex items-center gap-2 text-destructive">
              <input checked={resetStorageApproved} onChange={event => setResetStorageApproved(event.target.checked)} type="checkbox" />
              {t('新版本缺少迁移：删除此插件现有存储后继续', 'The new version has no migration. Delete this plugin\'s existing storage to continue')}
            </label>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              disabled={(!staged.trusted && !trustApproved) || ((staged.permission_expansion || staged.major_version_change) && !sensitiveApproved) || (staged.storage_reset_required && !resetStorageApproved)}
              onClick={() => void installStaged()}
            >
              {staged.upgrade ? t('确认升级', 'Confirm upgrade') : t('确认安装', 'Confirm install')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void discardStaged()}>{t('取消', 'Cancel')}</Button>
          </div>
        </section>
      ) : null}

      <div className="plugin-settings-shell grid min-h-[34rem] grid-cols-[minmax(15rem,0.8fr)_minmax(20rem,1.4fr)] overflow-hidden rounded-lg border border-border">
        <div className="plugin-settings-list border-r border-border" data-plugin-surface="workspace-list">
          {plugins.map(plugin => (
            <button
              key={`${plugin.source}:${plugin.id}`}
              type="button"
              className={`plugin-settings-row flex w-full items-start gap-3 border-b border-border px-4 py-4 text-left${selectedId === plugin.id ? ' is-selected' : ''}`}
              onClick={() => void selectPlugin(plugin.id)}
            >
              <span className="plugin-settings-icon mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-border"><Puzzle className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2"><strong className="truncate text-control">{plugin.name}</strong><Badge variant="outline">{plugin.runtime}</Badge></span>
                <span className="mt-1 block truncate font-mono text-caption text-muted-foreground">{plugin.id} · {plugin.version}</span>
                {plugin.error ? <span className="mt-1 block text-caption text-destructive">{plugin.error}</span> : null}
              </span>
              <Switch
                checked={plugin.enabled}
                disabled={plugin.status === 'error' || Boolean(toggling)}
                aria-label={plugin.enabled ? t(`停用${plugin.name}`, `Disable ${plugin.name}`) : t(`启用${plugin.name}`, `Enable ${plugin.name}`)}
                onClick={event => event.stopPropagation()}
                onCheckedChange={value => void setEnabled(plugin, Boolean(value))}
              />
            </button>
          ))}
          {!plugins.length && !loading ? <p className="p-5 text-caption text-muted-foreground">{t('没有可用插件。', 'No plugins available.')}</p> : null}
        </div>

        <div className="plugin-settings-detail min-w-0 p-5">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <Badge variant={selected.source === 'official' ? 'secondary' : 'outline'}>
                  {selected.source === 'official' ? t('官方锁定', 'Official locked') : selected.source === 'installed' ? t('本地签名包', 'Local signed package') : t('开发目录', 'Development directory')}
                </Badge>
                <Badge variant={selected.status === 'error' ? 'destructive' : 'outline'}>{selected.status}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-caption">
                <dt className="text-muted-foreground">API</dt><dd className="font-mono">{selected.api_version}</dd>
                <dt className="text-muted-foreground">SHA-256</dt><dd className="truncate font-mono" title={selected.digest}>{selected.digest || t('不可用', 'Unavailable')}</dd>
                <dt className="text-muted-foreground">{t('权限', 'Permissions')}</dt>
                <dd className="flex flex-wrap gap-1">
                  {selected.permissions.map(permission => <Badge key={permission} variant="outline">{permission}</Badge>)}
                  {!selected.permissions.length ? t('无', 'None') : null}
                </dd>
                {selected.publisher?.name ? <dt className="text-muted-foreground">{t('发布者', 'Publisher')}</dt> : null}
                {selected.publisher?.name ? (
                  <dd>
                    {selected.publisher.name}
                    {selected.publisher.keyId ? <span className="ml-2 font-mono">{selected.publisher.keyId.slice(0, 16)}…</span> : null}
                  </dd>
                ) : null}
                <dt className="text-muted-foreground">{t('插槽', 'Slots')}</dt><dd>{selected.contributions.slots?.join(' · ') || t('无', 'None')}</dd>
                <dt className="text-muted-foreground">{t('工具', 'Tools')}</dt><dd>{selected.contributions.tools?.map(tool => `${tool.name} (${tool.effect})`).join(' · ') || t('无', 'None')}</dd>
              </dl>
              {selected.permissions.includes('mcp.external.read') ? (
                <div className="mt-4 flex items-center justify-between rounded-md border border-border p-3 text-caption">
                  <div>
                    <strong>{t('外部 MCP', 'External MCP')}</strong>
                    <p className="mt-1 text-muted-foreground">{t('默认关闭；修改后不支持工具通知的客户端需要重新连接。', 'Off by default. Clients that do not support tool notifications must reconnect after a change.')}</p>
                  </div>
                  <Switch checked={Boolean(selected.external_enabled)} disabled={!selected.enabled} onCheckedChange={value => void setExternal(selected, Boolean(value))} />
                </div>
              ) : null}
              {selected.source === 'installed' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={!selected.can_rollback} onClick={() => void rollbackSelected()}><Undo2 className="size-3.5" />{t('回滚上一版本', 'Roll back previous version')}</Button>
                  <Button variant="outline" size="sm" onClick={() => void uninstallSelected(false)}><Trash2 className="size-3.5" />{t('卸载并保留数据', 'Uninstall and keep data')}</Button>
                  <Button variant="destructive" size="sm" onClick={() => void uninstallSelected(true)}><Trash2 className="size-3.5" />{t('卸载并删除数据', 'Uninstall and delete data')}</Button>
                </div>
              ) : null}
              {selected.enabled && frameDocument ? (
                <div className="plugin-settings-frame mt-5 overflow-hidden rounded-lg border border-border">
                  <iframe
                    ref={iframe}
                    title={t(`${selected.name} 设置`, `${selected.name} settings`)}
                    srcDoc={frameDocument}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    className="h-96 w-full border-0"
                    onLoad={syncFrameTheme}
                  />
                </div>
              ) : !selected.enabled ? (
                <p className="mt-5 rounded-md border border-border bg-muted/20 p-4 text-caption text-muted-foreground">{t('启用插件后才会创建隔离的设置面板。', 'The isolated settings panel is created only after the plugin is enabled.')}</p>
              ) : !selected.has_settings ? (
                <p className="mt-5 text-caption text-muted-foreground">{t('此插件没有设置面板。', 'This plugin has no settings panel.')}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {publishers.length ? (
        <section className="rounded-lg border border-border bg-card p-4" data-plugin-surface="workspace-list">
          <h3 className="text-control font-semibold">{t('已信任发布者', 'Trusted publishers')}</h3>
          {publishers.map(publisher => (
            <div key={publisher.key_id} className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-caption">
              <div className="min-w-0">
                <strong>{publisher.name}</strong>
                <p className="truncate font-mono text-muted-foreground" title={publisher.key_id}>{publisher.key_id}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void revokePublisher(publisher.key_id)}>
                <ShieldX className="size-3.5" />{t('撤销信任', 'Revoke trust')}
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      <style>{pluginSettingsCss}</style>
    </section>
  )
}

const pluginSettingsCss = `
.plugin-settings-grid { display: grid; gap: 1.25rem; }
.plugin-settings-shell { background-color: var(--card); color: var(--card-foreground); }
.plugin-settings-list { background-color: color-mix(in srgb, var(--muted) 34%, var(--card)); }
.plugin-settings-row { background-color: transparent; color: var(--foreground); transition: background-color 120ms ease, box-shadow 120ms ease; }
.plugin-settings-row:hover { background-color: var(--overlay-hover-light); }
.plugin-settings-row.is-selected { background-color: var(--overlay-active); box-shadow: inset 3px 0 0 var(--brand); }
.plugin-settings-icon, .plugin-settings-frame { background-color: var(--background); }
.plugin-settings-detail { background-color: var(--card); }
`
