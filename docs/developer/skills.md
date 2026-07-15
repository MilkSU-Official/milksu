# 技能系统

## 概述

技能 (Skills) 是可插拔的能力模块，通过领域特定的工具和上下文扩展 Pi 代理。每个技能是一个遵循标准结构的目录。

## 技能结构

```
skills/
  my-skill/
    SKILL.md          # Declaration (required)
    tools/            # Tool definitions (required)
      my-tool.ts
    knowledge/        # Domain knowledge (optional)
      reference.md
    prompts/          # Workflow prompts (optional)
      workflow.md
```

### SKILL.md

YAML 前置元数据 (frontmatter) 声明元信息；正文为代理提供上下文:

```markdown
---
name: network-recon
description: Network reconnaissance and scanning tools
triggerKeywords:
  - nmap
  - scan
  - network
  - recon
  - port
---

# Network Reconnaissance

You have access to network scanning tools for:
- Port scanning with nmap
- Service detection
- Target management
```

### 工具定义

工具使用 Pi 的 `defineTool()` 配合 TypeBox 参数模式 (Schema):

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default defineTool({
  name: "nmap_scan",
  description: "Run an nmap scan against a target",
  parameters: Type.Object({
    target: Type.String({ description: "Target IP or hostname" }),
    ports: Type.Optional(Type.String({ description: "Port range (e.g., 1-1000)" })),
    flags: Type.Optional(Type.Array(Type.String())),
  }),
  async execute(_toolCallId, params) {
    // Tool implementation
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: { ports: openPorts, services: detectedServices },
    };
  },
});
```

## 内置技能

| 技能 | 工具数 | 工具列表 | 用途 |
|------|--------|----------|------|
| hello-world | 1 | milksu_greet | 演示/模板 |
| browser-connect | 12 | browser_analyze, browser_connect, browser_list_tabs, browser_switch_tab, browser_click, browser_evaluate, browser_type, browser_intercept, browser_network, browser_get_page, browser_navigate, browser_screenshot | 渗透测试用浏览器自动化 |
| network-recon | 3 | nmap_scan, recon_report, target_manage | 网络扫描 |
| panel | 1 | panel_update | 任务面板状态变更 |
| subagent | 1 | spawn_subagents | 子代理生成 |

## 加载流水线

```
Tauri spawns: node --experimental-strip-types bridge.js
  -> bridge.js imports src/skill-loader.ts (type stripping)
  -> discoverSkills() scans skills/ for SKILL.md
  -> Parses YAML frontmatter (name, description, triggerKeywords)
  -> Discovers .ts files in tools/ subdirectories
  -> Dynamic-imports tool definitions (absolute paths required)
  -> Tools cached in memory (cachedSkillTools)
  -> On createSession(): tools injected via session._customTools.push()
  -> session._refreshToolRegistry() makes tools available to LLM
  -> Agent sees all 18 tools in its tool list
```

### 为什么用手动注入

Pi 的 `DefaultResourceLoader` 通过 `resolveProjectTrust` 和 `packageManager.resolve()` 发现扩展。在 MilkSU 的运行环境下这个机制失效 (`getExtensions()` 返回空数组)。

手动注入方案 (`_customTools.push` + `_refreshToolRegistry`) 已验证有效，且语义上等价 -- 工具注册后 LLM 能正常调用，工具执行返回结果。

### 绝对路径要求

`discoverSkills()` 必须接收绝对路径。相对路径如 `skills/panel/tools/update.ts` 会被 Node 的 ESM resolver 误判为 bare specifier (包名)，导致 `ERR_MODULE_NOT_FOUND`。

## 工具结果双通道

每个工具返回两个信息通道:

- **content**: 供 LLM 推理使用的文本 (代理读取此通道)
- **details**: 供 UI 渲染使用的结构化数据 (前端渲染此通道)

```typescript
return {
  content: [{ type: "text", text: "Found 3 open ports" }],
  details: { ports: [22, 80, 443], scan_type: "tcp" },
};
```

这种分离使同一个工具调用既能服务于代理的决策过程，又能服务于用户的视觉反馈。

## 创建新技能

1. 在 `skills/` 下创建目录
2. 编写包含 YAML 前置元数据的 `SKILL.md`
3. 在 `tools/` 中添加工具定义 (使用 `defineTool()` + TypeBox)
4. 重启桥接进程即可加载 (无需重新编译)
5. 验证: 检查 `skills_loaded` 事件中的工具计数
