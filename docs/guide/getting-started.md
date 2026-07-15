# 快速开始

## 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)（用于 Tauri 后端）
- 任一受支持供应商的 API 密钥

## 安装

```bash
git clone https://github.com/MilkSU-Official/milksu.git
cd milksu
npm install

# 安装 Tauri 应用依赖
cd app
npm install
```

## 开发

### 纯浏览器预览（无代理桥接）

```bash
cd app
npm run dev
```

启动 Vite 开发服务器，使用 localStorage 模拟 Tauri IPC。适合在不运行完整代理栈的情况下进行 UI 开发。

### 完整 Tauri 开发

```bash
cd app
npx tauri dev
```

启动 Vite + Rust 热重载。桥接进程会连接到 Pi 代理运行时。

### 构建检查

```bash
cd app
npm run build   # TypeScript + Vite 构建
npm run lint    # ESLint
```

### 生产构建

```bash
cd app
npx tauri build
```

## 配置

### API 密钥

在设置页面（侧边栏齿轮图标）中设置 API 密钥。密钥本地存储于：

```
~/Library/Application Support/com.milksu.app/settings.json
```

密钥通过环境变量传递给桥接进程，不会被传输到其他任何地方。

### 支持的供应商

| 供应商 | 环境变量 | 默认模型 |
|--------|---------|----------|
| DeepSeek（默认） | `DEEPSEEK_API_KEY` | deepseek-chat |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 |
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Google Gemini | `GEMINI_API_KEY` | gemini-2.5-flash |
| Groq | `GROQ_API_KEY` | llama-3.3-70b-versatile |

### 中继模式

在设置中启用中继模式，可将所有请求通过 OpenAI 兼容的中继服务路由。启用后将使用统一的中继凭据覆盖各供应商的 API 密钥。

## 文档

```bash
# 启动文档开发服务器
npm run docs:dev

# 构建生产版文档
npm run docs:build
```
