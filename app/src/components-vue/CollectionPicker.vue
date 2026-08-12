<script setup lang="ts">
import { ref } from 'vue'
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@felinic/ui'
import { Bookmark, Plus } from 'lucide-vue-next'
import type { ItemCollectionStore } from '@/lib/itemCollections'

const props = defineProps<{
  itemKey: string
  store: ItemCollectionStore
}>()

const newName = ref('')
const error = ref('')

function toggle(collectionId: string) {
  props.store.toggle(props.itemKey, collectionId)
  error.value = ''
}

function createCollection() {
  try {
    props.store.create(newName.value, props.itemKey)
    newName.value = ''
    error.value = ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="collection-bookmark shrink-0"
        :aria-label="store.has(itemKey) ? '编辑收藏' : '收藏'"
        @click.stop
      >
        <Bookmark
          class="size-4"
          :class="store.has(itemKey) ? 'fill-primary text-primary' : 'text-muted-foreground'"
        />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="collection-popover w-64 p-2" @click.stop>
      <p class="px-2 pb-1.5 pt-1 text-caption font-medium text-muted-foreground">收藏到</p>
      <button
        v-for="collection in store.collections.value"
        :key="collection.id"
        type="button"
        class="flex h-9 w-full items-center gap-3 rounded-md px-2 text-left text-control hover:bg-muted/60"
        @click="toggle(collection.id)"
      >
        <Checkbox
          :model-value="store.has(itemKey, collection.id)"
          tabindex="-1"
          class="data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate">{{ collection.name }}</span>
      </button>
      <form class="mt-2 flex gap-1.5 border-t border-border pt-2" @submit.prevent="createCollection">
        <Input
          v-model="newName"
          size="sm"
          class="min-w-0"
          placeholder="新建收藏夹"
          aria-label="新建收藏夹"
        />
        <Button type="submit" variant="ghost" size="icon-sm" :disabled="!newName.trim()" aria-label="创建收藏夹">
          <Plus class="size-4" />
        </Button>
      </form>
      <p v-if="error" class="px-2 pt-2 text-caption text-destructive">{{ error }}</p>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
.collection-bookmark:has(.fill-primary) { color: var(--brand); background: var(--brand-soft); }
.collection-popover { border-color: var(--border-menu-elevated); }
</style>
