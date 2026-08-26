<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@felinic/ui'
import { Plus, Trash2 } from 'lucide-vue-next'
import {
  ALL_COLLECTIONS_ID,
  QUICK_COLLECTION_ID,
  type ItemCollectionStore,
} from '@/lib/itemCollections'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  modelValue: string
  store: ItemCollectionStore
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const managerOpen = ref(false)
const newName = ref('')
const error = ref('')
const selectedCount = computed(() => props.store.itemKeysFor(props.modelValue).length)

function createCollection() {
  try {
    const id = props.store.create(newName.value)
    newName.value = ''
    error.value = ''
    emit('update:modelValue', id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function removeCollection(id: string) {
  props.store.remove(id)
  if (props.modelValue === id) emit('update:modelValue', ALL_COLLECTIONS_ID)
}

function selectCollection(id: string) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="collection-tabs flex min-w-0 shrink items-center gap-2 overflow-x-auto" role="tablist" :aria-label="t('收藏夹', 'Collections')">
    <div class="ak-segmented">
      <button
        type="button"
        class="ak-segmented__item"
        :aria-pressed="modelValue === ALL_COLLECTIONS_ID"
        role="tab"
        :aria-selected="modelValue === ALL_COLLECTIONS_ID"
        @click="selectCollection(ALL_COLLECTIONS_ID)"
      >
        {{ t('全部', 'All') }}
      </button>
      <button
        v-for="collection in store.collections.value"
        :key="collection.id"
        type="button"
        class="ak-segmented__item"
        :aria-pressed="modelValue === collection.id"
        role="tab"
        :aria-selected="modelValue === collection.id"
        @click="selectCollection(collection.id)"
      >
        {{ collection.name }}
        <span v-if="collection.itemKeys.length" class="tab-count">{{ collection.itemKeys.length }}</span>
      </button>
    </div>
    <button type="button" class="collection-tab-manage" :aria-label="t('管理收藏夹', 'Manage collections')" @click="managerOpen = true">
      <Plus class="size-4" />{{ t('新建收藏夹', 'New collection') }}
    </button>
    <span v-if="modelValue !== ALL_COLLECTIONS_ID" class="sr-only">{{ t(`当前收藏夹 ${selectedCount} 条`, `${selectedCount} items in this collection`) }}</span>
  </div>

  <Dialog v-model:open="managerOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('收藏夹', 'Collections') }}</DialogTitle>
        <DialogDescription>{{ t('一条记录可以放进多个收藏夹。', 'An item can belong to more than one collection.') }}</DialogDescription>
      </DialogHeader>
      <div class="divide-y divide-border rounded-lg border border-border">
        <div
          v-for="collection in store.collections.value"
          :key="collection.id"
          class="flex h-11 items-center gap-3 px-3"
        >
          <span class="min-w-0 flex-1 truncate text-control">{{ collection.name }}</span>
          <span class="font-mono text-caption text-muted-foreground">{{ collection.itemKeys.length }}</span>
          <Button
            v-if="collection.id !== QUICK_COLLECTION_ID"
            variant="ghost"
            size="icon-sm"
            :aria-label="t(`删除收藏夹 ${collection.name}`, `Delete collection ${collection.name}`)"
            @click="removeCollection(collection.id)"
          >
            <Trash2 class="size-3.5" />
          </Button>
        </div>
      </div>
      <form class="flex gap-2" @submit.prevent="createCollection">
        <Input v-model="newName" :placeholder="t('新建收藏夹', 'New collection')" :aria-label="t('收藏夹名称', 'Collection name')" />
        <Button type="submit" :disabled="!newName.trim()">{{ t('新建', 'Create') }}</Button>
      </form>
      <p v-if="error" class="text-caption text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button type="button" variant="outline" @click="managerOpen = false">{{ t('完成', 'Done') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.collection-tabs { scrollbar-width: none; }
.collection-tabs::-webkit-scrollbar { display: none; }
.collection-tab-manage {
  display: inline-flex;
  height: 2.65rem;
  flex: none;
  align-items: center;
  gap: .45rem;
  border: 0;
  background: transparent;
  padding: 0 .85rem;
  color: var(--foreground);
  font-size: var(--text-body);
  cursor: pointer;
}
.tab-count {
  min-width: 1.2rem;
  margin-left: .35rem;
  background: var(--hover-2);
  padding: .05rem .35rem;
  color: var(--muted-foreground);
  font-family: inherit;
  font-size: .68rem;
  text-align: center;
}
</style>
