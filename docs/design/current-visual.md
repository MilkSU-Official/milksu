# 当前视觉约定

> 状态：Current
>
> 关联：[#15](https://github.com/MilkSU-Official/milksu/issues/15) · [PR 18](https://github.com/MilkSU-Official/milksu/pull/18)
>
> 生产页按这里换视觉。旧「战术档案 / 酸绿」稿、`design-qa.md` 和 `docs/design/game-ui/` 已删除，Git 历史可考古，不得再当实现约束。

## 层级

- **视觉**：ak-ui 0.2.1 的 token 和场景 CSS。材质是石墨指挥面、纸面事实、青、金。酸绿不进产品。
- **行为**：Felinic Vue 组件留下（按钮、输入、对话框、下拉、HoverCard、设置行）。换视觉，不是换组件运行时。

## 约定

- 青 = 当前模块 / 主操作。金 = 次级强调 / 当前焦点条。成功绿只表示成功。蓝色只表示链接和明确的执行 / 诊断状态。
- 夜间用中性石墨，不要明显的蓝、绿、棕偏色；日间用纸面中性色。
- CTF、CVE、实验室、Coding 用同一套石墨 + 青。不要用 `--info`、蓝边或蓝底去区分这些模块。
- 美学校准用谷歌 Material 的读法，不搬 Material 组件：层级先于装饰；颜色是关系；一屏一个焦点。
- 一级模块轨 `4.75rem` 图标栏。Coding 会话列表贴在同一条导航上。
- 不用纸纹、碳纹、官方 Showcase 的角色图 / 理智条 / 3D 菜单。
- 命令面（侧栏、会话历史、设置分类、右栏、输入框和菜单）走当前主题 token；事实面（题面、Agent 气泡、通知）走纸面。日间不要再把指挥面钉成夜间石墨。
- 功能、Desktop RPC、Judge、授权、Pi 工具循环不因换皮改语义。
- CSS 钉在 `app/src/styles/`，不把 `@yunyoujun/ak-ui` 写进 `app/package.json`。
