# 当前视觉约定

关联：[#15](https://github.com/MilkSU-Official/milksu/issues/15) · [PR 18](https://github.com/MilkSU-Official/milksu/pull/18)

研究预览已删除。生产页按这个层级换视觉，不要再恢复预览页。

## 层级

- **视觉**：ak-ui 0.2.1 的 token 和场景 CSS。材质是石墨指挥面、纸面事实、青、金。酸绿不进产品。
- **行为**：Felinic Vue 组件留下（按钮、输入、对话框、下拉、HoverCard、设置行）。换视觉，不是换组件运行时。

## 约定

- 青 = 当前模块 / 主操作。金 = 次级强调 / 当前焦点条。成功绿只表示成功。
- 美学校准用谷歌 Material 的读法，不搬 Material 组件：层级先于装饰；颜色是关系；一屏一个焦点。
- 一级模块轨 `4.75rem` 图标栏。Coding 会话列表贴在同一条导航上。
- 不用纸纹、碳纹、官方 Showcase 的角色图 / 理智条 / 3D 菜单。
- 功能、Desktop RPC、Judge、授权、Pi 工具循环不因换皮改语义。
- CSS 钉在 `app/src/styles/`，不进 `app/package.json`。
