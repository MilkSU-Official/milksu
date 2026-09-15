import { useState } from 'react'
import { Bookmark, Plus } from 'lucide-react'
import { Button, Checkbox, Input, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import type { ItemCollectionStore } from '@/lib/itemCollections'
import { useT } from '@/hooks/useUiLocale'

export default function CollectionPicker({
  itemKey,
  store,
}: {
  itemKey: string
  store: ItemCollectionStore
}) {
  const t = useT()
  const collections = store.collections
  const saved = store.has(itemKey)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  function toggle(collectionId: string) {
    store.toggle(itemKey, collectionId)
    setError('')
  }

  function createCollection() {
    try {
      store.create(newName, itemKey)
      setNewName('')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="collection-bookmark shrink-0"
          aria-label={saved ? t('编辑收藏', 'Edit collections') : t('收藏', 'Save to collection')}
          onClick={event => event.stopPropagation()}
        >
          <Bookmark className={`size-4 ${saved ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="collection-popover w-64 p-2" onClick={event => event.stopPropagation()}>
        <p className="px-2 pb-1.5 pt-1 text-caption font-medium text-muted-foreground">{t('收藏到', 'Save to')}</p>
        {collections.map(collection => (
          <button
            key={collection.id}
            type="button"
            className="flex h-9 w-full items-center gap-3 rounded-md px-2 text-left text-control hover:bg-muted/60"
            onClick={() => toggle(collection.id)}
          >
            <Checkbox
              checked={store.has(itemKey, collection.id)}
              tabIndex={-1}
              className="data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          </button>
        ))}
        <form
          className="mt-2 flex gap-1.5 border-t border-border pt-2"
          onSubmit={event => {
            event.preventDefault()
            createCollection()
          }}
        >
          <Input
            value={newName}
            onChange={event => setNewName(event.target.value)}
            className="min-w-0"
            placeholder={t('新建收藏夹', 'New collection')}
            aria-label={t('新建收藏夹', 'New collection')}
          />
          <Button type="submit" variant="ghost" size="icon-sm" disabled={!newName.trim()} aria-label={t('创建收藏夹', 'Create collection')}>
            <Plus className="size-4" />
          </Button>
        </form>
        {error ? <p className="px-2 pt-2 text-caption text-destructive">{error}</p> : null}
      </PopoverContent>
      <style>{collectionPickerCss}</style>
    </Popover>
  )
}

const collectionPickerCss = `
.collection-bookmark:has(.fill-primary) { color: var(--brand); background: var(--brand-soft); }
.collection-popover { border-color: var(--border-menu-elevated); }
`
