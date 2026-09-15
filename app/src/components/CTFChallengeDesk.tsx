import { useMemo } from 'react'
import { Badge, Button } from '@/components/ui'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import CollectionPicker from '@/components/CollectionPicker'
import { ctfManualStatusLabel, type CTFManualStatus } from '@/lib/ctfManualStatus'
import { useT } from '@/hooks/useUiLocale'
import type { CTFCollaborationMode, CTFMaterialRequest } from '@/ctfTypes'
import type { CTFShowCatalogProblem } from '@/ctfshowTypes'
import type { NSSCTFChallenge } from '@/nssctfTypes'
import type { NSSCTFCatalogProblem, NSSCTFTrainingDashboard } from '@/nssctfTrainingTypes'
import type { Conversation } from '@/types'
import type { ItemCollectionStore } from '@/lib/itemCollections'

export default function CTFChallengeDesk({
  activeBank,
  nssctfProblems = [],
  ctfshowProblems = [],
  selectedNssctf: _selectedNssctf = null,
  dailyProblem = null,
  dailyReason: _dailyReason = '',
  selectedCtfshow: _selectedCtfshow = null,
  dashboard: _dashboard = null,
  nssctfAttemptedIds: _nssctfAttemptedIds = [],
  nssctfCompletedIds: _nssctfCompletedIds = [],
  ctfshowAttemptedIds: _ctfshowAttemptedIds = [],
  ctfshowCompletedIds: _ctfshowCompletedIds = [],
  page,
  pageCount,
  total,
  loading,
  loadingTitle,
  loadingDetail = '',
  emptyTitle,
  emptyDetail = '',
  actionLoading: _actionLoading,
  collaborationMode: _collaborationMode,
  selectedBrowserReady: _selectedBrowserReady,
  ctfshowBridgeReady: _ctfshowBridgeReady,
  attachmentError: _attachmentError,
  localMaterials: _localMaterials = [],
  catalogError = '',
  modelVerified: _modelVerified,
  catalogReady: _catalogReady,
  judgeReady: _judgeReady,
  hasActiveTraining: _hasActiveTraining,
  manualStatuses = {},
  conversations: _conversations = [],
  relatedJobId: _relatedJobId = '',
  collectionStore,
  onSelectNssctf,
  onSelectCtfshow,
  onPreviousPage,
  onNextPage,
  onGoPage,
  onSyncNssctf,
  onOpenCtfshow,
}: {
  activeBank: 'nssctf' | 'ctfshow'
  nssctfProblems?: NSSCTFCatalogProblem[]
  ctfshowProblems?: CTFShowCatalogProblem[]
  selectedNssctf?: NSSCTFChallenge | null
  dailyProblem?: NSSCTFCatalogProblem | null
  dailyReason?: string
  selectedCtfshow?: CTFShowCatalogProblem | null
  dashboard?: NSSCTFTrainingDashboard | null
  nssctfAttemptedIds?: number[]
  nssctfCompletedIds?: number[]
  ctfshowAttemptedIds?: number[]
  ctfshowCompletedIds?: number[]
  page: number
  pageCount: number
  total: number
  loading: boolean
  loadingTitle?: string
  loadingDetail?: string
  emptyTitle?: string
  emptyDetail?: string
  actionLoading: boolean
  collaborationMode: CTFCollaborationMode
  selectedBrowserReady: boolean
  ctfshowBridgeReady: boolean
  attachmentError: string
  localMaterials?: CTFMaterialRequest[]
  catalogError?: string
  modelVerified: boolean
  catalogReady: boolean
  judgeReady: boolean
  hasActiveTraining: boolean
  manualStatuses?: Record<string, CTFManualStatus>
  conversations?: Conversation[]
  relatedJobId?: string
  collectionStore: ItemCollectionStore
  onSelectNssctf?: (id: number) => void
  onSelectCtfshow?: (id: number) => void
  onPreviousPage?: () => void
  onNextPage?: () => void
  onGoPage?: (page: number) => void
  onStartNssctf?: () => void
  onChooseLocalMaterials?: () => void
  onStartCtfshow?: (id: number) => void
  onClearSelection?: () => void
  onOpenProblem?: () => void
  onOpenCtfshow?: () => void
  onSyncNssctf?: () => void
  onRefreshJudge?: () => void
  onOpenSettings?: () => void
  onOpenBrowserSettings?: () => void
  onOpenConversation?: (id: string) => void
  onUpdateManualStatus?: (key: string, status: CTFManualStatus) => void
  onChangeDaily?: () => void
  onCollaborationModeChange?: (value: CTFCollaborationMode) => void
}) {
  const t = useT()
  const resolvedLoadingTitle = loadingTitle ?? t('正在加载题库', 'Loading catalog')
  const resolvedEmptyTitle = emptyTitle ?? t('没有匹配题目', 'No matching challenges')

  const displayedNssctfProblems = useMemo(() => {
    const problems: NSSCTFCatalogProblem[] = []
    if (dailyProblem) problems.push(dailyProblem)
    problems.push(...nssctfProblems)
    return [...new Map(problems.map(problem => [problem.platformId, problem])).values()]
  }, [dailyProblem, nssctfProblems])
  const dailyProblemID = dailyProblem?.platformId
  const visiblePages = useMemo(() => {
    if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1)
    const first = Math.min(Math.max(page - 2, 1), pageCount - 4)
    return Array.from({ length: 5 }, (_, index) => first + index)
  }, [page, pageCount])

  function statusKey(id: number) {
    return `${activeBank}:${id}`
  }

  function collectionKey(id: number) {
    return `${activeBank}:${id}`
  }

  function statusFor(id: number): CTFManualStatus {
    return manualStatuses?.[statusKey(id)] ?? 'not_started'
  }

  function statusLabel(status: CTFManualStatus) {
    return ctfManualStatusLabel(status)
  }

  function difficultyLabel(value: number) {
    if (!value || value <= 1.4) return t('入门', 'Intro')
    if (value <= 2.4) return t('简单', 'Easy')
    if (value <= 3.2) return t('中等', 'Medium')
    return t('困难', 'Hard')
  }

  function difficultyVariant(value: number) {
    if (!value || value <= 2.4) return 'secondary' as const
    if (value <= 3.2) return 'warning' as const
    return 'destructive' as const
  }

  function select(id: number) {
    if (activeBank === 'nssctf') onSelectNssctf?.(id)
    else onSelectCtfshow?.(id)
  }

  const listEmpty = !(activeBank === 'nssctf' ? displayedNssctfProblems.length : ctfshowProblems.length)

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label={t('CTF 挑战列表', 'CTF challenge list')} data-plugin-surface="workspace-list">
      <div className="grid h-12 shrink-0 grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
        <span>#</span><span>{t('题目', 'Challenge')}</span><span>{t('类别', 'Category')}</span><span>{t('难度', 'Difficulty')}</span><span>{t('我的状态', 'My status')}</span><span className="sr-only">{t('收藏', 'Collections')}</span><span className="sr-only">{t('打开', 'Open')}</span>
      </div>

      <div className="ctf-challenge-list min-h-0 flex-1 overflow-y-auto">
        {activeBank === 'nssctf' ? displayedNssctfProblems.map(problem => (
          <article
            key={problem.platformId}
            className="challenge-row grid min-h-[62px] w-full grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_72px] items-center gap-4 border-b border-border px-6 text-left hover:bg-accent"
            data-testid="catalog-row"
          >
            <span className={`font-mono text-caption ${dailyProblemID === problem.platformId ? 'text-primary' : 'text-muted-foreground'}`}>
              {dailyProblemID === problem.platformId ? <CalendarDays className="mr-2 inline size-4" /> : null}
              {dailyProblemID === problem.platformId ? 'Daily' : `P${problem.platformId}`}
            </span>
            <span className="min-w-0 select-text">
              <span className="truncate text-control font-medium">{problem.title}</span>
              {dailyProblemID === problem.platformId ? (
                <Badge variant="warning" className="ml-3">{t('每日挑战', 'Daily challenge')}</Badge>
              ) : null}
            </span>
            <Badge variant="outline">{problem.category}</Badge>
            <Badge variant={difficultyVariant(problem.difficulty)}>{difficultyLabel(problem.difficulty)}</Badge>
            <span className={`text-caption ${statusFor(problem.platformId) === 'in_progress' ? 'text-primary' : 'text-muted-foreground'}`}>{statusLabel(statusFor(problem.platformId))}</span>
            <CollectionPicker itemKey={collectionKey(problem.platformId)} store={collectionStore} />
            <Button size="sm" variant="outline" data-testid="open-item" onClick={() => select(problem.platformId)}>{t('打开', 'Open')}</Button>
          </article>
        )) : ctfshowProblems.map(problem => (
          <article
            key={problem.platformId}
            className="challenge-row grid min-h-[62px] w-full grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_72px] items-center gap-4 border-b border-border px-6 text-left hover:bg-accent"
            data-testid="catalog-row"
          >
            <span className="font-mono text-caption text-muted-foreground">#{problem.platformId}</span>
            <span className="min-w-0 truncate text-control font-medium select-text">{problem.title}</span>
            <Badge variant="outline">{problem.category}</Badge>
            <span className="text-caption text-primary">{t(`${problem.points} 分`, `${problem.points} pts`)}</span>
            <span className="text-caption text-muted-foreground">{statusLabel(statusFor(problem.platformId))}</span>
            <CollectionPicker itemKey={collectionKey(problem.platformId)} store={collectionStore} />
            <Button size="sm" variant="outline" data-testid="open-item" onClick={() => select(problem.platformId)}>{t('打开', 'Open')}</Button>
          </article>
        ))}

        {loading && listEmpty ? (
          <div className="grid min-h-64 place-items-center px-8 text-center" data-testid="ctf-catalog-loading-state">
            <div className="max-w-lg">
              <LoaderCircle className="mx-auto size-5 animate-spin text-primary" />
              <p className="mt-4 text-control font-medium">{resolvedLoadingTitle}</p>
              {loadingDetail ? <p className="mt-2 text-caption leading-5 text-muted-foreground">{loadingDetail}</p> : null}
              {activeBank === 'ctfshow' ? (
                <Button variant="outline" size="sm" className="mt-4" onClick={onOpenCtfshow}>
                  <ExternalLink className="size-4" />
                  {t('打开 CTFshow', 'Open CTFshow')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : loading ? (
          <div className="flex min-h-12 items-center justify-center gap-2 border-b border-border px-6 text-caption text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {t('正在后台刷新，当前题目仍可使用', 'Refreshing in the background; current challenges remain usable')}
          </div>
        ) : listEmpty ? (
          <div className="grid min-h-64 place-items-center px-8 text-center">
            <div>
              {catalogError || resolvedEmptyTitle ? (
                <p className="text-control font-medium">{catalogError ? t('题库暂时不可用', 'Catalog temporarily unavailable') : resolvedEmptyTitle}</p>
              ) : null}
              {catalogError || emptyDetail ? (
                <p className="mt-2 max-w-lg text-caption leading-5 text-muted-foreground">{catalogError || emptyDetail}</p>
              ) : null}
              {activeBank === 'nssctf' ? (
                <Button variant="outline" size="sm" className="mt-4" onClick={onSyncNssctf}><RefreshCw className="size-4" />{t('重新同步', 'Resync')}</Button>
              ) : (
                <Button variant="outline" size="sm" className="mt-4" onClick={onOpenCtfshow}><ExternalLink className="size-4" />{t('打开 CTFshow', 'Open CTFshow')}</Button>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex h-14 shrink-0 items-center justify-between border-t border-border px-6">
        <span className="text-caption text-muted-foreground">{t(`共 ${total.toLocaleString()} 题`, `${total.toLocaleString()} challenges`)}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" disabled={page <= 1 || loading} aria-label={t('上一页', 'Previous page')} onClick={onPreviousPage}><ChevronLeft className="size-4" /></Button>
          {visiblePages.map(pageNumber => (
            <Button key={pageNumber} variant={pageNumber === page ? 'outline' : 'ghost'} size="icon-sm" onClick={() => onGoPage?.(pageNumber)}>{pageNumber}</Button>
          ))}
          <Button variant="ghost" size="icon-sm" disabled={page >= pageCount || loading} aria-label={t('下一页', 'Next page')} onClick={onNextPage}><ChevronRight className="size-4" /></Button>
        </div>
      </footer>
      <style>{`
        .ctf-challenge-list { background-color: var(--card); }
        .challenge-row { position: relative; cursor: default; }
      `}</style>
    </section>
  )
}
