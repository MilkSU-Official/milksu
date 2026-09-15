import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Input, NativeSelect, NativeSelectOption, SettingsSection } from '@/components/ui'
import { Check, ShieldAlert, X } from 'lucide-react'
import { redactProviderCredentials } from '@/lib/redaction'
import { useT } from '@/hooks/useUiLocale'
import type {
  CTFEndpointProtocol,
  CTFEndpointRequest,
  CTFEndpointRequestInput,
  CTFScopeGrant,
} from '@/ctfTypes'

export default function CTFEndpointAuthorization({
  sourceScope,
  networkScopes,
  requests,
  working,
  terminal,
  pendingOnly,
  reviewOnly,
  embedded,
  onRequest,
  onApprove,
  onDeny,
}: {
  sourceScope: CTFScopeGrant
  networkScopes: CTFScopeGrant[]
  requests: CTFEndpointRequest[]
  working?: boolean
  terminal?: boolean
  pendingOnly?: boolean
  reviewOnly?: boolean
  embedded?: boolean
  onRequest?: (request: CTFEndpointRequestInput) => void
  onApprove?: (requestId: string) => void
  onDeny?: (requestId: string) => void
}) {
  const t = useT()
  const [protocol, setProtocol] = useState<CTFEndpointProtocol>('https')
  const [endpoint, setEndpoint] = useState('')
  const [source, setSource] = useState('')
  const [purpose, setPurpose] = useState('')

  const pending = useMemo(() => requests.filter(request => request.status === 'pending'), [requests])
  const decided = useMemo(() => requests.filter(request => request.status !== 'pending'), [requests])
  const endpointPlaceholder = protocol === 'http'
    ? 'http://challenge.example:8080'
    : protocol === 'https'
      ? 'https://challenge.example'
      : protocol === 'tcp'
        ? 'challenge.example:31337'
        : 'challenge.example:22'
  const formComplete = Boolean(endpoint.trim() && source.trim() && purpose.trim())

  useEffect(() => {
    setEndpoint('')
    setSource('')
    setPurpose('')
  }, [requests.length])

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

  function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    if (!formComplete || working || terminal) return
    onRequest?.({
      protocol,
      endpoint: endpoint.trim(),
      source: source.trim(),
      purpose: purpose.trim(),
    })
  }

  if (pendingOnly && !pending.length) return null

  return (
    <SettingsSection
      title={pendingOnly ? t('批准新的 Endpoint', 'Approve a new Endpoint') : reviewOnly ? t('Endpoint 授权记录', 'Endpoint authorization history') : t('Endpoint 授权', 'Endpoint authorization')}
      className={embedded ? 'contents' : ''}
      aria-labelledby="endpoint-authorization-title"
      actions={!reviewOnly && pending.length ? <Badge variant="outline">{t(`${pending.length} 待确认`, `${pending.length} pending`)}</Badge> : null}
    >
      <div className="px-5 py-4">
        {!reviewOnly && pending.length ? (
          <div className="mt-4 space-y-3" aria-label={t('待确认 Endpoint', 'Pending Endpoints')}>
            {pending.map(request => (
              <article key={request.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{protocolLabel(request.protocol)}</Badge>
                  <span className="font-mono text-caption">{redacted(request.host)}:{redacted(request.port)}</span>
                  <span className="text-caption text-muted-foreground">{requesterLabel(request)}</span>
                </div>
                <dl className="mt-3 space-y-2 text-caption leading-5">
                  <div>
                    <dt className="text-muted-foreground">{t('来源', 'Source')}</dt>
                    <dd>{redacted(request.source)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('用途', 'Purpose')}</dt>
                    <dd>{redacted(request.purpose)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={working || terminal} onClick={() => onApprove?.(request.id)}>
                    <Check className="size-3.5" />
                    {t('仅批准此 Endpoint', 'Approve only this Endpoint')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={working || terminal} onClick={() => onDeny?.(request.id)}>
                    <X className="size-3.5" />
                    {t('拒绝', 'Deny')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {!pendingOnly && !reviewOnly ? (
          <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={submitRequest}>
            <p className="text-caption font-medium">{t('手动提出一个地址', 'Request an address manually')}</p>
            <div className="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)]">
              <label className="space-y-1">
                <span className="text-caption text-muted-foreground">{t('协议', 'Protocol')}</span>
                <NativeSelect
                  value={protocol}
                  aria-label={t('Endpoint 协议', 'Endpoint protocol')}
                  onChange={event => setProtocol(event.target.value as CTFEndpointProtocol)}
                >
                  <NativeSelectOption value="http">HTTP</NativeSelectOption>
                  <NativeSelectOption value="https">HTTPS</NativeSelectOption>
                  <NativeSelectOption value="tcp">TCP</NativeSelectOption>
                  <NativeSelectOption value="ssh">SSH</NativeSelectOption>
                </NativeSelect>
              </label>
              <label className="space-y-1">
                <span className="text-caption text-muted-foreground">{t('域名 / IP 与端口', 'Host / IP and port')}</span>
                <Input
                  value={endpoint}
                  onChange={event => setEndpoint(event.target.value)}
                  placeholder={endpointPlaceholder}
                  maxLength={4096}
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-caption text-muted-foreground">{t('来源', 'Source')}</span>
              <Input
                value={source}
                onChange={event => setSource(event.target.value)}
                placeholder={t('例如：题目页面、Agent 对附件的观察', 'Example: challenge page, Agent observation of an attachment')}
                maxLength={240}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-caption text-muted-foreground">{t('用途', 'Purpose')}</span>
              <Input
                value={purpose}
                onChange={event => setPurpose(event.target.value)}
                placeholder={t('说明为什么需要访问这个精确目标', 'Explain why this exact target needs to be reached')}
                maxLength={500}
              />
            </label>
            <Button type="submit" variant="outline" size="sm" disabled={!formComplete || working || terminal}>
              {t('提交授权申请', 'Submit authorization request')}
            </Button>
          </form>
        ) : null}

        {!pendingOnly ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-caption font-medium">{t('当前授权目标', 'Currently authorized targets')}</p>
            <div className="mt-2 space-y-2">
              {sourceScope.targets.map(target => (
                <div key={`source:${target.kind}:${target.value}`} className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-caption text-muted-foreground">
                    {t(`${targetKindLabel(redacted(target.kind))} · 题目准入`, `${targetKindLabel(redacted(target.kind))} · challenge admission`)}
                  </p>
                  <p className="mt-1 break-all font-mono text-caption leading-5">{redacted(target.value)}</p>
                </div>
              ))}
              {networkScopes.map(scope => (
                scope.targets.map(target => (
                  <div key={`${scope.id}:${target.kind}:${target.value}`} className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-caption text-muted-foreground">
                      {t(`${targetKindLabel(redacted(target.kind))} · 单独批准`, `${targetKindLabel(redacted(target.kind))} · separately approved`)}
                    </p>
                    <p className="mt-1 break-all font-mono text-caption leading-5">{redacted(target.value)}</p>
                  </div>
                ))
              ))}
            </div>
            <p className="mt-3 flex gap-2 text-caption leading-5 text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              {t('HTTP 不带浏览器会话；SSH 仅读取 Banner。', 'HTTP does not include the browser session; SSH only reads the Banner.')}
            </p>
          </div>
        ) : null}

        {reviewOnly && decided.length ? (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-caption font-medium">{t(`已处理申请 ${decided.length} 项`, `${decided.length} processed requests`)}</p>
            <ul className="mt-2 space-y-1 text-caption text-muted-foreground">
              {decided.map(request => (
                <li key={request.id}>
                  {protocolLabel(request.protocol)} · {redacted(request.host)}:{redacted(request.port)} ·
                  {' '}{request.status === 'approved' ? t('已批准', 'Approved') : t('已拒绝', 'Denied')}
                </li>
              ))}
            </ul>
          </div>
        ) : !pendingOnly && decided.length ? (
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-caption text-muted-foreground">
              {t(`已处理申请 ${decided.length} 项`, `${decided.length} processed requests`)}
            </summary>
            <ul className="mt-2 space-y-1 text-caption text-muted-foreground">
              {decided.map(request => (
                <li key={request.id}>
                  {protocolLabel(request.protocol)} · {redacted(request.host)}:{redacted(request.port)} ·
                  {' '}{request.status === 'approved' ? t('已批准', 'Approved') : t('已拒绝', 'Denied')}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </SettingsSection>
  )
}
