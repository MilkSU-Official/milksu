<script setup lang="ts">
import {
  Badge,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@felinic/ui'
import {
  Bookmark,
  ExternalLink,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Star,
  Workflow,
} from 'lucide-vue-next'
import { useVulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import type { VulnerabilitySeverity, VulnerabilityStatus } from '@/vulnerabilityIntel'

defineEmits<{ openSettings: [] }>()
const dashboard = useVulnerabilityDashboard()

function severityVariant(severity: VulnerabilitySeverity) {
  return severity === 'critical' ? 'destructive' : severity === 'high' ? 'warning' : 'info'
}

function statusVariant(status: VulnerabilityStatus) {
  if (status === '已验证') return 'success'
  if (status === '研究中') return 'info'
  if (status === '待复现') return 'warning'
  return 'secondary'
}
</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col bg-background">
    <header class="app-drag border-b border-border px-7 py-5">
      <div class="flex items-start justify-between gap-6">
        <div>
          <h1 class="text-2xl font-semibold tracking-[-0.035em]">CVE</h1>
          <p class="mt-1 text-body text-muted-foreground">追踪 CVE、资产命中与研究进度</p>
        </div>
        <div class="app-no-drag flex items-center gap-2">
          <Button
            :variant="dashboard.watchOnly.value ? 'outline' : 'ghost'"
            size="sm"
            @click="dashboard.watchOnly.value = !dashboard.watchOnly.value"
          >
            <Bookmark class="size-4" />
            我的关注
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="刷新" @click="dashboard.refreshSources">
            <RefreshCw class="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="设置" @click="$emit('openSettings')">
            <Settings class="size-4" />
          </Button>
        </div>
      </div>

      <div class="app-no-drag mt-5 flex flex-wrap items-center gap-3">
        <label class="relative min-w-64 flex-1 max-w-md">
          <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="dashboard.query.value" class="pl-9" placeholder="搜索 CVE、产品或厂商" />
        </label>
        <NativeSelect v-model="dashboard.severity.value" size="sm">
          <NativeSelectOption
            v-for="filter in dashboard.severityFilters"
            :key="filter.value"
            :value="filter.value"
          >
            {{ filter.label }}
          </NativeSelectOption>
        </NativeSelect>
        <span class="ml-auto text-caption text-muted-foreground">
          内置演示情报源 · rev {{ dashboard.sourceRevision.value }}
        </span>
      </div>
    </header>

    <div class="grid min-h-0 flex-1 grid-cols-[minmax(560px,1.25fr)_minmax(360px,.75fr)] max-[1080px]:grid-cols-1">
      <section class="min-h-0 overflow-auto border-r border-border max-[1080px]:border-b max-[1080px]:border-r-0">
        <Table>
          <TableHeader class="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead class="pl-6">CVE</TableHead>
              <TableHead>漏洞</TableHead>
              <TableHead>CVSS</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>资产</TableHead>
              <TableHead class="pr-6">更新</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="item in dashboard.filtered.value"
              :key="item.id"
              class="cursor-pointer"
              :data-state="item.id === dashboard.selectedId.value ? 'selected' : undefined"
              @click="dashboard.selectedId.value = item.id"
            >
              <TableCell class="pl-6 font-mono text-body">
                <span class="flex items-center gap-2">
                  <Star v-if="dashboard.watched.value.includes(item.id)" class="size-3 fill-current" />
                  {{ item.id }}
                </span>
              </TableCell>
              <TableCell class="max-w-72 whitespace-normal">
                <p class="text-body font-medium leading-5">{{ item.title }}</p>
                <p class="mt-1 text-caption text-muted-foreground">{{ item.vendor }}</p>
              </TableCell>
              <TableCell>
                <Badge :variant="severityVariant(item.severity)" font="mono">{{ item.cvss.toFixed(1) }}</Badge>
              </TableCell>
              <TableCell><Badge :variant="statusVariant(item.status)">{{ item.status }}</Badge></TableCell>
              <TableCell class="font-mono text-body">{{ item.assetCount }}</TableCell>
              <TableCell class="pr-6 text-caption text-muted-foreground">{{ item.updated }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div v-if="!dashboard.filtered.value.length" class="px-6 py-16 text-center text-body text-muted-foreground">
          没有匹配的漏洞情报
        </div>
      </section>

      <aside v-if="dashboard.selected.value" class="min-h-0 overflow-y-auto">
        <div class="px-6 py-6">
          <div class="flex items-center gap-2">
            <Badge variant="outline" font="mono">{{ dashboard.selected.value.id }}</Badge>
            <Button
              variant="ghost"
              size="sm"
              class="ml-auto"
              @click="dashboard.toggleWatch(dashboard.selected.value.id)"
            >
              <Star
                class="size-4"
                :class="dashboard.watched.value.includes(dashboard.selected.value.id) ? 'fill-current' : ''"
              />
              {{ dashboard.watched.value.includes(dashboard.selected.value.id) ? '已关注' : '关注' }}
            </Button>
          </div>
          <h2 class="mt-4 text-xl font-semibold leading-8 tracking-[-0.03em]">{{ dashboard.selected.value.title }}</h2>
          <div class="mt-3 flex flex-wrap gap-2">
            <Badge :variant="severityVariant(dashboard.selected.value.severity)">
              {{ dashboard.selected.value.cvss.toFixed(1) }} CVSS
            </Badge>
            <Badge v-if="dashboard.selected.value.kev" variant="destructive">CISA KEV</Badge>
            <Badge :variant="statusVariant(dashboard.selected.value.status)">{{ dashboard.selected.value.status }}</Badge>
          </div>
          <p class="mt-4 text-body leading-6 text-muted-foreground">{{ dashboard.selected.value.summary }}</p>
        </div>

        <dl class="grid grid-cols-[92px_1fr] gap-x-4 gap-y-3 border-y border-border px-6 py-5 text-body">
          <dt class="text-muted-foreground">受影响范围</dt>
          <dd class="leading-5">{{ dashboard.selected.value.affected }}</dd>
          <dt class="text-muted-foreground">利用成熟度</dt>
          <dd>{{ dashboard.selected.value.maturity }}</dd>
          <dt class="text-muted-foreground">参考链接</dt>
          <dd class="flex flex-wrap gap-2">
            <Button
              v-for="reference in dashboard.selected.value.references"
              :key="reference.href"
              as="a"
              :href="reference.href"
              target="_blank"
              rel="noreferrer"
              variant="link"
              size="text"
            >
              {{ reference.label }} <ExternalLink class="size-3" />
            </Button>
          </dd>
        </dl>

        <section class="border-b border-border px-6 py-5">
          <h3 class="text-label font-medium">受影响资产（{{ dashboard.selected.value.assets.length }}）</h3>
          <div class="mt-3 overflow-hidden rounded-lg border border-border">
            <div
              v-for="asset in dashboard.selected.value.assets"
              :key="asset.id"
              class="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
            >
              <Server class="size-4 text-muted-foreground" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-body font-medium">{{ asset.name }}</span>
                <span class="mt-1 block font-mono text-caption text-muted-foreground">{{ asset.address }} · {{ asset.environment }}</span>
              </span>
              <Badge variant="outline">{{ asset.status }}</Badge>
            </div>
          </div>
        </section>

        <section class="px-6 py-5">
          <Button
            block
            @click="dashboard.establishResearchTask(dashboard.selected.value.id)"
          >
            <ShieldCheck
              v-if="dashboard.researchTasks.value.includes(dashboard.selected.value.id)"
              class="size-4"
            />
            <Workflow v-else class="size-4" />
            {{ dashboard.researchTasks.value.includes(dashboard.selected.value.id) ? '研究任务已建立' : '建立研究任务' }}
          </Button>
          <Button
            variant="ghost"
            block
            class="mt-2"
            @click="dashboard.advanceStatus(dashboard.selected.value.id)"
          >
            推进研究状态
          </Button>
          <p class="mt-3 text-center text-caption leading-5 text-muted-foreground">
            建立任务后固化情报快照、受影响资产与证据边界。
          </p>
        </section>
      </aside>
    </div>
  </main>
</template>
