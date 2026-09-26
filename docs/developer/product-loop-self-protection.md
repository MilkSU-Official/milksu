# 产品回归循环自我保护机制

## 问题描述

当用户在 MilkSU 内部运行 `verify-product-loop.mjs` 时，脚本会列出所有正在运行的 MilkSU 进程并尝试终止它们，以确保测试环境的独占性。这导致调用该脚本的 MilkSU 实例也被终止，造成软件崩溃。

## 根本原因

`keepExclusiveMilkSUWindow()` 函数会：
1. 列出所有 MilkSU 主进程（packaged-stable、packaged-repo、unpackaged-repo）
2. 关闭所有不在 `keepPids` 中的进程
3. 但原先的实现没有自动识别并保护调用者进程

当脚本从 MilkSU 的 Sidecar 启动时，进程树如下：
```
MilkSU (PID 1000)
  └─ milksu-sidecar/node (PID 1001)
      └─ node scripts/verify-product-loop.mjs (PID 1002)
```

脚本会将 PID 1000 识别为 foreign MilkSU 进程并终止它，导致整个 MilkSU 实例关闭。

## 解决方案

### 1. 新增 `detectCallerMilkSUPid()` 函数

该函数向上遍历进程树，跳过 Sidecar 和 helper 进程，找到第一个真正的 MilkSU 主进程：

```javascript
export function detectCallerMilkSUPid(rows) {
  let currentPid = process.pid
  const visited = new Set()
  const byPid = new Map(rows.map(row => [row.pid, row]))

  while (currentPid > 1 && !visited.has(currentPid)) {
    visited.add(currentPid)
    const row = byPid.get(currentPid)
    if (!row) break

    const cmd = normalizeHostCommand(row.command)

    // 跳过 sidecar node 进程和 helpers
    if (/milksu-sidecar.*node|node.*milksu-sidecar/i.test(cmd) || /Helper|plugin-container/i.test(cmd)) {
      currentPid = row.ppid
      continue
    }

    const kind = classifyMilkSUHostCommand(row.command)
    if (kind === 'packaged-stable' || kind === 'packaged-repo' || kind === 'unpackaged-repo') {
      return currentPid
    }
    currentPid = row.ppid
  }

  return null
}
```

### 2. 修改 `listMilkSUHostProcesses()` 自动保护调用者

在函数开头添加调用者检测：

```javascript
export async function listMilkSUHostProcesses(options = {}) {
  const rows = await listProcessRows().catch(() => [])
  const portPids = await pidsListeningOnPorts(keepPortsFrom(options))

  // 保护启动此脚本的 MilkSU 实例
  const callerPid = detectCallerMilkSUPid(rows)
  if (callerPid && !options.allowSelfTermination) {
    portPids.add(callerPid)
  }

  const keepPids = mergeKeepPids(
    keepPidsFrom(options, rows),
    portPids,
    rows,
    options.repoRoot || repositoryRoot,
  )
  // ...
}
```

### 3. 保留覆盖选项

如果将来需要强制终止调用者（例如在 CI 环境中），可以传入 `allowSelfTermination: true`：

```javascript
await listMilkSUHostProcesses({ allowSelfTermination: true })
```

## 测试验证

运行产品回归测试验证：

```bash
npm run test:product-loop-catalog
```

其中包含 `detectCallerMilkSUPid()` 的进程树单元测试。

## 影响范围

- `scripts/lib/product-loop-windows.mjs`
  - 新增 `detectCallerMilkSUPid()` 函数
  - 修改 `listMilkSUHostProcesses()` 添加自我保护
- 所有调用 `keepExclusiveMilkSUWindow()` 的地方自动受益
- 向后兼容：默认行为是保护调用者，不影响现有测试

## 相关文档

- `docs/developer/product-regression-loop.md` - 产品回归测试文档
- `scripts/verify-product-loop.mjs` - 主测试入口
