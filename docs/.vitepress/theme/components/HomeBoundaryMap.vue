<script setup lang="ts">
const layers = [
  {
    id: 'L1',
    name: 'Product Surface',
    description: 'Vue + Memoh UI · CTF / CVE / Coding',
    references: 'macOS Wails 桌面产品；Labs 当前不作为可用入口',
  },
  {
    id: 'L2',
    name: 'Workspace / Role',
    description: 'CTF · Coding · Vulnerability Research',
    references: 'CTF 窄路径已验；Coding 核心已验；CVE/Labs 暂停',
  },
  {
    id: 'L3',
    name: 'Agent + Adapters',
    description: 'Pi · NSSCTF · CTFshow · Browser Bridge · NYU Eval',
    references: '普通 Coding 与 CTF 使用不同资源和权限策略',
  },
  {
    id: 'L4',
    name: 'Shared Security Runtime',
    description: 'Environment / Evidence / Effect / Evaluator / Trace / Recovery',
    references: 'Event Store · Artifact · Judge · Projection · Memory',
    verified: true,
  },
  {
    id: 'L5',
    name: 'Local Foundation',
    description: 'Wails Host · Pi Sidecar · SQLite · Workspace',
    references: 'Provider Key 只注入所需进程；数据保存在用户目录',
  },
  {
    id: 'L6',
    name: 'Agent Integrity · 横切',
    description: 'Scope / Provenance / Sandbox / Credential / Supply Chain',
    references: '参考 Agentic Radar；不冒充安全任务 Role',
  },
]

const roles = [
  { name: 'CTF', projects: '真实 NSSCTF → Pi → Judge → Debrief', relation: 'Verified narrow / Active' },
  { name: 'Coding', projects: 'Plan/Go · Pi Resources · 项目交付', relation: 'Verified core / Active' },
  { name: 'NYU Eval', projects: 'Safe-static one-shot + Digest Judge', relation: 'Developer-only / Verified narrow' },
  { name: 'Foundation', projects: 'UI · Markdown · Migration · Release', relation: 'Active' },
  { name: 'Labs', projects: 'Juice Shop · WebGoat · Vulhub', relation: 'Designed / Paused' },
  { name: 'CVE', projects: '情报 · 资产 · Evidence · Disclosure', relation: 'Designed / Paused' },
]
</script>

<template>
  <div class="boundary-shell">
    <main class="boundary-canvas">
      <header class="boundary-intro">
        <div>
          <h1>MilkSU：授权安全学习与研究工作台</h1>
          <p>R0.4 当前聚焦 CTF 真实闭环、Coding 日常交付和内部模型评测；Labs/CVE 已设计但暂停。</p>
        </div>
        <a class="deep-link" href="/developer/document-status">当前任务与状态 <span>→</span></a>
      </header>

      <div class="boundary-board">
        <div class="boundary-left">
          <figure class="quadrant-figure" aria-labelledby="quadrant-title">
            <figcaption id="quadrant-title" class="boundary-sr-only">Agent Security 与 Agent for Security 四象限</figcaption>
            <div class="quadrant-wrap">
              <span class="axis-y">Agent 自身安全要求</span>
              <span class="axis-y-arrow" aria-hidden="true">↑</span>
              <div class="quadrant-grid">
                <div class="quadrant agent-security">
                  <strong>Agent Security</strong>
                  <span>浏览 · 邮件 · 代码</span>
                  <small>外部内容不可信</small>
                </div>
                <div class="quadrant both-security">
                  <strong>两者都需要</strong>
                  <span>蓝队日志 · 恶意样本</span>
                  <small>高风险生产任务</small>
                </div>
                <div class="quadrant general-task">
                  <strong>通用任务</strong>
                  <span>架构 · 开发 · 测试</span>
                  <small>普通工具与内容</small>
                </div>
                <div class="quadrant security-task">
                  <strong>Agent for Security</strong>
                  <span>CTF · 漏洞研究</span>
                  <small>隔离环境也能成立</small>
                </div>
              </div>
              <span class="axis-x">安全任务属性 <b aria-hidden="true">→</b></span>
            </div>
          </figure>

          <figure class="sets-figure" aria-labelledby="sets-title">
            <figcaption id="sets-title" class="boundary-sr-only">通用 Agent 可完成情况集合与安全任务角色集</figcaption>
            <div class="set-diagram" role="img" aria-label="通用 Agent 可完成情况集合与安全任务角色集重叠；共享代码、搜索、推理和工具调用，安全任务还需要环境、证据、副作用、判分和恢复">
              <div class="set-circle general-set">
                <strong>通用 Agent<br>可完成情况集合</strong>
                <span>开发 · 测试<br>自动化 · 通用工具</span>
              </div>
              <div class="set-overlap">
                <b>共享能力</b>
                <span>代码 · 搜索</span>
                <span>推理 · 工具调用</span>
              </div>
              <div class="set-circle security-set">
                <strong>安全任务角色集</strong>
                <span>Environment<br>Evidence · Effect<br>Evaluator · Recovery</span>
              </div>
            </div>
            <div class="agent-contrast">
              <p>
                <strong>Coding Agent</strong>
                <span class="agent-flow">Understand → Plan → Edit → Test → Review</span>
                <small>围绕 repository、diff 与 tests 收敛</small>
              </p>
              <p>
                <strong>Security Agent</strong>
                <span class="agent-flow">Scope → Environment → Hypothesis → Action</span>
                <span class="agent-flow">Evidence / Effect → Evaluator → Outcome / Recovery</span>
                <small>围绕授权、真实世界状态与外部判分收敛</small>
              </p>
            </div>
            <p class="dual-outcome">共同学习：安全 Outcome + 人类学习 Outcome</p>
          </figure>
        </div>

        <section class="architecture-figure" aria-labelledby="architecture-title">
          <h2 id="architecture-title" class="boundary-sr-only">MilkSU 当前六层边界与工作流状态</h2>
          <p class="architecture-note">Current、Designed 与 Paused 严格分开</p>

          <div class="architecture-body">
            <ol class="layer-stack">
              <li
                v-for="layer in layers"
                :key="layer.id"
                class="layer-row"
                :class="{ 'is-verified': layer.verified, 'is-role': layer.id === 'L2' }"
              >
                <div class="layer-label">
                  <b>{{ layer.id }}</b>
                  <strong>{{ layer.name }}</strong>
                </div>
                <p>{{ layer.description }}</p>
                <small>{{ layer.references }}</small>
              </li>
            </ol>

            <div class="role-map">
              <h3>Workstream → Status</h3>
              <div class="role-list">
                <div v-for="role in roles" :key="role.name" class="role-row">
                  <strong>{{ role.name }}</strong>
                  <p>{{ role.projects }}</p>
                  <small>{{ role.relation }}</small>
                </div>
              </div>
              <div class="relation-legend" aria-label="任务状态图例">
                <span><i class="dot adapter"></i>Verified</span>
                <span><i class="dot worker"></i>Active</span>
                <span><i class="dot learn"></i>Designed</span>
                <span><i class="dot benchmark"></i>Paused</span>
              </div>
            </div>
          </div>

          <footer class="architecture-footer">
            <p><b>Role</b> 定义怎样算赢</p>
            <p><b>Capability</b> 提供工具箱</p>
            <p><b>Runtime</b> 保存事实并独立判分</p>
            <p><b>Engine</b> 可改造替换，不从零重写通用 Loop</p>
          </footer>
        </section>
      </div>
    </main>
  </div>
</template>
