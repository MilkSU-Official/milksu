package computercap

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/hostpath"
)

// hyprlandPointer is compositor-native virtual pointer input.
// It must not be implemented with xinput, uinput, or /dev/input.
type hyprlandPointer interface {
	Click(x, y float64, width, height int) error
	Scroll(direction string, amount int) error
	Close() error
}

type hyprlandSession struct {
	lookPath       func(string) (string, error)
	run            func(ctx context.Context, name string, args ...string) ([]byte, error)
	connectPointer func() (hyprlandPointer, error)
	getenv         func(string) string

	hyprctl string
	grim    string
	wtype   string
	pointer hyprlandPointer
	width   int
	height  int
	started bool
}

func newHyprlandSession() (PortalSession, error) {
	return &hyprlandSession{
		lookPath:       exec.LookPath,
		run:            runHyprlandHostCommand,
		connectPointer: connectWaylandVirtualPointer,
		getenv:         os.Getenv,
	}, nil
}

func (session *hyprlandSession) Start(ctx context.Context) error {
	if session.started {
		return nil
	}
	if err := linuxHyprlandToolsReady(session.lookPath); err != nil {
		return err
	}
	hyprctl, err := session.lookPath("hyprctl")
	if err != nil {
		return fmt.Errorf("%s", linuxHyprlandToolsProblem([]string{"hyprctl"}))
	}
	grim, err := session.lookPath("grim")
	if err != nil {
		return fmt.Errorf("%s", linuxHyprlandToolsProblem([]string{"grim"}))
	}
	wtype, err := session.lookPath("wtype")
	if err != nil {
		return fmt.Errorf("%s", linuxHyprlandToolsProblem([]string{"wtype"}))
	}
	session.hyprctl = hyprctl
	session.grim = grim
	session.wtype = wtype
	session.probeMonitorSize(ctx)
	_ = session.notify(ctx, 1, 8000, "MilkSU Computer Use 已开始：截屏、点击和打字会作用于整块 Hyprland 桌面，不是单个窗口，也不是 GNOME Portal。停止后键鼠归你。")
	pointer, err := session.connectPointer()
	if err != nil {
		return fmt.Errorf("无法创建 Hyprland 虚拟指针：%w", err)
	}
	session.pointer = pointer
	session.started = true
	return nil
}

func (session *hyprlandSession) Screenshot(ctx context.Context) ([]byte, int, int, error) {
	if !session.started {
		return nil, 0, 0, fmt.Errorf("Hyprland Computer Use 尚未开始")
	}
	path, err := hyprlandShotPath()
	if err != nil {
		return nil, 0, 0, err
	}
	defer os.Remove(path)
	if _, err := session.run(ctx, session.grim, "-t", "png", path); err != nil {
		return nil, 0, 0, fmt.Errorf("Hyprland 截屏失败：%w", err)
	}
	png, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("读取 Hyprland 截屏：%w", err)
	}
	width, height := pngSize(png)
	if width <= 0 || height <= 0 {
		return nil, 0, 0, fmt.Errorf("Hyprland 截屏为空")
	}
	session.width = width
	session.height = height
	return png, width, height, nil
}

func (session *hyprlandSession) Click(x, y float64) error {
	if session.pointer == nil {
		return fmt.Errorf("Hyprland 虚拟指针不可用")
	}
	width, height := session.extent()
	if err := session.pointer.Click(x, y, width, height); err != nil {
		return err
	}
	if session.hyprctl != "" {
		_ = session.moveVisibleCursor(x, y)
	}
	return nil
}

func (session *hyprlandSession) Type(text string) error {
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("type_text requires text")
	}
	if session.wtype == "" {
		return fmt.Errorf("wtype 不可用")
	}
	_, err := session.run(context.Background(), session.wtype, "--", text)
	if err != nil {
		return fmt.Errorf("Hyprland 打字失败：%w", err)
	}
	return nil
}

func (session *hyprlandSession) Key(name string, modifiers []string) error {
	if session.wtype == "" {
		return fmt.Errorf("wtype 不可用")
	}
	args := make([]string, 0, 2+len(modifiers)*2)
	for _, modifier := range modifiers {
		mapped := wtypeModifier(modifier)
		if mapped == "" {
			continue
		}
		args = append(args, "-M", mapped)
	}
	args = append(args, "-k", wtypeKey(name))
	for i := len(modifiers) - 1; i >= 0; i-- {
		mapped := wtypeModifier(modifiers[i])
		if mapped == "" {
			continue
		}
		args = append(args, "-m", mapped)
	}
	if _, err := session.run(context.Background(), session.wtype, args...); err != nil {
		return fmt.Errorf("Hyprland 按键失败：%w", err)
	}
	return nil
}

