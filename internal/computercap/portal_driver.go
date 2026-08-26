package computercap

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
)

type portalCall struct {
	Tool string         `json:"tool"`
	Args map[string]any `json:"args"`
}

type portalReply struct {
	Result map[string]any `json:"result,omitempty"`
	Error  string         `json:"error,omitempty"`
}

func servePortalDriver(ctx context.Context, listener net.Listener, session PortalSession, target Target) error {
	var mu sync.Mutex
	for {
		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				return err
			}
		}
		go func() {
			defer conn.Close()
			reader := bufio.NewScanner(conn)
			reader.Buffer(make([]byte, 0, 64<<10), 8<<20)
			if !reader.Scan() {
				return
			}
			var call portalCall
			if err := json.Unmarshal(reader.Bytes(), &call); err != nil {
				writePortalReply(conn, portalReply{Error: err.Error()})
				return
			}
			mu.Lock()
			result, err := handlePortalTool(ctx, session, target, call.Tool, call.Args)
			mu.Unlock()
			if err != nil {
				writePortalReply(conn, portalReply{Error: err.Error()})
				return
			}
			writePortalReply(conn, portalReply{Result: result})
		}()
	}
}

func writePortalReply(conn net.Conn, reply portalReply) {
	payload, err := json.Marshal(reply)
	if err != nil {
		return
	}
	_, _ = conn.Write(append(payload, '\n'))
}

func handlePortalTool(
	ctx context.Context,
	session PortalSession,
	target Target,
	tool string,
	args map[string]any,
) (map[string]any, error) {
	window := map[string]any{
		"window_id": target.WindowID,
		"pid":       target.PID,
		"title":     target.WindowTitle,
		"app":       target.Name,
	}
	switch tool {
	case "start_session", "end_session":
		return map[string]any{"ok": true}, nil
	case "list_windows":
		return map[string]any{"windows": []any{window}}, nil
	case "get_window_state":
		includeScreenshot, _ := args["include_screenshot"].(bool)
		state := map[string]any{
			"window_id": target.WindowID,
			"pid":       target.PID,
			"title":     target.WindowTitle,
			"elements":  []any{},
			"scope":     "display",
		}
		if includeScreenshot {
			png, width, height, err := session.Screenshot(ctx)
			if err != nil {
				return nil, err
			}
			state["screenshot_png_b64"] = base64.StdEncoding.EncodeToString(png)
			state["screenshot_mime_type"] = "image/png"
			state["width"] = width
			state["height"] = height
		}
		return state, nil
	case "click":
		x, y, err := portalCoordinates(args)
		if err != nil {
			return nil, err
		}
		if err := session.Click(x, y); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "scope": "display"}, nil
	case "type_text":
		text, _ := args["text"].(string)
		if strings.TrimSpace(text) == "" {
			return nil, fmt.Errorf("type_text requires text")
		}
		if err := session.Type(text); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "scope": "display"}, nil
	case "press_key":
		key, _ := args["key"].(string)
		var modifiers []string
		if raw, ok := args["modifiers"].([]any); ok {
			for _, item := range raw {
				if name, ok := item.(string); ok {
					modifiers = append(modifiers, name)
				}
			}
		}
		if err := session.Key(key, modifiers); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "scope": "display"}, nil
	case "scroll":
		direction, _ := args["direction"].(string)
		amount := 1
		switch value := args["amount"].(type) {
		case float64:
			amount = int(value)
		case int:
			amount = value
		}
		if err := session.Scroll(direction, amount); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "scope": "display"}, nil
	default:
		return nil, fmt.Errorf("unsupported portal Computer Use tool %q", tool)
	}
}

func portalCoordinates(args map[string]any) (float64, float64, error) {
	x, okX := jsonNumber(args["x"])
	y, okY := jsonNumber(args["y"])
	if !okX || !okY {
		return 0, 0, fmt.Errorf("Linux Computer Use 需要截屏坐标 x/y，没有窗口内 AX 元素")
	}
	return x, y, nil
}

func jsonNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func pngSize(png []byte) (int, int) {
	if len(png) < 24 {
		return 0, 0
	}
	width := int(png[16])<<24 | int(png[17])<<16 | int(png[18])<<8 | int(png[19])
	height := int(png[20])<<24 | int(png[21])<<16 | int(png[22])<<8 | int(png[23])
	return width, height
}
