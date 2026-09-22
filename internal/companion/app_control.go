package companion

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/config"
)

const maxExcerptMessages = 8
const maxExcerptRunes = 400

type ConversationExcerpt struct {
	ID        string           `json:"id"`
	Title     string           `json:"title"`
	Messages  []ExcerptMessage `json:"messages"`
	Truncated bool             `json:"truncated,omitempty"`
}

type ExcerptMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type AppOutcome struct {
	OK                bool                 `json:"ok"`
	NeedsConfirmation bool                 `json:"needsConfirmation,omitempty"`
	Summary           string               `json:"summary,omitempty"`
	Error             string               `json:"error,omitempty"`
	Settings          map[string]any       `json:"settings,omitempty"`
	Excerpt           *ConversationExcerpt `json:"excerpt,omitempty"`
	Then              string               `json:"-"`
}

type AppControl interface {
	OpenMainWindow() error
	FocusConversation(id string) error
	ReadConversation(id string, limit int) (ConversationExcerpt, error)
	CurrentSettings() (config.AppSettings, error)
	SaveSettings(config.AppSettings) error
	Quit() error
	Relaunch() error
}

func HandleApp(control AppControl, input map[string]any) (AppOutcome, error) {
	if control == nil {
		return AppOutcome{}, fmt.Errorf("companion app control is not configured")
	}
	action := strings.TrimSpace(stringValue(input["action"]))
	confirmed := boolValue(input["confirmed"])
	switch action {
	case "open_main_window":
		if err := control.OpenMainWindow(); err != nil {
			return AppOutcome{Error: err.Error()}, nil
		}
		return AppOutcome{OK: true, Summary: "main window opened"}, nil
	case "focus_conversation":
		id := strings.TrimSpace(stringValue(input["conversationId"]))
		if id == "" {
			return AppOutcome{Error: "focus_conversation requires conversationId"}, nil
		}
		if err := control.FocusConversation(id); err != nil {
			return AppOutcome{Error: err.Error()}, nil
		}
		return AppOutcome{OK: true, Summary: id}, nil
	case "read_conversation":
		id := strings.TrimSpace(stringValue(input["conversationId"]))
		if id == "" {
			return AppOutcome{Error: "read_conversation requires conversationId"}, nil
		}
		limit := intValue(input["limit"])
		if limit <= 0 || limit > maxExcerptMessages {
			limit = maxExcerptMessages
		}
		excerpt, err := control.ReadConversation(id, limit)
		if err != nil {
			return AppOutcome{Error: err.Error()}, nil
		}
		return AppOutcome{OK: true, Excerpt: &excerpt}, nil
	case "get_settings":
		current, err := control.CurrentSettings()
		if err != nil {
			return AppOutcome{Error: err.Error()}, nil
		}
		return AppOutcome{OK: true, Settings: ProjectSettings(current)}, nil
	case "patch_settings":
		patch, _ := input["patch"].(map[string]any)
		if len(patch) == 0 {
			return AppOutcome{Error: "patch_settings requires patch"}, nil
		}
		current, err := control.CurrentSettings()
		if err != nil {
			return AppOutcome{Error: err.Error()}, nil
		}
		next, keys, err := ApplySettingsPatch(current, patch)
		if err != nil {
			return AppOutcome{Error: err.Error()}, nil
		}
		if !confirmed {
			return AppOutcome{
				NeedsConfirmation: true,
				Summary:           strings.Join(keys, ", "),
			}, nil
		}
		if err := control.SaveSettings(next); err != nil {
			return AppOutcome{Error: err.Error()}, nil
		}
		return AppOutcome{OK: true, Summary: strings.Join(keys, ", "), Settings: ProjectSettings(next)}, nil
	case "quit":
		if !confirmed {
			return AppOutcome{NeedsConfirmation: true, Summary: "quit"}, nil
		}
		return AppOutcome{OK: true, Summary: "quit", Then: "quit"}, nil
	case "relaunch":
		if !confirmed {
			return AppOutcome{NeedsConfirmation: true, Summary: "relaunch"}, nil
		}
		return AppOutcome{OK: true, Summary: "relaunch", Then: "relaunch"}, nil
	default:
		return AppOutcome{}, fmt.Errorf("unknown companion_app action %q", action)
	}
}

