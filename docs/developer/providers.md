# 供应商

## 支持的供应商

| 供应商 | 环境变量 | 默认模型 | 备注 |
|--------|----------|----------|------|
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat | 默认供应商，性价比最优 |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 | Claude 系列模型 |
| OpenAI | `OPENAI_API_KEY` | gpt-4o | GPT 系列模型 |
| Google Gemini | `GEMINI_API_KEY` | gemini-2.5-flash | Gemini 系列模型 |
| Groq | `GROQ_API_KEY` | llama-3.3-70b-versatile | 快速推理，开源模型 |

## 供应商选择

聊天输入栏中的模型选择器按供应商分组显示模型。选择一个模型同时也会选择其所属供应商。供应商决定了：

- 调用哪个 API 端点
- 使用哪个认证密钥
- 哪些模型名称有效

## 添加供应商

供应商在 `types.ts` 中以 `PROVIDERS` 常量定义：

```typescript
export const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
  },
  // ...
];
```

添加新供应商的步骤：

1. 在 `types.ts` 的 `PROVIDERS` 数组中添加条目
2. 在 `bridge.js` 的 `createSession()` 中添加对应的环境变量处理
3. 在 `SettingsPage.tsx` 中添加 API 密钥输入字段
4. 在 `i18n/en.json` 和 `i18n/zh.json` 中添加翻译键

## 中继模式

启用中继模式后，所有供应商的请求通过单一的 OpenAI 兼容中继服务转发。中继服务负责认证和向实际供应商转发请求。

实现细节请参见[中继模式](/developer/relay)。
