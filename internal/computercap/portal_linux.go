//go:build linux

package computercap

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"

	"github.com/godbus/dbus/v5"
)

const (
	portalBusName       = "org.freedesktop.portal.Desktop"
	portalObjectPath    = "/org/freedesktop/portal/desktop"
	portalRemoteDesktop = "org.freedesktop.portal.RemoteDesktop"
	portalScreenCast    = "org.freedesktop.portal.ScreenCast"
	portalScreenshot    = "org.freedesktop.portal.Screenshot"
	portalRequestIface  = "org.freedesktop.portal.Request"
	portalSessionIface  = "org.freedesktop.portal.Session"
	deviceKeyboard      = uint32(1)
	devicePointer       = uint32(2)
	linuxButtonLeft     = 272
)

type xdgPortalSession struct {
	mu      sync.Mutex
	conn    *dbus.Conn
	session dbus.ObjectPath
	stream  uint32
}

func newXDGPortalSession() (PortalSession, error) {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return nil, fmt.Errorf("connect session bus for desktop portal: %w", err)
	}
	return &xdgPortalSession{conn: conn}, nil
}

func (session *xdgPortalSession) Start(ctx context.Context) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	if session.session != "" {
		return nil
	}
	if gnomeSessionLocked(session.conn) {
		return fmt.Errorf("GNOME 会话已锁屏，无法弹出桌面共享授权")
	}
	desktop := session.conn.Object(portalBusName, portalObjectPath)
	sessionToken := portalToken()
	create, err := session.portalCall(ctx, desktop, portalRemoteDesktop+".CreateSession", map[string]dbus.Variant{
		"session_handle_token": dbus.MakeVariant(sessionToken),
		"handle_token":         dbus.MakeVariant(portalToken()),
	})
	if err != nil {
		return fmt.Errorf("portal CreateSession: %w", err)
	}
	sessionPath, ok := variantObjectPath(create["session_handle"])
	if !ok {
		return fmt.Errorf("portal CreateSession did not return a session")
	}
	if _, err := session.portalCall(ctx, desktop, portalRemoteDesktop+".SelectDevices", sessionPath, map[string]dbus.Variant{
		"types":        dbus.MakeVariant(deviceKeyboard | devicePointer),
		"persist_mode": dbus.MakeVariant(uint32(1)),
		"handle_token": dbus.MakeVariant(portalToken()),
	}); err != nil {
		return fmt.Errorf("portal SelectDevices: %w", err)
	}
	if _, err := session.portalCall(ctx, desktop, portalScreenCast+".SelectSources", sessionPath, map[string]dbus.Variant{
		"types":        dbus.MakeVariant(uint32(1)),
		"multiple":     dbus.MakeVariant(false),
		"cursor_mode":  dbus.MakeVariant(uint32(2)),
		"handle_token": dbus.MakeVariant(portalToken()),
	}); err != nil {
		return fmt.Errorf("portal SelectSources: %w", err)
	}
	started, err := session.portalCall(ctx, desktop, portalRemoteDesktop+".Start", sessionPath, "", map[string]dbus.Variant{
		"handle_token": dbus.MakeVariant(portalToken()),
	})
	if err != nil {
		return fmt.Errorf("portal Start: %w", err)
	}
	session.session = sessionPath
	session.stream = firstPortalStream(started)
	if session.stream == 0 {
		return fmt.Errorf("桌面共享未包含屏幕，无法按坐标点击或截屏")
	}
	return nil
}

func (session *xdgPortalSession) Screenshot(ctx context.Context) ([]byte, int, int, error) {
	session.mu.Lock()
	defer session.mu.Unlock()
	png, width, height, err := session.screenshotPortalLocked(ctx)
	if err == nil {
		return png, width, height, nil
	}
	if session.stream != 0 {
		if png, width, height, streamErr := session.screenshotStreamLocked(ctx); streamErr == nil {
			return png, width, height, nil
		}
	}
	return nil, 0, 0, err
}

func (session *xdgPortalSession) screenshotPortalLocked(ctx context.Context) ([]byte, int, int, error) {
	desktop := session.conn.Object(portalBusName, portalObjectPath)
	results, err := session.portalCall(ctx, desktop, portalScreenshot+".Screenshot", "", map[string]dbus.Variant{
		"interactive":  dbus.MakeVariant(false),
		"modal":        dbus.MakeVariant(false),
		"handle_token": dbus.MakeVariant(portalToken()),
	})
	if err != nil {
		return nil, 0, 0, fmt.Errorf("portal Screenshot: %w", err)
	}
	uri, _ := results["uri"].Value().(string)
	if uri == "" {
		return nil, 0, 0, fmt.Errorf("portal Screenshot did not return a file")
	}
	parsed, err := url.Parse(uri)
	if err != nil || parsed.Scheme != "file" || parsed.Path == "" {
		return nil, 0, 0, fmt.Errorf("portal Screenshot uri is not a local file")
	}
	png, err := os.ReadFile(parsed.Path)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("read portal screenshot: %w", err)
	}
	_ = os.Remove(parsed.Path)
	width, height := pngSize(png)
	return png, width, height, nil
}

