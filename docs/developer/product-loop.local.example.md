# 产品回归 · 本地上手手册

这份是模板。复制成旁边的 `product-loop.local.md` 和 `product-loop.local.env` 再填。
那两个文件已 gitignore，不要提交，也不要把 Key 写进本页、回执或聊天。

协调器启动时会读 `product-loop.local.env`。公开字段可以进 `process.env`（已有的不覆盖）。
`TOKENFLUX_API_KEY` / `DEEPSEEK_API_KEY` 只留在脚本内存里，需要时打进设置密码框；
不要写进 `process.env`，也不要随 `desktop:start` 注入 sidecar。
回执只写「读到了哪个变量名」，不写值。

```bash
cp docs/developer/product-loop.local.example.md docs/developer/product-loop.local.md
cp docs/developer/product-loop.local.example.env docs/developer/product-loop.local.env
npm run test:product-loop -- --gui --suite first-use
```

官方 TokenFlux 只许 `https://tokenflux.dev/v1`。禁止 `tokenflux.ai`。

## 你先填这些

在 `product-loop.local.env` 里填：

| 字段 | 用来做什么 |
| --- | --- |
| `TOKENFLUX_API_KEY` / `DEEPSEEK_API_KEY` | 设置里打进密码框；本机已经存过中转站就不用再填。官方 TokenFlux 那把 Key 若被拒绝（401），有 `DEEPSEEK_API_KEY` 就会改走官方 DeepSeek 端点 |
| `CUSTOM_RELAY_BASE_URL` | 自定义中转站端点 |
| `CUSTOM_RELAY_MODELS` | 可以不填。官方 TokenFlux 空着就用目录里的 `deepseek/deepseek-flash`，不用猜前缀。第三方中转站才需要自己写 ID |
| `CUSTOM_RELAY_NAME` | 设置里显示的中转站名字 |
| `ACCOUNT_HAS_QUOTA` | 登录后管理员有没有开账户额度：`yes` / `no` |

不要把 Key 写在本页。用例和顺序在 `scripts/lib/product-loop-catalog.mjs`，怎么跑见 [产品回归循环](product-regression-loop.md)。
