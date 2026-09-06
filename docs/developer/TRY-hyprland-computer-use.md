# 试跑：Hyprland Computer Use

> 给明早 Omarchy / Hyprland 本机用。这是开发线，**不是** GitHub Latest `v26.905.2`。
> 正式包里 Hyprland 仍 unavailable。必须 checkout 本分支后构建。
>
> 本 Cloud Agent 没有 Omarchy/Hyprland 真机。下面步骤要在真实 Hyprland 会话里做。

独立合同：这条后端不是 GNOME Portal，也不是窗口 Scope。它控制**整块 Hyprland 桌面**。

禁止：`xinput`、uinput、`/dev/input`、Cua Linux 安装脚本。

## 1. 检出本分支

```bash
git fetch origin cursor/hyprland-computer-use-51e1
git checkout cursor/hyprland-computer-use-51e1
```

确认 `git rev-parse --short HEAD` 不是 `b18b860`（那是 `v26.905.2`）。

## 2. 本机依赖

在 **Hyprland 图形会话**里（不要只开 SSH 无 Wayland）：

```bash
echo "$HYPRLAND_INSTANCE_SIGNATURE"
echo "$XDG_CURRENT_DESKTOP"
echo "$WAYLAND_DISPLAY"
command -v hyprctl grim wtype
```

缺 grim / wtype：

```bash
sudo pacman -S grim wtype
```

`hyprctl` 随 Hyprland。不要装 ydotool，不要跑 Cua 官方 installer。

## 3. 构建并启动开发桌面

```bash
npm install
npm --prefix app install
go test ./internal/computercap/
npm run desktop:start
```

已有本机 tarball / 自构建包时，也可以换成该二进制，但必须是本分支打出来的，不能是 `MilkSU-Linux-x64-26.905.2.tar.gz`。

Wayland 下如窗口不出现，等 5 秒；Linux 会补一次 `show()`。

## 4. 确认后端身份

设置 → Computer Use：

- 应看到 **Hyprland 合成器**
- 说明里有「合成器原生输入」「不是 GNOME Portal」「不是单个窗口」
- LIVE
- **不要**出现「GNOME 会弹出授权」或「桌面共享」

缺 grim/wtype 时这里会点名缺包，先回到第 2 步。

## 5. 可见同意 → 截屏 / 点击 / 打字

1. 打开 Coding，打开 Computer Use 面板。
2. 诊断应写：整块桌面、合成器原生、不是 Portal、停止后键鼠归你。
3. 点 **启动可见会话**。没有这步点击，不会创建虚拟指针。
4. 桌面应出现 Hyprland 通知：Computer Use 已开始。
5. 让 Agent 或工具走一遍：截屏 → 坐标点击 → 打字。
6. 点 **停止可见会话**。
7. 桌面通知「键鼠已交还」。鼠标键盘立刻回到你手里。没有残留合成指针。

## 6. 失败时看什么

| 现象 | 原因 |
| --- | --- |
| 设置仍写 Hyprland 暂不可用 | 跑的是 `v26.905.2` 或未切到本分支 |
| 设置写 GNOME 桌面共享 | 当前会话是 GNOME，不是 Hyprland |
| 缺少 grim / wtype | `pacman -S grim wtype` |
| 无法创建虚拟指针 | 合成器未提供 `zwlr_virtual_pointer`；不会回退 Portal 或 xinput |
| 启动后没有通知 | 仍检查面板文案；通知失败不阻止会话，但应能停止并交还键鼠 |

## 7. 验收勾选（真人）

- [ ] 不是 `v26.905.2` 正式包
- [ ] 设置显示 Hyprland 合成器，不是 Portal
- [ ] 启动前必须点「启动可见会话」，桌面有通知
- [ ] 截屏、坐标点击、打字各一次
- [ ] 停止后键鼠立刻可用，没有 xinput detach
