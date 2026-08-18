# 当前视觉约定

关联：[#15](https://github.com/MilkSU-Official/milksu/issues/15) · [PR 18](https://github.com/MilkSU-Official/milksu/pull/18)

研究预览和截图只说明层级、色和栏宽。真产品按钮、菜单、审批、浏览器、终端、筛选会多得多。按场景用 ak-ui 组件，不要临摹研究页。

## 约定

- 材质用 ak-ui：石墨指挥面、纸面事实、青、金。酸绿不进产品。
- 美学校准用谷歌 Material 的读法，不搬 Material 组件：层级先于装饰；颜色是关系；一屏一个焦点。
- 青 = 当前模块 / 主操作。金 = 次级强调。成功绿只表示成功。
- 一级模块轨 `4.75rem` 图标栏。Coding 会话列表贴在同一条导航上，不并排两块指挥台。
- 不用纸纹、碳纹、官方 Showcase 的角色图 / 理智条 / 3D 菜单。
- 功能、Desktop RPC、Judge、授权、Pi 工具循环不因换皮改语义。

## 本 PR

生产壳先改：去酸绿、去纹理、窄轨、顶栏收平。CSS 钉在 `app/src/styles/`，不进 `app/package.json`。不拆光 Felinic，不发版。

下一步：CTF 题库内部（选中题 + 交给 Coding），再 Coding Composer，再设置。
