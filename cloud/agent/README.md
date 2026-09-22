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

- 解开 `wrangler.toml` 里 containers / Durable Object / migrations（官方 Sandbox 形状已写好）
- D1 / R2 / `CREDENTIAL_KEK`
- `buf generate`（`buf.yaml` + `buf.gen.yaml`）出 TS / Swift / Kotlin 客户端
- 镜像内钉版 Pi + DSH 闭包（`scripts/cloud-sandbox-bundle.sh`）

SendTurn：无 `Sandbox` 绑定时返回 `failed_precondition`；有绑定时走 `getSandbox(env.Sandbox, sess-*)`。
