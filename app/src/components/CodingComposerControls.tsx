import type { ReactNode } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui'
import {
  Check,
  ChevronDown,
  Hand,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import type { CodingApprovalPolicy, ModelThinkingLevel } from '@/types'
import { formatContextWindowSize, resolveModelContextWindow } from '@/lib/knownContextWindow'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'
import {
  encodeComposerModelKey,
  parseComposerModelKey,
  useLiveModelCatalog,
} from '@/modelCatalog'
import { dshAcpSupportsModel } from '@/lib/dshModels'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import ComposerAgentMenu from '@/components/ComposerAgentMenu'
import { useT } from '@/hooks/useUiLocale'

const CONTROL_STYLES = `
.composer-control {
  height: 28px;
  min-height: 28px;
  gap: 0.35rem;
  border-radius: 8px;
  font-size: 13px;
  line-height: 20px;
  transition: background-color var(--motion-fast) ease, color var(--motion-fast) ease, transform var(--motion-fast) var(--ease-out);
}
.composer-control[data-slot='select-trigger'] {
  font-size: var(--text-body, 0.75rem) !important;
  line-height: var(--text-body--line-height, 1rem) !important;
  background-color: transparent !important;
  box-shadow: none !important;
}
.composer-control[data-slot='select-trigger']:hover:not(:disabled),
.composer-control[data-slot='select-trigger'][data-state='open'] {
  background-color: var(--btn-ghost-hover) !important;
}
.composer-permission {
  width: fit-content;
  min-width: 0;
  max-width: 11rem;
  flex: 0 0 auto;
  padding-inline: 0.55rem 0.45rem;
}
.composer-permission__label {
  min-width: 0;
  flex: 0 1 auto;
  overflow: visible;
  white-space: nowrap;
}
.composer-permission--full,
.composer-permission--full:hover { color: var(--warning); }
.approval-option {
  display: flex;
  min-height: 4.5rem;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}
.approval-option__icon { width: 1.15rem; height: 1.15rem; margin-top: 0.15rem; flex: none; }
.approval-option__title { font-size: var(--text-label, 0.875rem); line-height: 1.25rem; font-weight: 600; }
.approval-option__description { margin-top: 0.1rem; color: var(--muted-foreground); font-size: var(--text-control, 0.875rem); line-height: 1.25rem; }
.approval-option__check { width: 1rem; height: 1rem; margin-top: 0.15rem; flex: none; }
.approval-option--full,
.approval-option--full .approval-option__description,
.approval-option--full .approval-option__icon,
.approval-option--full .approval-option__check { color: var(--warning); }
.composer-model {
  width: fit-content;
  min-width: 0;
  max-width: min(18rem, 100%);
  flex: 0 1 auto;
  justify-self: end;
  padding-inline: 0.65rem;
}
@container chat-main (max-width: 52rem) {
  .composer-controls { flex-wrap: nowrap; gap: 0.25rem; }
  .composer-model { width: fit-content; max-width: min(18rem, 100%); }
}
@container chat-main (max-width: 36rem) {
  .composer-permission {
    width: 2rem;
    min-width: 2rem;
    max-width: 2rem;
    flex: 0 0 2rem;
    justify-content: center;
    padding-inline: 0;
  }
  .composer-permission__label,
  .composer-permission__chevron { display: none; }
  .composer-model { min-width: 0; max-width: calc(100% - 2.5rem); }
}
`

export default function CodingComposerControls({
  running,
  ctfSession,
  approvalPolicy,
  approvalLabel,
  modelKey,
  automaticModelLabel,
  compactModelLabel,
  thinkingLevels: thinkingLevelsProp,
  thinkingLevel,
  kernel,
  contextUsage,
  leading,
  footerEnd,
  accessory,
  status,
  context,
  hostSwitch,
  onChangeApprovalPolicy,
  onChangeModel,
  onChangeThinkingLevel,
  onChangeKernel,
  onShowPermissions,
}: {
  running: boolean
  ctfSession: boolean
  approvalPolicy: CodingApprovalPolicy
  approvalLabel: string
  modelKey: string
  automaticModelLabel: string
  compactModelLabel: string
  thinkingLevels?: ModelThinkingLevel[]
  thinkingLevel?: ModelThinkingLevel
  kernel?: 'pi' | 'dsh'
  contextUsage?: ContextUsagePresentation | null
  leading?: ReactNode
  footerEnd?: ReactNode
  accessory?: ReactNode
  status?: ReactNode
  context?: ReactNode
  /** Local | cloud host chip (capsule-exterior bottom-left, after approval). */
  hostSwitch?: ReactNode
  onChangeApprovalPolicy?: (value: string) => void
  onChangeModel?: (value: string) => void
  onChangeThinkingLevel?: (level: ModelThinkingLevel) => void
  onChangeKernel?: (value: 'pi' | 'dsh') => void
  onShowPermissions?: () => void
}) {
  const t = useT()
  const catalog = useLiveModelCatalog()
  const pickerGroups = catalog.pickerGroups
  const modelGroups: SearchableModelGroup[] = pickerGroups.map(group => ({
    key: group.key,
    label: group.label,
    models: group.models.map(model => ({
      value: encodeComposerModelKey(group.providerId, model, group.source),
      label: catalog.pickerModelLabel(group, model),
      model,
      disabled: modelUnavailableOnDsh(model),
      title: modelUnavailableOnDsh(model)
        ? t('DeepSeek Harness 不支持这个模型', 'DeepSeek Harness does not support this model')
        : undefined,
    })),
  }))
  const thinkingLevels = thinkingLevelsProp ?? []
  const parsedModel = parseComposerModelKey(modelKey)
  const contextLabel = formatContextWindowSize(
    contextUsage?.windowTokens || resolveModelContextWindow(parsedModel.model || compactModelLabel),
  )

  function modelUnavailableOnDsh(model: string) {
    return kernel === 'dsh' && !dshAcpSupportsModel(model)
  }

  function changeModel(value: string) {
    const next = String(value ?? '')
    const parsed = parseComposerModelKey(next)
    if (parsed.mode === 'manual' && parsed.model && modelUnavailableOnDsh(parsed.model)) {
      return
    }
    onChangeModel?.(next)
  }

  function triggerModelText() {
    if (modelKey === 'auto') {
      return `${automaticModelLabel} ${compactModelLabel}`
    }
    const parsed = parseComposerModelKey(modelKey)
    return `${parsed.model ?? ''} ${compactModelLabel}`
  }

  void ctfSession

  return (
    <div className="chat-composer__slots">
      <style>{CONTROL_STYLES}</style>
      {leading ? <div className="chat-composer__add-slot">{leading}</div> : null}
      <div className="chat-composer__meta app-no-drag">
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`composer-control composer-permission justify-start${approvalPolicy === 'full-auto' ? ' composer-permission--full' : ''}`}
                disabled={running}
                aria-label={t('Coding 权限策略', 'Coding permission policy')}
                title={approvalLabel}
              >
                {approvalPolicy === 'full-auto'
                  ? <ShieldAlert className="size-3.5 shrink-0 text-warning" />
                  : <LockKeyhole className="size-3.5 shrink-0" />}
                <span className="composer-permission__label">{approvalLabel}</span>
                <ChevronDown className="composer-permission__chevron size-3.5 shrink-0 text-muted-foreground opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8} className="w-[25rem] max-w-[calc(100vw-2rem)] p-0">
              <div className="flex items-center justify-between gap-4 px-4 pb-2 pt-3">
                <p className="text-label font-medium text-muted-foreground">
                  {t('应如何批准 MilkSU 操作？', 'How should MilkSU get approval to act?')}
                </p>
                <button
                  type="button"
                  className="shrink-0 text-label font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  onClick={event => {
                    event.stopPropagation()
                    onShowPermissions?.()
                  }}
                >
                  {t('了解更多', 'Learn more')}
                </button>
              </div>
              <DropdownMenuItem className="approval-option" onSelect={() => onChangeApprovalPolicy?.('ask')}>
                <Hand className="approval-option__icon" />
                <div className="min-w-0 flex-1">
                  <p className="approval-option__title">{t('请求批准', 'Ask before acting')}</p>
                  <p className="approval-option__description">
                    {t('编辑文件、运行命令或使用互联网前始终询问', 'Always ask before editing files, running commands, or using the internet')}
                  </p>
                </div>
                {approvalPolicy === 'ask' || approvalPolicy === 'read-only' ? <Check className="approval-option__check" /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem className="approval-option" onSelect={() => onChangeApprovalPolicy?.('workspace-auto')}>
                <ShieldCheck className="approval-option__icon" />
                <div className="min-w-0 flex-1">
                  <p className="approval-option__title">{t('替我审批', 'Approve for me')}</p>
                  <p className="approval-option__description">
                    {t('项目内和内置浏览器自动执行；用户浏览器、外部账户或高风险操作仍会拦截', 'Auto-run in the project and built-in browser. User browsers, external accounts, and high-risk actions still pause.')}
                  </p>
                </div>
                {approvalPolicy === 'workspace-auto' ? <Check className="approval-option__check" /> : null}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="approval-option approval-option--full" onSelect={() => onChangeApprovalPolicy?.('full-auto')}>
                <ShieldAlert className="approval-option__icon" />
                <div className="min-w-0 flex-1">
                  <p className="approval-option__title">{t('完全访问权限', 'Full access')}</p>
                  <p className="approval-option__description">
                    {t('可不受限制地访问互联网和当前用户可访问的任何文件', 'Unrestricted internet access and any files the current user can reach')}
                  </p>
                </div>
                {approvalPolicy === 'full-auto' ? <Check className="approval-option__check" /> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {hostSwitch}
          {context}
          {status}
          {footerEnd ? <span className="chat-composer__meta-end">{footerEnd}</span> : null}
      </div>
      <div className="chat-composer__primary-trail app-no-drag">
          <ComposerAgentMenu
            modelKey={modelKey}
            modelLabel={compactModelLabel}
            disabled={running}
            triggerClassName="composer-control composer-model min-w-0 border-0 bg-transparent px-2.5 shadow-none"
            ariaLabel={t('选择本任务模型', 'Choose a model for this task')}
            title={modelKey === 'auto'
              ? t('使用 MilkSU 默认模型；你可以仅为当前对话覆盖', 'Use the MilkSU default model. You can override it for this conversation only.')
              : t('当前对话固定使用所选模型', 'This conversation is pinned to the selected model')}
            trigger={(
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <ModelVendorIcon model={triggerModelText()} className="opacity-90" />
                <span className="min-w-0 truncate">{compactModelLabel}</span>
              </span>
            )}
            leading={[{
              value: 'auto',
              label: automaticModelLabel,
              model: automaticModelLabel,
            }]}
            groups={modelGroups}
            kernel={kernel}
            thinkingLevels={thinkingLevels}
            thinkingLevel={thinkingLevel}
            contextLabel={contextLabel}
            onChangeModel={changeModel}
            onChangeKernel={onChangeKernel}
            onChangeThinkingLevel={onChangeThinkingLevel}
          />
          {accessory}
      </div>
    </div>
  )
}
