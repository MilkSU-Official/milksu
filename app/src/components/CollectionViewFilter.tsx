import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@/components/ui'
import { ALL_COLLECTIONS_ID, QUICK_COLLECTION_ID, type ItemCollectionStore } from '@/lib/itemCollections'
import { useT } from '@/hooks/useUiLocale'

export default function CollectionViewFilter({
  modelValue,
  store,
  onModelValueChange,
}: {
  modelValue: string
  store: ItemCollectionStore
  onModelValueChange?: (value: string) => void
}) {
  const t = useT()
  const collections = store.collections
  const [managerOpen, setManagerOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const selectedCount = store.itemKeysFor(modelValue).length

  function createCollection() {
    try {
      const id = store.create(newName)
      setNewName('')
      setError('')
      onModelValueChange?.(id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  function removeCollection(id: string) {
    store.remove(id)
    if (modelValue === id) onModelValueChange?.(ALL_COLLECTIONS_ID)
  }

  function selectCollection(id: string) {
    onModelValueChange?.(id)
  }

  return (
    <>
      <div className="collection-tabs flex min-w-0 shrink items-center gap-2 overflow-x-auto" role="tablist" aria-label={t('收藏夹', 'Collections')}>
        <Button
          size="sm"
          variant={modelValue === ALL_COLLECTIONS_ID ? 'default' : 'outline'}
          aria-pressed={modelValue === ALL_COLLECTIONS_ID}
          role="tab"
          aria-selected={modelValue === ALL_COLLECTIONS_ID}
          onClick={() => selectCollection(ALL_COLLECTIONS_ID)}
        >
          {t('全部', 'All')}
        </Button>
        {collections.map(collection => (
          <Button
            key={collection.id}
            size="sm"
            variant={modelValue === collection.id ? 'default' : 'outline'}
            aria-pressed={modelValue === collection.id}
            role="tab"
            aria-selected={modelValue === collection.id}
            onClick={() => selectCollection(collection.id)}
          >
            {collection.name}
            {collection.itemKeys.length ? <span className="ml-1 text-caption opacity-70">{collection.itemKeys.length}</span> : null}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" aria-label={t('管理收藏夹', 'Manage collections')} onClick={() => setManagerOpen(true)}>
          <Plus className="size-4" />{t('新建收藏夹', 'New collection')}
        </Button>
        {modelValue !== ALL_COLLECTIONS_ID ? (
          <span className="sr-only">{t(`当前收藏夹 ${selectedCount} 条`, `${selectedCount} items in this collection`)}</span>
        ) : null}
      </div>

      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('收藏夹', 'Collections')}</DialogTitle>
            <DialogDescription>{t('一条记录可以放进多个收藏夹。', 'An item can belong to more than one collection.')}</DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border rounded-lg border border-border">
            {collections.map(collection => (
              <div key={collection.id} className="flex h-11 items-center gap-3 px-3">
                <span className="min-w-0 flex-1 truncate text-control">{collection.name}</span>
                <span className="font-mono text-caption text-muted-foreground">{collection.itemKeys.length}</span>
                {collection.id !== QUICK_COLLECTION_ID ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(`删除收藏夹 ${collection.name}`, `Delete collection ${collection.name}`)}
                    onClick={() => removeCollection(collection.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={event => {
              event.preventDefault()
              createCollection()
            }}
          >
            <Input
              value={newName}
              onChange={event => setNewName(event.target.value)}
              placeholder={t('新建收藏夹', 'New collection')}
              aria-label={t('收藏夹名称', 'Collection name')}
            />
            <Button type="submit" disabled={!newName.trim()}>{t('新建', 'Create')}</Button>
          </form>
          {error ? <p className="text-caption text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManagerOpen(false)}>{t('完成', 'Done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <style>{collectionViewFilterCss}</style>
    </>
  )
}

const collectionViewFilterCss = `
.collection-tabs { scrollbar-width: none; }
.collection-tabs::-webkit-scrollbar { display: none; }
`
