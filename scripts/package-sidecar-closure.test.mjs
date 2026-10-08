import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  bundleChatBridge,
  bundleHarnessAdapter,
  collectInstalledPackageClosure,
  copyDshRuntime,
  currentPlatform,
  dshRuntimeRootPackages,
  pruneForeignPlatformPackages,
  pruneNodePtyForeignArtifacts,
  resolvePhotonRuntime,
} from './package-sidecar.mjs'

async function createPackageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'milksu-package-fixture-'))
  return { root, packageRoot: join(root, 'node_modules') }
}

async function writeFixturePackage(packageRoot, name, document, files = {}) {
  const directory = join(packageRoot, ...name.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(document)}\n`)
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(directory, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  return directory
}

// Placeholder Photon metadata on purpose, distinct from whatever production
// ships: the assertions below can only pass when resolvePhotonRuntime reads
// the installed package.json, and the oversized module keeps the minimum
// size expectation for a shippable Photon artifact pinned.
const photonFixtureVersion = '0.0.0-fixture.0'
const photonFixtureLicense = 'Fixture-License-1.0'
const photonFixtureWasmBytes = 1_100_000

async function writePhotonFixture(packageRoot) {
  await writeFixturePackage(packageRoot, '@earendil-works/pi-coding-agent', {
    name: '@earendil-works/pi-coding-agent',
    version: '1.0.0',
  })
  const wasm = Buffer.alloc(photonFixtureWasmBytes)
  Buffer.from([0x00, 0x61, 0x73, 0x6d]).copy(wasm)
  await writeFixturePackage(packageRoot, '@silvia-odwyer/photon-node', {
    name: '@silvia-odwyer/photon-node',
    version: photonFixtureVersion,
    license: photonFixtureLicense,
  }, {
    'photon_rs_bg.wasm': wasm,
    'LICENSE.md': 'Apache License',
  })
}

async function writeDshFixture(packageRoot) {
  for (const name of dshRuntimeRootPackages) {
    const document = {
      name,
      version: '0.2.0-rc.2',
      license: 'MIT',
      type: 'module',
    }
    if (name === '@deepseek-ai/dsh') {
      document.dependencies = { '@deepseek-ai/dsh-app-boot': '0.2.0-rc.2' }
    }
    await writeFixturePackage(packageRoot, name, document, {
      ...(name === '@deepseek-ai/dsh' ? {
        // Mirror the real CLI entry just enough to keep the smoke honest:
        // the packaged bin imports app-boot, and app-boot pulls in its
        // required peer chain, so a closure that drops a peer still fails
        // the isolated spawn with ERR_MODULE_NOT_FOUND (the 26.912.3
        // accident) instead of exiting cleanly.
        'lib/bin.js': "import '@deepseek-ai/dsh-app-boot'\nprocess.exit(0)\n",
        LICENSE: 'MIT License',
      } : {}),
    })
  }
  await writeFixturePackage(packageRoot, '@deepseek-ai/dsh-app-boot', {
    name: '@deepseek-ai/dsh-app-boot',
    version: '0.2.0-rc.2',
    license: 'MIT',
    type: 'module',
    exports: './index.mjs',
    // Fabricated peer metadata, decoupled from the real dsh-app-boot
    // manifest: upstream peer changes will not show up in this fixture.
    // copyDshRuntime pins dshVersion against the installed production
    // package, which partially mitigates that drift.
    peerDependencies: {
      '@deepseek-ai/cordis-plugin-group': '^1.0.2',
      '@deepseek-ai/optional-peer-fixture': '^1.0.0',
    },
    peerDependenciesMeta: {
      '@deepseek-ai/optional-peer-fixture': { optional: true },
    },
  }, {
    'index.mjs': "import '@deepseek-ai/cordis-plugin-group'\nexport const fixture = true\n",
  })
  await writeFixturePackage(packageRoot, '@deepseek-ai/cordis-plugin-group', {
    name: '@deepseek-ai/cordis-plugin-group',
    version: '1.0.2',
    license: 'MIT',
    type: 'module',
  }, { 'index.js': 'export const fixture = true\n' })
  await writeFixturePackage(packageRoot, '@deepseek-ai/optional-peer-fixture', {
    name: '@deepseek-ai/optional-peer-fixture',
    version: '1.0.0',
    license: 'MIT',
  })
}

function esbuildPlatformPackage(platform) {
  const [goos, goarch] = platform.split('/')
  const os = goos === 'windows' ? 'win32' : goos
  const cpu = goarch === 'amd64' ? 'x64' : goarch
  return `@esbuild/${os}-${cpu}`
}

test('Pi inline image processing keeps a shippable Photon runtime', async () => {
  const fixture = await createPackageFixture()
  try {
    await writePhotonFixture(fixture.packageRoot)
    const photon = await resolvePhotonRuntime({ packageRoot: fixture.packageRoot })
    // The fixture metadata is a placeholder (see writePhotonFixture), so
    // matching it proves the resolver read the installed package.json
    // instead of returning whatever production happens to ship.
    assert.equal(photon.version, photonFixtureVersion)
    assert.equal(photon.licenseName, photonFixtureLicense)
    const wasm = await readFile(photon.wasm)
    assert.ok(wasm.byteLength > 1_000_000, `unexpected Photon module size: ${wasm.byteLength}`)
    assert.ok(
      wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])),
      'Photon module must start with the WebAssembly magic bytes',
    )
    assert.ok((await readFile(photon.license)).byteLength > 0, 'Photon license must ship with it')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('DSH packaged closure includes required app-boot peers', async () => {
  const fixture = await createPackageFixture()
  try {
    await writeDshFixture(fixture.packageRoot)
    const dependenciesOnly = await collectInstalledPackageClosure(['@deepseek-ai/dsh'], {
      packageRoot: fixture.packageRoot,
    })
    assert.equal(
      dependenciesOnly.some(pkg => pkg.name === '@deepseek-ai/cordis-plugin-group'),
      false,
      'dependency-only closure must not hide the missing peer that shipped in 26.912.3',
    )

    const packages = await collectInstalledPackageClosure(dshRuntimeRootPackages, {
      includePeerDependencies: true,
      packageRoot: fixture.packageRoot,
    })
    for (const name of dshRuntimeRootPackages) {
      assert.ok(
        packages.some(pkg => pkg.name === name),
        `${name} must stay in the runtime closure`,
      )
    }
    assert.ok(
      packages.some(pkg => pkg.name === '@deepseek-ai/cordis-plugin-group'),
      'required peer @deepseek-ai/cordis-plugin-group must be copied into the Sidecar',
    )
    assert.ok(
      packages.some(pkg => pkg.name === '@deepseek-ai/optional-peer-fixture'),
      'installed optional peers must stay in the runtime closure',
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

// pi-durable Harness 地基（PR-2 批次 A）的打包闭环断言：适配层 bundle 必须真的内联
// pi-durable 1.0.0 的代码（不是只在 package.json 里挂个依赖），node:sqlite 保持外部内建
// 引用，且仓库把版本精确钉死（不用 ^，PREP §5.1 的缓解措施）。
test('harness adapter bundle inlines pi-durable exactly at the pinned version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-harness-adapter-bundle-'))
  try {
    const outfile = join(root, 'harness-adapter.cjs')
    await bundleHarnessAdapter(outfile)
    const bundle = await readFile(outfile, 'utf8')
    assert.ok(bundle.length > 100_000, `unexpected adapter bundle size: ${bundle.length}`)
    // pi-durable 标志性代码片段（dist 1.0.0）：内建 inbox 文档 kind、interrupted 错误文案。
    assert.ok(bundle.includes('"pi.inbox"'), 'bundle must inline pi-durable InboxDoc')
    assert.ok(
      bundle.includes('was interrupted and may have partially run'),
      'bundle must inline the pi-durable interrupted tool result',
    )
    // 适配层自身的别名登记文档 kind。
    assert.ok(bundle.includes('milksu.conversation-index'), 'bundle must inline the adapter alias doc')
    // node:sqlite 是内建模块：esbuild 保持外部引用，运行时由打包 Node 24 提供。
    assert.ok(/require\(["']node:sqlite["']\)/.test(bundle), 'node:sqlite must stay an external builtin require')

    // 钉版检查：package.json 精确 1.0.0（不带 ^），锁文件里已安装同一版本。
    const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const document = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
    assert.equal(
      document.dependencies['@earendil-works/pi-durable'],
      '1.0.0',
      'pi-durable must be pinned exactly (no ^) per PREP §5.1',
    )
    const installed = JSON.parse(await readFile(
      join(repositoryRoot, 'node_modules', '@earendil-works', 'pi-durable', 'package.json'),
      'utf8',
    ))
    assert.equal(installed.version, '1.0.0')
    // 安装树里 typebox 1.3.27（pi-durable 的精确依赖）以嵌套副本存在，不影响根部 1.1.38。
    const nestedTypebox = await stat(join(
      repositoryRoot, 'node_modules', '@earendil-works', 'pi-durable', 'node_modules', 'typebox', 'package.json',
    ))
    assert.ok(nestedTypebox.isFile(), 'pi-durable keeps its exact nested typebox 1.3.27')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// PR-2 批次 B1：主 bridge bundle 必须真的带上 Harness 运行核心接线（门 + 会话层 +
// beforeTool 审批链 + pi-durable 本体），而不是只在源码里 import 了却没进分发物。
test('chat bridge bundle inlines the batch B1 harness wiring', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-chat-bridge-bundle-'))
  try {
    const outfile = join(root, 'chat-bridge.cjs')
    await bundleChatBridge(outfile)
    const bundle = await readFile(outfile, 'utf8')
    // 门：MILKSU_PI_HARNESS 常量 + 分叉。
    assert.ok(bundle.includes('MILKSU_PI_HARNESS'), 'gate env name must ship')
    assert.ok(bundle.includes('harnessTurnRouted'), 'routing forks must ship')
    // 适配层与 pi-durable 本体（同批次 A 的内联标志）。
    assert.ok(bundle.includes('milksu.conversation-index'), 'adapter alias doc must ship')
    assert.ok(
      bundle.includes('was interrupted and may have partially run'),
      'pi-durable ToolTask must be inlined',
    )
    // 审批链移植（beforeTool 钩子）与压缩接线（pi.compaction 任务）。
    assert.ok(bundle.includes('beforeTool'), 'beforeTool hook wiring must ship')
    assert.ok(bundle.includes('pi.compaction'), 'compaction task must be inlined')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// PR-2 批次 B2：工具面挂载（coding 工具适配 + LSP 薄壳 + 技能目录 + hang-guard
// afterTool）与遗留接线（decision_query 门开分支、reasoning-only recovery）必须真的
// 进 bundle：pi-durable 的 defineTool/section 不外部化，reviewed-ts 的 pi-lsp 核心
// 同样内联（bridge.js → harness-bridge-session → harness-bridge-tools 的静态链）。
test('chat bridge bundle inlines the batch B2 tool-surface wiring', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-chat-bridge-b2-bundle-'))
  try {
    const outfile = join(root, 'chat-bridge.cjs')
    await bundleChatBridge(outfile)
    const bundle = await readFile(outfile, 'utf8')
    // 工具面扩展名（registry.install 的挂载目标）。
    assert.ok(bundle.includes('milksu-coding-tools'), 'coding tools extension must ship')
    assert.ok(bundle.includes('milksu-lsp'), 'LSP extension must ship')
    assert.ok(bundle.includes('milksu-skills'), 'skills extension must ship')
    // B2 撤掉裸 CodingTools：bundle 里不再出现 pi-durable tools 聚合扩展的安装。
    assert.ok(!bundle.includes('pi-durable-coding-tools'), 'the scaffold must be gone')
    // LSP 受审链 + pi-lsp 可分离核心（reviewed-ts 内联标志）。
    assert.ok(bundle.includes('lsp_fix'), 'the reviewed LSP fix tool must ship')
    assert.ok(bundle.includes('MilkSU could not inspect the LSP fix preview'),
      'the reviewed chain must ship')
    assert.ok(bundle.includes('source.fixAll'), 'the pi-lsp core must be inlined')
    // hang-guard 结果面 + 技能目录渲染（pi-coding-agent 的 skills 渲染器内联）。
    assert.ok(bundle.includes('exceeded its'), 'hang-guard diagnostics must ship')
    assert.ok(bundle.includes('<available_skills>'), 'the skills catalog renderer must ship')
    // 遗留接线：decision_query 门开分支 + reasoning-only recovery。
    assert.ok(bundle.includes('decisionQuery'), 'decision_query wiring must ship')
    assert.ok(bundle.includes('milksu-reasoning-only-recovery') || bundle.includes('reasoningOnlyRecoveryPrompt'),
      'the reasoning-only recovery must ship')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// PR-2 批次 B2c：日常 UX 与产品面板面挂载（ask/progress/web/workspace/
// imagegen/archify/capa）必须真的进 bundle：新扩展名、各工具的门关定义/执行串（薄壳与复用构造器）、动态安全挂载与事件契约字段全部内联。
test('chat bridge bundle inlines the batch B2c daily tool surfaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-chat-bridge-b2c-bundle-'))
  try {
    const outfile = join(root, 'chat-bridge.cjs')
    await bundleChatBridge(outfile)
    const bundle = await readFile(outfile, 'utf8')
    // 扩展名（registry.install 的挂载目标；安全面是动态原位替换）。
    assert.ok(bundle.includes('milksu-daily-tools'), 'the daily tools extension must ship')
    assert.ok(bundle.includes('milksu-security-tools'), 'the security tools extension must ship')
    // ask/progress 薄壳的门关定义串。
    assert.ok(bundle.includes('Show a tappable choice card with 2-6 options'),
      'the ask card description must ship')
    assert.ok(bundle.includes('milksu_ask needs at least two options'),
      'the ask validation must ship')
    assert.ok(bundle.includes('Publish or update a short execution plan'),
      'the progress description must ship')
    assert.ok(bundle.includes('MilkSU progress accepts at most one in-progress step'),
      'the progress validation must ship')
    // web 研究：门关工厂（Jina 转发/解析）原样内联。
    assert.ok(bundle.includes('lite.duckduckgo.com'), 'the web search backend must ship')
    assert.ok(bundle.includes('Search the web for information'),
      'the web prompt snippet must ship')
    // workspace 面板：真 broker 的事件契约串。
    assert.ok(bundle.includes('Coding workspace action timed out'),
      'the workspace action broker must ship')
    assert.ok(bundle.includes('Deep Research uses only the typed Research Browser source action'),
      'the research browser isolation must ship')
    // imagegen：回执 schema 与逐次审批面。
    assert.ok(bundle.includes('milksu-imagegen-receipt/v1'), 'the imagegen receipt must ship')
    assert.ok(bundle.includes('MilkSU user denied this ImageGen request'),
      'the imagegen approval block must ship')
    // archify：沙箱内执行的门关错误串。
    assert.ok(bundle.includes('MilkSU packaged Archify resource is unavailable'),
      'the archify resource gate must ship')
    // capa：按会话解析与挂载面。
    assert.ok(bundle.includes('MilkSU capa is not configured'),
      'the capa per-session resolution must ship')
    assert.ok(bundle.includes('capa analysis exceeded 120 seconds'),
      'the capa sandbox runner must ship')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// PR-2 批次 C1：子代理·协作工具路（milksu-subagents：builtin 角色 = 任务拥有的会
// 话 + 外部 CLI 外部进程 + worktree 消费面）必须真的进 bundle：扩展名、公共底座
// 的所有权索引/requestId 幂等串、角色广告目录、外部 CLI 守卫（preflight/allowlist/
// 进程组终止）与审判链挂接面全部内联。
test('chat bridge bundle inlines the batch C1 subagent tool surface', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-chat-bridge-c1-bundle-'))
  try {
    const outfile = join(root, 'chat-bridge.cjs')
    await bundleChatBridge(outfile)
    const bundle = await readFile(outfile, 'utf8')
    // 子代理扩展（registry.install 的挂载目标；审批/校验挂上即生效）。
    assert.ok(bundle.includes('milksu-subagents'), 'the subagents extension must ship')
    // 公共底座：所有权索引 get-or-create + requestId 幂等（README 范例同款）。
    assert.ok(bundle.includes('subagent:'), 'the idempotent requestId prefix must ship')
    assert.ok(bundle.includes('ownerTaskId'), 'the ownership index scan must ship')
    // 角色广告目录（门关 advertised_subagents 段的形状）。
    assert.ok(
      bundle.includes('The following file-defined subagents opted into discovery'),
      'the advertised agent catalog must ship',
    )
    // 钉包角色定义根守卫（configureSubagentRuntime 的同款布局解析）。
    assert.ok(
      bundle.includes('MilkSU subagent package is unavailable'),
      'the bundled agent root guard must ship',
    )
    // 外部 CLI 守卫面：preflight 解析/校验、环境 allowlist、进程组终止与超时语义。
    assert.ok(
      bundle.includes('External CLI binary'),
      'the external CLI preflight resolver must ship',
    )
    assert.ok(
      bundle.includes('help does not document required option'),
      'the external CLI preflight validation must ship',
    )
    assert.ok(bundle.includes('CLAUDE_CODE_ENV_ALLOWLIST') || bundle.includes('CLAUDE_CONFIG_DIR'),
      'the external CLI env allowlists must ship')
    assert.ok(bundle.includes('Subagent timed out.'), 'the external CLI timeout must ship')
    assert.ok(bundle.includes('Subagent stopped by user.'), 'the stop semantics must ship')
    // 控制动作面与 C2 通告。
    assert.ok(bundle.includes('Subagent catalog:'), 'the catalog action must ship')
    assert.ok(
      bundle.includes('does not carry the pi-subagents'),
      'the deferred async-lane notice must ship',
    )
    // 子代理任务投影（渲染器不改：roster/child 会话登记 + destroy halt）。
    assert.ok(bundle.includes('Harness subagent children:'), 'the children list must ship')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// PR-2 批次 C2：子代理·异步路面（milksu-subagents-async：background anchor 任务
// 拥有的 child 会话 + spawn/status/steer/stop 四件 + 完成通知回投）必须真的进
// bundle：扩展名、anchor 任务 kind、工具名、requestId 幂等前缀、通知文案头、
// background 边界与 abortTask 收场面全部内联。
test('chat bridge bundle inlines the batch C2 async subagent surface', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-chat-bridge-c2-bundle-'))
  try {
    const outfile = join(root, 'chat-bridge.cjs')
    await bundleChatBridge(outfile)
    const bundle = await readFile(outfile, 'utf8')
    // 异步路面扩展（registry.install 的挂载目标；anchor 任务定义随扩展注册）。
    assert.ok(bundle.includes('milksu-subagents-async'), 'the async subagents extension must ship')
    // anchor 任务 kind（scanTasks 按 kind 过滤的 durable 真相面）。
    assert.ok(bundle.includes('milksu-subagent-anchor'), 'the anchor task kind must ship')
    // 四件工具名。
    for (const name of ['subagent_async', 'subagent_async_status', 'subagent_async_steer', 'subagent_async_stop']) {
      assert.ok(bundle.includes(`"${name}"`), `the ${name} tool must ship`)
    }
    // requestId 幂等前缀（child 提交/完成通知/steer 投递）。
    assert.ok(bundle.includes('subagent-async:'), 'the idempotent child requestId prefix must ship')
    assert.ok(bundle.includes('subagent-async-notify:'), 'the idempotent notification requestId prefix must ship')
    // 收据与完成通知的文案面（门关 formatAsyncStartedMessage/notify.js 的同形回投；
    // 通知头是模板串，钉住前缀与收据指引的稳定字面量）。
    assert.ok(bundle.includes('Background task '), 'the completion notification header prefix must ship')
    assert.ok(bundle.includes('The async run is detached'), 'the async receipt guidance must ship')
    // background anchor 边界 + stop/destroy 的 abortTask 收场面。
    assert.ok(bundle.includes('background: true'), 'the background anchor boundary must ship')
    assert.ok(bundle.includes('abortTask'), 'the stop/abort surface must ship')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// PR-2 批次 B2b：MCP 挂载（单 mcp 代理工具 + SDK 连接管理）与 Pi 默认系统提示段
// 必须真的进 bundle：@modelcontextprotocol/client 无 externals 全量内联
//（bridge.js → harness-bridge-session → harness-bridge-mcp / harness-bridge-tools
// 的静态链），漏斗契约（namespaceProxyTools/auto 章）的挂载侧门禁同链在内。
test('chat bridge bundle inlines the batch B2b MCP mount and prompt sections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-chat-bridge-b2b-bundle-'))
  try {
    const outfile = join(root, 'chat-bridge.cjs')
    await bundleChatBridge(outfile)
    const bundle = await readFile(outfile, 'utf8')
    // MCP 挂载扩展 + 单代理工具面。
    assert.ok(bundle.includes('milksu-mcp'), 'the MCP extension must ship')
    assert.ok(bundle.includes('MCP gateway'), 'the mcp proxy tool description must ship')
    assert.ok(bundle.includes('namespaceProxyTools'), 'the #220 funnel guard must ship')
    // 协议协商（versionNegotiation auto → SDK Client）与传输构造器全量内联。
    assert.ok(bundle.includes('versionNegotiation'), 'auto protocol negotiation must ship')
    assert.ok(bundle.includes('StdioClientTransport'), 'the stdio transport must be inlined')
    assert.ok(
      bundle.includes('StreamableHTTPClientTransport') || bundle.includes('StreamableHTTP'),
      'the HTTP transport must be inlined',
    )
    // 输出护栏（50KB/2000 行契约的 MCP 侧移植）。
    assert.ok(bundle.includes('MCP text output truncated'), 'the output guard must ship')
    // B2b 补齐的 Pi 默认系统提示段。
    assert.ok(bundle.includes('milksu-prompt'), 'the prompt sections extension must ship')
    assert.ok(
      bundle.includes('expert coding assistant operating inside pi'),
      'the Pi default preamble must ship',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Pi closure ships only the target platform esbuild binary', async () => {  const fixture = await createPackageFixture()
  try {
    const platform = currentPlatform()
    const variants = [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'arm64'],
      ['linux', 'x64'],
      ['win32', 'arm64'],
      ['win32', 'x64'],
    ]
    const optionalDependencies = Object.fromEntries(
      variants.map(([os, cpu]) => [`@esbuild/${os}-${cpu}`, '0.28.2']),
    )
    await writeFixturePackage(fixture.packageRoot, '@earendil-works/pi-coding-agent', {
      name: '@earendil-works/pi-coding-agent',
      version: '1.0.0',
      dependencies: { esbuild: '0.28.2' },
    })
    await writeFixturePackage(fixture.packageRoot, 'esbuild', {
      name: 'esbuild',
      version: '0.28.2',
      optionalDependencies,
    })
    for (const [os, cpu] of variants) {
      await writeFixturePackage(fixture.packageRoot, `@esbuild/${os}-${cpu}`, {
        name: `@esbuild/${os}-${cpu}`,
        version: '0.28.2',
        os: [os],
        cpu: [cpu],
      })
    }

    const unfiltered = await collectInstalledPackageClosure(['@earendil-works/pi-coding-agent'], {
      packageRoot: fixture.packageRoot,
    })
    assert.ok(unfiltered.filter(pkg => pkg.name.startsWith('@esbuild/')).length > 1)

    const packages = await collectInstalledPackageClosure(['@earendil-works/pi-coding-agent'], {
      packageRoot: fixture.packageRoot,
      platform,
    })
    const esbuildBinaries = packages.filter(pkg => pkg.name.startsWith('@esbuild/'))
    assert.deepEqual(esbuildBinaries.map(pkg => pkg.name), [esbuildPlatformPackage(platform)])
    assert.ok(packages.some(pkg => pkg.name === 'esbuild'), 'the esbuild driver package must stay')
    assert.ok(
      packages.some(pkg => pkg.name === '@earendil-works/pi-coding-agent'),
      'the Pi runtime itself must stay',
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('node-pty prune keeps only the target prebuild and drops Windows conpty', async () => {
  // node-pty ships every platform's prebuilt binary inside its npm tarball,
  // so no package manager can filter them; packaging must prune after copying.
  const root = await mkdtemp(join(tmpdir(), 'milksu-pty-prune-'))
  try {
    const pty = join(root, 'node_modules', 'node-pty')
    for (const name of ['darwin-arm64', 'linux-x64', 'win32-x64']) {
      await mkdir(join(pty, 'prebuilds', name), { recursive: true })
      await writeFile(join(pty, 'prebuilds', name, 'pty.node'), 'stub')
    }
    await mkdir(join(pty, 'third_party', 'conpty'), { recursive: true })
    await writeFile(join(pty, 'third_party', 'conpty', 'conpty.cc'), 'stub')
    await pruneNodePtyForeignArtifacts(root, 'linux/amd64')
    assert.deepEqual(await readdir(join(pty, 'prebuilds')), ['linux-x64'])
    assert.deepEqual(await readdir(join(pty, 'third_party')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recursive package copies get foreign platform packages pruned', async () => {
  // cp(pkg.source) copies a package's whole nested node_modules, so the
  // closure filter alone cannot keep esbuild's 26 platform binaries out of
  // the Sidecar. The post-copy prune removes any package whose os/cpu fields
  // exclude the target platform, at any nesting depth.
  const root = await mkdtemp(join(tmpdir(), 'milksu-platform-prune-'))
  try {
    const pi = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
    for (const [name, os, cpu] of [
      ['darwin-arm64', 'darwin', 'arm64'],
      ['linux-x64', 'linux', 'x64'],
    ]) {
      const dir = join(pi, 'node_modules', '@esbuild', name)
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: `@esbuild/${name}`, version: '0.28.2', os: [os], cpu: [cpu] }),
      )
    }
    const plain = join(pi, 'node_modules', 'yaml')
    await mkdir(plain, { recursive: true })
    await writeFile(join(plain, 'package.json'), JSON.stringify({ name: 'yaml', version: '2.9.0' }))
    await pruneForeignPlatformPackages(root, 'darwin/arm64')
    assert.deepEqual(
      await readdir(join(pi, 'node_modules', '@esbuild')),
      ['darwin-arm64'],
    )
    assert.ok(await readFile(join(plain, 'package.json')), 'unrestricted packages must stay')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('copied DSH runtime can import app-boot without the repository node_modules', async () => {
  const fixture = await createPackageFixture()
  const output = await mkdtemp(join(tmpdir(), 'milksu-dsh-closure-'))
  try {
    await writeDshFixture(fixture.packageRoot)
    await copyDshRuntime(output, currentPlatform(), { packageRoot: fixture.packageRoot })
    await runIsolatedModuleImport(output, '@deepseek-ai/dsh-app-boot')
    await runIsolatedDshAcp(output)
  } finally {
    await rm(output, { recursive: true, force: true })
    await rm(fixture.root, { recursive: true, force: true })
  }
})

function isolatedDshEnv(output) {
  return {
    HOME: output,
    DSH_HOME: join(output, 'dsh-home'),
    TMPDIR: output,
    PATH: '/usr/bin:/bin',
    NODE_PATH: join(output, 'node_modules'),
  }
}

function runIsolatedModuleImport(output, specifier) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      `import ${JSON.stringify(specifier)}`,
    ], {
      cwd: output,
      env: isolatedDshEnv(output),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`isolated import ${specifier} exited ${code}: ${stderr}`))
    })
  })
}

function runIsolatedDshAcp(output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      join(output, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      '--profile',
      'acp',
    ], {
      cwd: output,
      env: isolatedDshEnv(output),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    const finish = (error) => {
      child.kill('SIGKILL')
      if (error) reject(error)
      else resolve()
    }
    const timeout = setTimeout(() => finish(), 3_000)
    child.on('error', error => {
      clearTimeout(timeout)
      finish(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (/ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/i.test(stderr)) {
        finish(new Error(`isolated DSH ACP is missing a runtime module: ${stderr}`))
        return
      }
      if (code && code !== 0) {
        finish(new Error(`isolated DSH ACP exited ${code}: ${stderr}`))
        return
      }
      finish()
    })
  })
}
