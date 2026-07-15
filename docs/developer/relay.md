# 中继模式

## 目的

中继模式 (Relay Mode) 将所有 LLM 请求通过 OpenAI 兼容的中继服务转发，而非直接调用各供应商的 API。这使得在直接 API 访问受限的地区也能正常使用。

## 工作原理

在设置中启用中继模式后：

1. Rust 将中继配置作为环境变量传递给 bridge.js
2. 桥接层为每个会话注册一个临时的 `milksu-relay` provider
3. 临时 provider 保留用户所选模型 ID，但统一使用 OpenAI Chat Completions 协议
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

中继配置在桥接启动时读取一次。创建会话时，桥接层复制所选模型的上下文窗口等元数据，并把请求端点改为中继 URL：

```javascript
session.modelRegistry.registerProvider("milksu-relay", {
  baseUrl: relayUrl,
  apiKey: relayKey,
  api: "openai-completions",
  models: [relayModel],
});
```

会话随后切换到这个临时 provider：

```javascript
await setSessionModel(conversationId, session, "milksu-relay", selectedModel);
```

这样既避免并发会话修改 `process.env` 的竞态，也避免把 DeepSeek、Anthropic 等模型 ID错误地拿到 OpenAI 内置模型表中查找。

设置保存在应用配置中，但桥接进程只在启动时读取中继密钥和 URL。修改中继设置后需要重启 MilkSU，现有会话才会使用新配置。
