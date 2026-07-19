<script setup lang="ts">
const layers = [
  {
    id: 'L1',
    name: 'Surface',
    description: 'Desktop / CLI / API',
    references: '参考 PentAGI、Agentic SOC 的运行与案件视图',
  },
  {
    id: 'L2',
    name: 'Role Packages',
    description: 'Red / Blue / CTF / AppSec / Malware / Vuln',
    references: '目标、长期状态、Evidence 与 Evaluator',
  },
  {
    id: 'L3',
    name: 'Capability Packages',
    description: 'Source / Web / Net / Binary / Mobile / Forensics / Fuzz',
    references: '接入 CodeQL、Burp、Ghidra、HexStrike MCP',
  },
  {
    id: 'L4',
    name: 'Shared Security Runtime',
    description: 'Environment / Evidence / Effect / Evaluator / Trace / Recovery',
    references: '学习 BoxPwnr、PentAGI、Taskflow、Shannon',
    verified: true,
  },
  {
    id: 'L5',
    name: 'Workers',
    description: 'Codex / Claude Code / Pi / External Security Agents',
    references: '通用能力可替换；完整安全产品可外部委派',
  },
  {
    id: 'L6',
    name: 'Agent Integrity · 横切',
    description: 'Scope / Provenance / Sandbox / Credential / Supply Chain',
    references: '参考 Agentic Radar；不冒充安全任务 Role',
  },
]

const roles = [
  { name: 'Red', projects: 'CAI · PentAGI · Strix · ARTEMIS', relation: '外部 Worker / 学习' },
  { name: 'Blue', projects: 'Agentic SOC', relation: '学习 Case / Evidence' },
  { name: 'CTF', projects: 'BoxPwnr · CAI', relation: 'Benchmark / 学习' },
  { name: 'AppSec', projects: 'Shannon · Taskflow + CodeQL', relation: '外部 Worker / 接入' },
  { name: 'Vuln', projects: 'ARTEMIS · Taskflow + CodeQL', relation: 'Benchmark / 接入' },
  { name: 'Malware', projects: '暂无完整 Role 样本', relation: '保留调研空白' },
]
</script>

<template>
  <div class="boundary-shell">
    <main class="boundary-canvas">
      <header class="boundary-intro">
        <div>
          <h1>安全 Agent 与通用 Agent 的能力边界</h1>
          <p>首页总地图：先分清两种安全，再决定角色、能力与可替换的 Worker。</p>
        </div>
        <a class="deep-link" href="/developer/security-agent-boundary">阅读完整论证 <span>→</span></a>
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
          <h2 id="architecture-title" class="boundary-sr-only">MilkSU 六层、六角色与开源项目坐标</h2>
          <p class="architecture-note">项目是候选关系，不是默认依赖</p>

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
              <h3>Role → 开源项目</h3>
              <div class="role-list">
                <div v-for="role in roles" :key="role.name" class="role-row">
                  <strong>{{ role.name }}</strong>
                  <p>{{ role.projects }}</p>
                  <small>{{ role.relation }}</small>
                </div>
              </div>
              <div class="relation-legend" aria-label="项目关系图例">
                <span><i class="dot adapter"></i>接入</span>
                <span><i class="dot worker"></i>外部 Worker</span>
                <span><i class="dot learn"></i>学习</span>
                <span><i class="dot benchmark"></i>Benchmark</span>
              </div>
            </div>
          </div>

          <footer class="architecture-footer">
            <p><b>Role</b> 定义怎样算赢</p>
            <p><b>Capability</b> 提供工具箱</p>
            <p><b>Runtime</b> 保存事实并独立判分</p>
            <p><b>Worker</b> 随 SOTA 替换</p>
          </footer>
        </section>
      </div>
    </main>
  </div>
</template>
