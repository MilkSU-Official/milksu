# MilkSU Cloud Agent（Connect + CF Sandbox）

> 部署在 Cloudflare；与桌面仓库分离，但协议以本目录 `proto/` 为准。
> 设计合同：`docs/developer/cloud-agent.md`。

## 成熟方案来源

- **Connect over HTTP**：Cloudflare Workers Connect/gRPC-web 示例与社区 Workers Connect adapter
- **沙箱**：`@cloudflare/sandbox` / Containers
- **账户鉴权**：复用 `accounts.milksu.org` Bearer（与桌面 `AccountSession` 相同）

## 本地

```bash
cd cloud/agent
npm install
npm test
# npm run dev   # 需要 wrangler 登录与绑定
```

## 还未接线（需 milksu-admin / CF 凭据）

- D1 / R2 / Sandbox Durable Object 绑定
- 用户 Key 的加密落库（`CREDENTIAL_KEK`）
- 生成 `@connectrpc` 客户端给桌面 TS / iOS Swift / Android Kotlin
- 镜像内钉版 Pi + DSH 闭包打包（`scripts/cloud-sandbox-bundle.sh`）