func (outcome AppOutcome) RunAfter(control AppControl) {
	if control == nil || outcome.Then == "" {
		return
	}
	switch outcome.Then {
	case "quit":
		_ = control.Quit()
	case "relaunch":
		_ = control.Relaunch()
	}
}

func ProjectSettings(settings config.AppSettings) map[string]any {
	view := map[string]any{
		"active_provider":            settings.ActiveProvider,
		"active_model":               settings.ActiveModel,
		"default_kernel":             settings.DefaultKernel,
		"busy_send":                  settings.BusySend,
		"locale":                     stringPtr(settings.Locale),
		"worker_provider":            settings.WorkerProvider,
		"worker_model":               settings.WorkerModel,
		"worker_source":              settings.WorkerSource,
		"companion_provider":         settings.CompanionProvider,
		"companion_model":            settings.CompanionModel,
		"companion_source":           settings.CompanionSource,
		"companion_dispatch_enabled": boolPtr(settings.CompanionDispatchEnabled, true),
		"companion_memory_enabled":   boolPtr(settings.CompanionMemoryEnabled, true),
		"companion_float_enabled":    boolPtr(settings.CompanionFloatEnabled, true),
		"companion_skin_id":          settings.CompanionSkinID,
		"companion_teaching":         settings.CompanionTeaching,
		"companion_reply_style":      config.CompanionReplyStyle(settings),
		"preferred_external_editor":  settings.PreferredExternalEditor,
		"ui_font":                    settings.UiFont,
		"conversation_font":          settings.ConversationFont,
		"ui_font_size":               settings.UiFontSize,
		"conversation_font_size":     settings.ConversationFontSize,
		"ui_emphasis":                settings.UiEmphasis,
	}
	providers := map[string]any{}
	for name, provider := range settings.Providers {
		providers[name] = map[string]any{
			"enabled":     provider.Enabled,
			"has_api_key": provider.HasAPIKey || strings.TrimSpace(provider.APIKey) != "",
			"name":        provider.Name,
			"custom":      provider.Custom,
		}
	}
	view["providers"] = providers
	if settings.Relay != nil {
		view["relay"] = map[string]any{
			"enabled": settings.Relay.Enabled,
			"url":     settings.Relay.URL,
			"has_key": settings.Relay.HasKey || strings.TrimSpace(settings.Relay.Key) != "",
		}
	}
	return view
}

