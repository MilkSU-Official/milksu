import type { CSSProperties, ReactNode } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import {
  Check,
  BrainCircuit,
  ChevronDown,
  Hand,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import type { CodingApprovalPolicy, ModelThinkingLevel } from '@/types'
import { MODEL_THINKING_LEVEL_LABELS } from '@/lib/modelThinking'
import {
  encodeComposerModelKey,
  parseComposerModelKey,
  useLiveModelCatalog,
} from '@/modelCatalog'
import { dshAcpSupportsModel } from '@/lib/dshModels'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import { useT } from '@/hooks/useUiLocale'

const CONTROL_STYLES = `
.composer-controls { flex: 1 1 auto; }
.composer-control {
  height: 28px;
  min-height: 28px;
  gap: 0.35rem;
  border-radius: 8px;
  font-size: 13px;
  line-height: 20px;
  transition: background-color 100ms ease, color 100ms ease;
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
.composer-runtime-pickers { margin-left: auto; }
.composer-model {
  width: fit-content;
  min-width: 0;
  max-width: min(18rem, 100%);
  flex: 0 1 auto;
  justify-self: end;
  padding-inline: 0.65rem;
}
.composer-harness {
  width: fit-content;
  min-width: 0;
  max-width: min(12rem, 100%);
  flex: 0 1 auto;
  padding-inline: 0.65rem;
}
.composer-thinking { flex: 0 0 auto; padding-inline: 0.6rem 0.45rem; }
.thinking-slider {
  --thinking-progress: 0%;
  width: 100%;
  height: 1.5rem;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.thinking-slider::-webkit-slider-runnable-track {
  height: 0.5rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--brand) 0 var(--thinking-progress), var(--muted) var(--thinking-progress) 100%);
}
.thinking-slider::-webkit-slider-thumb {
  width: 1.35rem;
  height: 1.35rem;
  margin-top: -0.425rem;
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 9999px;
  background: var(--background);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--foreground) 18%, transparent);
}
.thinking-slider:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 9999px;
}
@container chat-main (max-width: 52rem) {
  .composer-controls { flex-wrap: nowrap; gap: 0.25rem; }
  .composer-model { width: fit-content; max-width: min(18rem, 100%); }
  .composer-thinking span,
  .composer-thinking svg:last-child { display: none; }
  .composer-thinking { width: 2rem; padding-inline: 0; }
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
  leading,
  status,
  context,
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
  leading?: ReactNode
  status?: ReactNode
  context?: ReactNode
  onChangeApprovalPolicy?: (value: string) => void
  onChangeModel?: (value: string) => void
  onChangeThinkingLevel?: (level: ModelThinkingLevel) => void
  onChangeKernel?: (value: 'pi' | 'dsh') => void
  onShowPermissions?: () => void
}) {
  const t = useT()
  const catalog = useLiveModelCatalog()
  const pickerGroups = catalog.pickerGroups
  const thinkingLevels = thinkingLevelsProp ?? []
  const thinkingIndex = Math.max(0, thinkingLevels.indexOf(thinkingLevel ?? thinkingLevels[0]))
  const thinkingProgress = thinkingLevels.length <= 1
    ? 100
    : (thinkingIndex / (thinkingLevels.length - 1)) * 100
  const thinkingLabel = thinkingLevel ? MODEL_THINKING_LEVEL_LABELS[thinkingLevel] : ''

  function changeThinkingIndex(value: string) {
    const level = thinkingLevels[Number(value)]
    if (level) onChangeThinkingLevel?.(level)
  }

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
    <>
      <style>{CONTROL_STYLES}</style>
      <div className="composer-controls app-no-drag flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {leading}
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
          {status}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          {context}
          {thinkingLevels.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="composer-control composer-thinking"
                  disabled={running}
                  aria-label={t(`思考层级：${thinkingLabel}`, `Thinking level: ${thinkingLabel}`)}
                  title={t('调整当前对话的思考层级', 'Adjust thinking level for this conversation')}
                >
                  <BrainCircuit className="size-3.5 shrink-0" />
                  <span>{thinkingLabel}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="thinking-menu w-[21rem] max-w-[calc(100vw-2rem)] p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-label font-medium">{t('思考层级', 'Thinking level')}</p>
                  <span className="text-caption font-medium text-primary">{thinkingLabel}</span>
                </div>
                <input
                  className="thinking-slider mt-4"
                  type="range"
                  min={0}
                  max={Math.max(thinkingLevels.length - 1, 0)}
                  step={1}
                  value={thinkingIndex}
                  style={{ '--thinking-progress': `${thinkingProgress}%` } as CSSProperties}
                  aria-label={t('当前对话思考层级', 'Thinking level for this conversation')}
                  onInput={event => changeThinkingIndex((event.target as HTMLInputElement).value)}
                />
                <div className="mt-2 flex items-center justify-between gap-1">
                  {thinkingLevels.map(level => (
                    <button
                      key={level}
                      type="button"
                      className={`whitespace-nowrap text-center text-[0.625rem] text-muted-foreground hover:text-foreground${level === thinkingLevel ? ' font-semibold text-foreground' : ''}`}
                      onClick={event => {
                        event.stopPropagation()
                        onChangeThinkingLevel?.(level)
                      }}
                    >
                      {MODEL_THINKING_LEVEL_LABELS[level]}
                    </button>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <div className="composer-runtime-pickers flex min-w-0 items-center gap-1.5">
            <Select value={modelKey} disabled={running} onValueChange={value => changeModel(String(value ?? ''))}>
              <SelectTrigger
                className="composer-control composer-model min-w-0 border-0 bg-transparent shadow-none"
                aria-label={t('选择本任务模型', 'Choose a model for this task')}
                title={modelKey === 'auto'
                  ? t('使用 MilkSU 默认模型；你可以仅为当前对话覆盖', 'Use the MilkSU default model. You can override it for this conversation only.')
                  : t('当前对话固定使用所选模型', 'This conversation is pinned to the selected model')}
              >
                <SelectValue>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <ModelVendorIcon model={triggerModelText()} className="opacity-90" />
                    <span className="min-w-0 truncate">{compactModelLabel}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-96">
                <SelectGroup>
                  <SelectLabel>Default</SelectLabel>
                  <SelectItem value="auto">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <ModelVendorIcon model={automaticModelLabel} />
                      <span className="min-w-0 truncate">{automaticModelLabel}</span>
                    </span>
                  </SelectItem>
                </SelectGroup>
                {pickerGroups.length ? <SelectSeparator /> : null}
                {pickerGroups.map((group, groupIndex) => (
                  <div key={group.key}>
                    {groupIndex > 0 ? <SelectSeparator /> : null}
                    <SelectGroup>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.models.map(model => (
                        <SelectItem
                          key={`${group.key}:${model}`}
                          value={encodeComposerModelKey(group.providerId, model, group.source)}
                          disabled={modelUnavailableOnDsh(model)}
                          title={modelUnavailableOnDsh(model)
                            ? t('DeepSeek Harness 不支持这个模型', 'DeepSeek Harness does not support this model')
                            : undefined}
                        >
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <ModelVendorIcon model={model} label={catalog.pickerModelLabel(group, model)} />
                            <span className="min-w-0 truncate">{catalog.pickerModelLabel(group, model)}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </div>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={kernel ?? 'pi'}
              disabled={running}
              onValueChange={value => onChangeKernel?.(value === 'dsh' ? 'dsh' : 'pi')}
            >
              <SelectTrigger
                className="composer-control composer-harness min-w-0 border-0 bg-transparent shadow-none"
                aria-label={t('选择 Agent 运行时', 'Choose agent runtime')}
                title={t('当前对话使用的 Agent 运行时', 'Agent runtime for this conversation')}
              >
                <SelectValue>
                  <span className="min-w-0 truncate">
                    {kernel === 'dsh' ? t('DeepSeek Harness', 'DeepSeek Harness') : t('Pi', 'Pi')}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="min-w-56">
                <SelectItem value="pi">{t('Pi', 'Pi')}</SelectItem>
                <SelectItem value="dsh">{t('DeepSeek Harness', 'DeepSeek Harness')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </>
  )
}
