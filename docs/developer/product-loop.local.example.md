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

本页只打勾、记「有/无额度」，**不要把 Key 粘在这里**。

- [ ] `product-loop.local.env` 已填（或本机设置里已经有可用中转站）
- [ ] 账户额度：有 / 无（对照 `ACCOUNT_HAS_QUOTA`）

## 总顺序

先把设置里的两条来源走通，再出设置测别的，最后才回归设置其余项。

1. 填本地 env。
2. **启动 A**（必须先看见登录页）：脚本先清掉其它 MilkSU 窗口，只开这一扇测试窗。GitHub 登录 → 账户模型文件循环 → 设置自定义中转站 → 中转站文件循环。
3. 关掉 A。
4. **启动 B**（再看见登录页）：「暂不登录，使用自己的 API Key」→ 进首页 → 中转站仍可用。
5. 离开设置，按下面「设置以外」往下测。
6. 全部测完，再回归设置页其它项。

账户和中转站两条设置路径都要走到。中转站能发是离开设置的硬门槛（没 Key、也没已存中转站 = FAIL）。账户没额度不算整次失败，但必须在本页记下「无额度」，然后中转站必须过。

## 启动 A

### 0.1 看见登录页

**ID：** `login-gate`

未登录、也没点过「暂不登录」。

**必须看见**

- 标题「登录 MilkSU」
- 「使用 GitHub 登录」
- 「暂不登录，使用自己的 API Key」

**算 FAIL：** 直接进了首页，或窗口已经是已登录壳。本机若已登录，先走产品里的退出登录，确认回到登录页再开始。禁止 Beta。

正式接口：`GetAccountStatus`（`state` 不是 `active`）。「暂不登录」是页面按钮，没有单独 RPC。

### 0.2A GitHub 登录成功

**ID：** `login-github-active`

1. 点「使用 GitHub 登录」（或 `StartAccountLogin`）。
2. 系统浏览器里由你完成授权。脚本只轮询账户状态。
3. 回到**这一扇测试窗**，登录门消失，进到壳里。日常 MilkSU 和残留窗口在开测前会被关掉，`milksu://` 不该进那扇窗。

**必须看见：** `GetAccountStatus.state === active`，已认证。

**算 FAIL：** `invitation_required`、`suspended`、打不开浏览器、一直停在 `authorizing`。

### 1.1 先用账户模型做文件循环

**ID：** `account-model-fileloop`

只在启动 A、已经 `active` 之后跑。出厂默认新对话 kernel（Pi），选账户来源模型。

1. 设置 → 模型 → 「MilkSU 账户」行看得到；有额度则启用。
2. 主页新建对话，审批 `workspace-auto`，独立临时 git 工作区。
3. 列出根目录 → 写 `NOTES.md` → 读回来，回复里引用一行。
4. 等回合结束。测完 `DeleteConversation`。

**能发过**

- 工作区出现 `NOTES.md`，出现文件类工具，回合正常结束。

**发不出（预期，继续 2.1）**

- 设置里账户是「未连接」，或发送后可见失败（额度 / 未开通 / 当前没有可用的账户来源）。
- 在本页和 `ACCOUNT_HAS_QUOTA=no` 记「无额度」。不要假装成功。

**算 FAIL：** 账户其实能发却只聊天没落盘；失败文案不可见就去测别的；回执里出现 Key。

### 2.1 设置自定义中转站

**ID：** `settings-custom-relay`

账户和中转站两条都要走到。没配过就从 `product-loop.local.env` 打进密码框；已经配过只核启用和模型，不要重填 Key。

1. 设置 → 模型 → 模型服务 → 新增自定义中转站。
2. 填 API 端点、名字、模型；Key 打进密码框（`type=password`）。
3. 启用。改完即存。
4. 作曲栏能选到这些模型。

**必须看见：** 该行「已启用」；模型列表在；端点若是官方 TokenFlux 则是 `https://tokenflux.dev/v1`。

**算 FAIL：** Key 出现在回执、日志或截图文件名；存完仍是「未配置」；模型没进选择器；用了 `tokenflux.ai`。

### 2.2 用中转站做同一条文件循环

**ID：** `relay-model-fileloop`

新对话选中转站模型，同样写 `NOTES.md`。账户没额度时这是硬门槛。账户有额度也要跑通这一轮，才能说两条来源都测过。

**算 FAIL：** 中转站没配好就出设置；只回复没落盘；没 Key 也没已存中转站。

## 启动 B

另一次启动，不复用 A 的窗口状态。必须再看见 0.1 登录页。

### 0.2B 暂不登录进首页

**ID：** `login-skip-local`

1. 点「暂不登录，使用自己的 API Key」。
2. 登录门消失，进到主页（Coding 作曲栏）。
3. 账户不是 `active`。设置仍打得开。中转站仍可用（或再走一遍 2.1 已存核对）。

**算 FAIL：** 仍停在登录页；被当成已登录账户；还没配中转站就去发对话。

## 离开设置之后

设置 Key 两条来源走通后，同一独立实例继续往下测，最后才回归设置其余项。

### 主页 Coding

**ID：** `coding-pi` / `coding-dsh` / `session-shell`

1. 新对话 Pi 写 `NOTES.md`。
2. 新对话 DSH 写同一条 `NOTES.md`。
3. 加号打开新会话画布；钉选 / 归档往返；打开右栏和底部终端。

缺可用来源记 FAIL。

### 桌宠

**ID：** `companion-relay` / `companion-skin-import`

真实桌宠回合，把标记转达到指定 Coding 会话。抄本、看板、目标会话都要看到。第三方皮肤用回路自己生成的合同夹具，不要填本机路径。

### 领域工作区

**ID：** `workspace-ctf` / `workspace-cve` / `workspace-lab`

侧栏打开 CTF / CVE / Lab。CTF 看见挑战列表，空库则看见手动「同步」。CVE 看见列表和搜索。Lab 看见题目包分段。

### 桌面执行面

**ID：** `desktop-surface`

有计算器则 Computer Use 观察并写 `SURFACE.md`；否则隔离浏览器读本机标记。不点用户 Chrome。

### 账户与更新

**ID：** `profile` / `update`

用户菜单打开个人资料。侧栏页脚看见版本号；有更新时才出现「更新」，不点安装。

### 设置其余项

**ID：** `settings-locale` / `settings-runtime` / `settings-models`

最后再打开设置：通用「界面语言」、模型「默认运行时」、已启用的中转站行。不重填 Key。

测完 stdout 会打一份从大模块到小模块再到整体的文字报告，并写 `build/test-results/product-loop-report/index.html`（每一项带截图）。

## 正式接口和禁区

- 只走官方 Desktop RPC / 产品按钮：`GetAccountStatus`、`StartAccountLogin`、`LogoutAccount`、`GetSettings`、`SaveSettings`、`SaveConversation`、`SendMessage`、听 `engine-event`。
- 不造测试专用 RPC。不要 Beta。
- 回执：`build/test-results/product-loop.json`。正式报告：`build/test-results/product-loop-report/`。不要提交回执或截图。