func ApplySettingsPatch(current config.AppSettings, patch map[string]any) (config.AppSettings, []string, error) {
	next := current
	keys := make([]string, 0, len(patch))
	for key, value := range patch {
		name := strings.TrimSpace(key)
		if credentialSetting(name) {
			return current, nil, fmt.Errorf("companion cannot change credentials")
		}
		switch name {
		case "active_provider":
			next.ActiveProvider = strings.TrimSpace(stringValue(value))
		case "active_model":
			next.ActiveModel = strings.TrimSpace(stringValue(value))
		case "default_kernel":
			next.DefaultKernel = strings.TrimSpace(stringValue(value))
		case "busy_send":
			next.BusySend = strings.TrimSpace(stringValue(value))
		case "locale":
			locale := strings.TrimSpace(stringValue(value))
			next.Locale = &locale
		case "worker_provider":
			next.WorkerProvider = strings.TrimSpace(stringValue(value))
		case "worker_model":
			next.WorkerModel = strings.TrimSpace(stringValue(value))
		case "worker_source":
			next.WorkerSource = strings.TrimSpace(stringValue(value))
		case "companion_provider":
			next.CompanionProvider = strings.TrimSpace(stringValue(value))
		case "companion_model":
			next.CompanionModel = strings.TrimSpace(stringValue(value))
		case "companion_source":
			next.CompanionSource = strings.TrimSpace(stringValue(value))
		case "companion_dispatch_enabled":
			enabled, err := requiredBool(value)
			if err != nil {
				return current, nil, fmt.Errorf("companion_dispatch_enabled: %w", err)
			}
			next.CompanionDispatchEnabled = &enabled
		case "companion_memory_enabled":
			enabled, err := requiredBool(value)
			if err != nil {
				return current, nil, fmt.Errorf("companion_memory_enabled: %w", err)
			}
			next.CompanionMemoryEnabled = &enabled
		case "companion_float_enabled":
			enabled, err := requiredBool(value)
			if err != nil {
				return current, nil, fmt.Errorf("companion_float_enabled: %w", err)
			}
			next.CompanionFloatEnabled = &enabled
		case "companion_skin_id":
			next.CompanionSkinID = strings.TrimSpace(stringValue(value))
		case "companion_teaching":
			next.CompanionTeaching = strings.TrimSpace(stringValue(value))
		case "companion_reply_style":
			next.CompanionReplyStyle = config.NormalizeCompanionReplyStyle(stringValue(value))
		case "preferred_external_editor":
			next.PreferredExternalEditor = strings.TrimSpace(stringValue(value))
		case "ui_font":
			next.UiFont = strings.TrimSpace(stringValue(value))
		case "conversation_font":
			next.ConversationFont = strings.TrimSpace(stringValue(value))
		case "ui_font_size":
			next.UiFontSize = strings.TrimSpace(stringValue(value))
		case "conversation_font_size":
			next.ConversationFontSize = strings.TrimSpace(stringValue(value))
		case "ui_emphasis":
			next.UiEmphasis = strings.TrimSpace(stringValue(value))
		default:
			return current, nil, fmt.Errorf("companion cannot change setting %q", name)
		}
		keys = append(keys, name)
	}
	if len(keys) == 0 {
		return current, nil, fmt.Errorf("patch_settings requires patch")
	}
	return next, keys, nil
}

func credentialSetting(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "providers", "relay", "nssctf_arena", "api_key", "key", "token", "password", "secret":
		return true
	default:
		folded := strings.ToLower(name)
		return strings.Contains(folded, "api_key") ||
			strings.Contains(folded, "token") ||
			strings.Contains(folded, "secret") ||
			strings.Contains(folded, "password")
	}
}

func requiredBool(value any) (bool, error) {
	typed, ok := value.(bool)
	if !ok {
		return false, fmt.Errorf("expected boolean")
	}
	return typed, nil
}

func boolPtr(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func stringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func ExcerptFromMessages(id, title string, roles []string, contents []string, limit int) ConversationExcerpt {
	if limit <= 0 || limit > maxExcerptMessages {
		limit = maxExcerptMessages
	}
	type pair struct{ role, text string }
	kept := make([]pair, 0, len(roles))
	truncated := false
	for i := range roles {
		role := strings.TrimSpace(roles[i])
		if role != "user" && role != "assistant" {
			continue
		}
		text := contents[i]
		if utf8.RuneCountInString(text) > maxExcerptRunes {
			runes := []rune(text)
			text = string(runes[:maxExcerptRunes])
			truncated = true
		}
		kept = append(kept, pair{role: role, text: text})
	}
	if len(kept) > limit {
		kept = kept[len(kept)-limit:]
		truncated = true
	}
	messages := make([]ExcerptMessage, 0, len(kept))
	for _, item := range kept {
		messages = append(messages, ExcerptMessage{Role: item.role, Text: item.text})
	}
	return ConversationExcerpt{
		ID:        id,
		Title:     title,
		Messages:  messages,
		Truncated: truncated,
	}
}