func (session *xdgPortalSession) screenshotStreamLocked(ctx context.Context) ([]byte, int, int, error) {
	gst, err := exec.LookPath("gst-launch-1.0")
	if err != nil {
		return nil, 0, 0, err
	}
	file, err := os.CreateTemp("", "milksu-portal-shot-*.png")
	if err != nil {
		return nil, 0, 0, err
	}
	path := file.Name()
	_ = file.Close()
	defer os.Remove(path)
	command := exec.CommandContext(
		ctx,
		gst,
		"-q",
		"pipewiresrc",
		"path="+strconv.FormatUint(uint64(session.stream), 10),
		"num-buffers=1",
		"!",
		"videoconvert",
		"!",
		"pngenc",
		"!",
		"filesink",
		"location="+path,
	)
	if output, err := command.CombinedOutput(); err != nil {
		return nil, 0, 0, fmt.Errorf("capture shared screen: %w: %s", err, strings.TrimSpace(string(output)))
	}
	png, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, 0, err
	}
	width, height := pngSize(png)
	if width <= 0 || height <= 0 {
		return nil, 0, 0, fmt.Errorf("shared screen capture was empty")
	}
	return png, width, height, nil
}

func (session *xdgPortalSession) Click(x, y float64) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	if err := session.pointerMoveLocked(x, y); err != nil {
		return err
	}
	if err := session.notify("NotifyPointerButton", linuxButtonLeft, uint32(1)); err != nil {
		return err
	}
	return session.notify("NotifyPointerButton", linuxButtonLeft, uint32(0))
}

func (session *xdgPortalSession) Type(text string) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	for _, runeValue := range text {
		keysym, ok := runeKeysym(runeValue)
		if !ok {
			continue
		}
		if err := session.keysymLocked(keysym); err != nil {
			return err
		}
	}
	return nil
}

func (session *xdgPortalSession) Key(name string, modifiers []string) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	for _, modifier := range modifiers {
		if err := session.notify("NotifyKeyboardKeysym", modifierKeysym(modifier), uint32(1)); err != nil {
			return err
		}
	}
	if err := session.keysymLocked(namedKeysym(name)); err != nil {
		return err
	}
	for i := len(modifiers) - 1; i >= 0; i-- {
		if err := session.notify("NotifyKeyboardKeysym", modifierKeysym(modifiers[i]), uint32(0)); err != nil {
			return err
		}
	}
	return nil
}

func (session *xdgPortalSession) Scroll(direction string, amount int) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	if amount < 1 {
		amount = 1
	}
	steps := amount
	axis := uint32(0)
	switch strings.ToLower(direction) {
	case "up":
		steps = -amount
	case "down":
		steps = amount
	case "left":
		axis = 1
		steps = -amount
	case "right":
		axis = 1
		steps = amount
	}
	return session.notify("NotifyPointerAxisDiscrete", axis, steps)
}

func (session *xdgPortalSession) Close() error {
	session.mu.Lock()
	defer session.mu.Unlock()
	if session.session != "" {
		_ = session.conn.Object(portalBusName, session.session).Call(portalSessionIface+".Close", 0).Err
		session.session = ""
	}
	if session.conn != nil {
		return session.conn.Close()
	}
	return nil
}

func (session *xdgPortalSession) pointerMoveLocked(x, y float64) error {
	return session.conn.Object(portalBusName, portalObjectPath).Call(
		portalRemoteDesktop+".NotifyPointerMotionAbsolute",
		0,
		session.session,
		map[string]dbus.Variant{},
		session.stream,
		x,
		y,
	).Err
}

func (session *xdgPortalSession) keysymLocked(keysym int32) error {
	if err := session.notify("NotifyKeyboardKeysym", keysym, uint32(1)); err != nil {
		return err
	}
	return session.notify("NotifyKeyboardKeysym", keysym, uint32(0))
}

func (session *xdgPortalSession) notify(method string, args ...any) error {
	values := append([]any{session.session, map[string]dbus.Variant{}}, args...)
	return session.conn.Object(portalBusName, portalObjectPath).Call(
		portalRemoteDesktop+"."+method,
		0,
		values...,
	).Err
}

