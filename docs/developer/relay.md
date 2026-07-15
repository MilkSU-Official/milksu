# 中继模式

## 目的

中继模式 (Relay Mode) 将所有 LLM 请求通过 OpenAI 兼容的中继服务转发，而非直接调用各供应商的 API。这使得在直接 API 访问受限的地区也能正常使用。

## 工作原理

在设置中启用中继模式后：

1. Rust 将中继配置作为环境变量传递给 bridge.js
2. 桥接层在启动时（仅一次）设置 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`
3. 所有会话使用 `provider: "openai"`，无论实际选择了哪个供应商
4. 中继服务将请求转发到实际的 LLM 供应商

```
User -> Tauri -> Bridge -> Relay Service -> LLM Provider
                              |
                    OpenAI-compatible API
```

## 配置

在设置 -> 中继中：

| 字段 | 描述 | 默认值 |
|------|------|--------|
| 启用中继 | 全局开关 | 关闭 |
| 中继 API 密钥 | 中继服务的认证密钥 | （无） |
| 中继 URL | OpenAI 兼容的 API 端点 | `https://api.ciyuanliudong.com/v1` |

## 设计决策：与供应商正交

中继模式实现为全局覆盖，而非独立的供应商。这意味着：

- 设置中的供应商卡片保持可见（中继激活时变暗）
- 模型选择器仍然显示特定供应商的模型列表
- 供应商的 API 密钥在中继禁用时作为后备
- 不会用一个"中继供应商"污染供应商列表

## 实现细节

环境变量在桥接启动时设置一次（而非每个会话）：

```javascript
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1";
if (relayEnabled) {
  process.env.OPENAI_API_KEY = process.env.MILKSU_RELAY_KEY;
  process.env.OPENAI_BASE_URL = process.env.MILKSU_RELAY_URL || "https://api.ciyuanliudong.com/v1";
}
```

每个会话创建时检查标志位，无需重新读取环境变量：

```javascript
if (relayEnabled) {
  effectiveProvider = "openai";
}
```

这避免了并发会话修改 `process.env` 时的竞态条件。
