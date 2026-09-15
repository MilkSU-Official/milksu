import { useEffect, useState } from 'react'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SettingsRow,
  SettingsSection,
} from '@/components/ui'
import { hasDesktopRuntime, invokeCommand, isMissingDesktopRuntime } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import type { Conversation } from '@/types'

export default function ArchivedConversationsSettings({
  onChanged,
}: {
  onChanged?: () => void
}) {
  const t = useT()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<{ action: 'restore' | 'delete'; conversation: Conversation } | null>(null)

  async function load() {
    if (!hasDesktopRuntime()) {
      setConversations([])
      setError('')
      return
    }
    setError('')
    try {
      setConversations(await invokeCommand<Conversation[]>('list_archived_conversations'))
    } catch (cause) {
      if (!isMissingDesktopRuntime(cause)) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  async function confirmAction() {
    const pending = confirmation
    if (!pending) return
    setError('')
    try {
      await invokeCommand(
        pending.action === 'restore' ? 'restore_conversation' : 'delete_archived_conversation',
        { id: pending.conversation.id },
      )
      setConfirmation(null)
      await load()
      onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function archivedTime(value: number | undefined) {
    return value
      ? t(`归档于 ${new Date(value).toLocaleString()}`, `Archived ${new Date(value).toLocaleString()}`)
      : ''
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="contents">
      {error ? <p className="text-body text-destructive">{error}</p> : null}
      {conversations.length ? (
        <SettingsSection aria-label={t('归档聊天', 'Archived chats')}>
          {conversations.map((conversation, index) => (
            <SettingsRow
              key={conversation.id}
              label={conversation.title}
              description={archivedTime(conversation.archivedAt)}
              divider={index < conversations.length - 1}
              trailing={(
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmation({ action: 'restore', conversation })}>
                    <ArchiveRestore className="size-3.5" />
                    {t('恢复', 'Restore')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={t('永久删除归档聊天', 'Permanently delete archived chat')}
                    title={t('永久删除', 'Delete permanently')}
                    onClick={() => setConfirmation({ action: 'delete', conversation })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            />
          ))}
        </SettingsSection>
      ) : null}

      <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!open) setConfirmation(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmation?.action === 'restore' ? t('恢复聊天？', 'Restore this chat?') : t('永久删除聊天？', 'Permanently delete this chat?')}
            </DialogTitle>
            {confirmation?.action === 'restore' ? (
              <DialogDescription>
                {t(`“${confirmation.conversation.title}”将恢复到 Agent 会话列表，可以继续原有上下文。`, `"${confirmation.conversation.title}" will return to the agent conversation list with its existing context.`)}
              </DialogDescription>
            ) : (
              <DialogDescription>
                {t(`“${confirmation?.conversation.title}”的聊天记录将被永久删除，此操作无法撤销。项目文件不会被删除。`, `"${confirmation?.conversation.title}" will be permanently deleted. This cannot be undone. Project files are not deleted.`)}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmation(null)}>{t('取消', 'Cancel')}</Button>
            <Button variant={confirmation?.action === 'delete' ? 'destructive' : 'default'} onClick={() => void confirmAction()}>
              {confirmation?.action === 'restore' ? t('确认恢复', 'Restore') : t('确认永久删除', 'Delete permanently')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