func (session *xdgPortalSession) portalCall(
	ctx context.Context,
	desktop dbus.BusObject,
	method string,
	args ...any,
) (map[string]dbus.Variant, error) {
	unique := strings.TrimPrefix(session.conn.Names()[0], ":")
	unique = strings.ReplaceAll(unique, ".", "_")
	var handleToken string
	if len(args) > 0 {
		if options, ok := args[len(args)-1].(map[string]dbus.Variant); ok {
			handleToken, _ = options["handle_token"].Value().(string)
		}
	}
	requestPath := dbus.ObjectPath("/org/freedesktop/portal/desktop/request/" + unique + "/" + handleToken)
	match := []dbus.MatchOption{
		dbus.WithMatchObjectPath(requestPath),
		dbus.WithMatchInterface(portalRequestIface),
		dbus.WithMatchMember("Response"),
	}
	if err := session.conn.AddMatchSignal(match...); err != nil {
		return nil, err
	}
	defer func() { _ = session.conn.RemoveMatchSignal(match...) }()
	signals := make(chan *dbus.Signal, 8)
	session.conn.Signal(signals)
	defer session.conn.RemoveSignal(signals)
	var requestPathOut dbus.ObjectPath
	if err := desktop.Call(method, 0, args...).Store(&requestPathOut); err != nil {
		return nil, err
	}
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case signal := <-signals:
			if signal == nil || signal.Path != requestPathOut && signal.Path != requestPath {
				continue
			}
			if signal.Name != portalRequestIface+".Response" {
				continue
			}
			var response uint32
			var results map[string]dbus.Variant
			if err := dbus.Store(signal.Body, &response, &results); err != nil {
				return nil, err
			}
			if response != 0 {
				return nil, portalResponseError(response)
			}
			return results, nil
		}
	}
}

func gnomeSessionLocked(conn *dbus.Conn) bool {
	if conn == nil {
		return false
	}
	var active bool
	err := conn.Object("org.gnome.ScreenSaver", "/org/gnome/ScreenSaver").
		Call("org.gnome.ScreenSaver.GetActive", 0).
		Store(&active)
	return err == nil && active
}

func portalResponseError(response uint32) error {
	switch response {
	case 1:
		return fmt.Errorf("用户取消了桌面共享授权")
	case 2:
		return fmt.Errorf("系统拒绝了桌面共享（会话可能已锁屏）")
	default:
		return fmt.Errorf("desktop portal request failed (%d)", response)
	}
}

func variantObjectPath(value dbus.Variant) (dbus.ObjectPath, bool) {
	switch typed := value.Value().(type) {
	case dbus.ObjectPath:
		return typed, typed != ""
	case string:
		return dbus.ObjectPath(typed), typed != ""
	default:
		return "", false
	}
}

func firstPortalStream(results map[string]dbus.Variant) uint32 {
	raw, ok := results["streams"]
	if !ok {
		return 0
	}
	switch streams := unwrapPortalValue(raw.Value()).(type) {
	case [][]any:
		if len(streams) > 0 && len(streams[0]) > 0 {
			return uintFromPortal(streams[0][0])
		}
	case []any:
		if len(streams) == 0 {
			return 0
		}
		return streamEntryID(streams[0])
	}
	return 0
}

func streamEntryID(entry any) uint32 {
	switch typed := unwrapPortalValue(entry).(type) {
	case []any:
		if len(typed) > 0 {
			return uintFromPortal(typed[0])
		}
	default:
		return uintFromPortal(typed)
	}
	return 0
}

func unwrapPortalValue(value any) any {
	if variant, ok := value.(dbus.Variant); ok {
		return variant.Value()
	}
	return value
}

func uintFromPortal(value any) uint32 {
	switch typed := value.(type) {
	case uint32:
		return typed
	case int32:
		return uint32(typed)
	case uint:
		return uint32(typed)
	case int:
		return uint32(typed)
	default:
		return 0
	}
}

func portalToken() string {
	var raw [8]byte
	_, _ = rand.Read(raw[:])
	return "m" + hex.EncodeToString(raw[:])
}

func runeKeysym(value rune) (int32, bool) {
	if value == '\n' || value == '\r' {
		return 0xff0d, true
	}
	if value == '\t' {
		return 0xff09, true
	}
	if value >= 0x20 && value <= 0x7e {
		return int32(value), true
	}
	return 0, false
}

func namedKeysym(name string) int32 {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "enter", "return":
		return 0xff0d
	case "tab":
		return 0xff09
	case "escape", "esc":
		return 0xff1b
	case "backspace":
		return 0xff08
	case "space":
		return 0x0020
	case "up":
		return 0xff52
	case "down":
		return 0xff54
	case "left":
		return 0xff51
	case "right":
		return 0xff53
	case "delete":
		return 0xffff
	default:
		if len(name) == 1 {
			if keysym, ok := runeKeysym(rune(name[0])); ok {
				return keysym
			}
		}
		return 0xff0d
	}
}

func modifierKeysym(name string) int32 {
	switch strings.ToLower(name) {
	case "shift":
		return 0xffe1
	case "ctrl", "control":
		return 0xffe3
	case "alt", "option":
		return 0xffe9
	case "cmd", "meta":
		return 0xffe7
	default:
		return 0
	}
}