func (session *hyprlandSession) Scroll(direction string, amount int) error {
	if session.pointer == nil {
		return fmt.Errorf("Hyprland 虚拟指针不可用")
	}
	return session.pointer.Scroll(direction, amount)
}

func (session *hyprlandSession) Close() error {
	var closeErr error
	if session.pointer != nil {
		closeErr = session.pointer.Close()
		session.pointer = nil
	}
	if session.started && session.hyprctl != "" {
		_ = session.notify(context.Background(), 5, 4000, "MilkSU Computer Use 已停止，键鼠已交还。")
	}
	session.started = false
	return closeErr
}

func (session *hyprlandSession) extent() (int, int) {
	if session.width > 0 && session.height > 0 {
		return session.width, session.height
	}
	return 1920, 1080
}

func (session *hyprlandSession) notify(ctx context.Context, icon, millis int, message string) error {
	if session.hyprctl == "" {
		return nil
	}
	_, err := session.run(
		ctx,
		session.hyprctl,
		"notify",
		fmt.Sprintf("%d", icon),
		fmt.Sprintf("%d", millis),
		"rgb(0891b2)",
		message,
	)
	return err
}

func (session *hyprlandSession) moveVisibleCursor(x, y float64) error {
	_, err := session.run(
		context.Background(),
		session.hyprctl,
		"dispatch",
		"movecursor",
		fmt.Sprintf("%d", int(x+0.5)),
		fmt.Sprintf("%d", int(y+0.5)),
	)
	return err
}

func (session *hyprlandSession) probeMonitorSize(ctx context.Context) {
	if session.hyprctl == "" {
		return
	}
	output, err := session.run(ctx, session.hyprctl, "-j", "monitors")
	if err != nil {
		return
	}
	width, height, ok := parseHyprlandMonitorExtent(output)
	if !ok {
		return
	}
	session.width = width
	session.height = height
}

type hyprlandMonitorJSON struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

func parseHyprlandMonitorExtent(raw []byte) (int, int, bool) {
	var monitors []hyprlandMonitorJSON
	if err := json.Unmarshal(raw, &monitors); err != nil || len(monitors) == 0 {
		return 0, 0, false
	}
	minX, minY := monitors[0].X, monitors[0].Y
	maxX := monitors[0].X + monitors[0].Width
	maxY := monitors[0].Y + monitors[0].Height
	for _, monitor := range monitors[1:] {
		if monitor.X < minX {
			minX = monitor.X
		}
		if monitor.Y < minY {
			minY = monitor.Y
		}
		if monitor.X+monitor.Width > maxX {
			maxX = monitor.X + monitor.Width
		}
		if monitor.Y+monitor.Height > maxY {
			maxY = monitor.Y + monitor.Height
		}
	}
	width := maxX - minX
	height := maxY - minY
	if width <= 0 || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}

func hyprlandShotPath() (string, error) {
	root := hostpath.ComputerUseRuntimeRoot()
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	var raw [8]byte
	_, _ = rand.Read(raw[:])
	return filepath.Join(root, "hypr-shot-"+hex.EncodeToString(raw[:])+".png"), nil
}

func runHyprlandHostCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	if forbiddenHostTool(name) {
		return nil, fmt.Errorf("Hyprland Computer Use 拒绝调用 %s", filepath.Base(name))
	}
	for _, arg := range args {
		if forbiddenHostTool(arg) {
			return nil, fmt.Errorf("Hyprland Computer Use 拒绝调用 %s", filepath.Base(arg))
		}
	}
	command := exec.CommandContext(ctx, name, args...)
	command.Env = os.Environ()
	output, err := command.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if detail == "" {
			return output, err
		}
		return output, fmt.Errorf("%w: %s", err, detail)
	}
	return output, nil
}

func wtypeKey(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "enter", "return":
		return "Return"
	case "tab":
		return "Tab"
	case "escape", "esc":
		return "Escape"
	case "backspace":
		return "BackSpace"
	case "space":
		return "space"
	case "up":
		return "Up"
	case "down":
		return "Down"
	case "left":
		return "Left"
	case "right":
		return "Right"
	case "delete":
		return "Delete"
	default:
		if name == "" {
			return "Return"
		}
		return name
	}
}

func wtypeModifier(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "shift":
		return "shift"
	case "ctrl", "control":
		return "ctrl"
	case "alt", "option":
		return "alt"
	case "cmd", "meta", "super", "win":
		return "win"
	default:
		return ""
	}
}
