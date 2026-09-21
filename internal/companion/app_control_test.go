package companion

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

type fakeApp struct {
	opened   int
	focused  []string
	quit     int
	relaunch int
	settings config.AppSettings
	saved    *config.AppSettings
	excerpt  ConversationExcerpt
}

func (f *fakeApp) OpenMainWindow() error {
	f.opened++
	return nil
}

func (f *fakeApp) FocusConversation(id string) error {
	f.focused = append(f.focused, id)
	return nil
}

func (f *fakeApp) ReadConversation(id string, limit int) (ConversationExcerpt, error) {
	excerpt := f.excerpt
	excerpt.ID = id
	if limit < len(excerpt.Messages) {
		excerpt.Messages = excerpt.Messages[len(excerpt.Messages)-limit:]
		excerpt.Truncated = true
	}
	return excerpt, nil
}

func (f *fakeApp) CurrentSettings() (config.AppSettings, error) {
	return f.settings, nil
}

func (f *fakeApp) SaveSettings(next config.AppSettings) error {
	f.saved = &next
	f.settings = next
	return nil
}

func (f *fakeApp) Quit() error {
	f.quit++
	return nil
}

func (f *fakeApp) Relaunch() error {
	f.relaunch++
	return nil
}

func TestCompanionAppProjectsSettingsWithoutSecrets(t *testing.T) {
	key := "sk-test-secret"
	settings := config.AppSettings{
		ActiveModel: "deepseek/deepseek-flash",
		Providers: map[string]config.ProviderConfig{
			"deepseek": {Enabled: true, APIKey: key, HasAPIKey: true, Name: "DeepSeek"},
		},
		Relay: &config.RelayConfig{Enabled: true, URL: "https://tokenflux.dev/v1", Key: key, HasKey: true},
	}
	encoded, err := json.Marshal(ProjectSettings(settings))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), key) {
		t.Fatalf("projection leaked a credential: %s", encoded)
	}
	if !strings.Contains(string(encoded), `"has_api_key":true`) || !strings.Contains(string(encoded), `"has_key":true`) {
		t.Fatalf("projection: %s", encoded)
	}
}

func TestCompanionAppRejectsCredentialPatches(t *testing.T) {
	app := &fakeApp{settings: config.AppSettings{ActiveModel: "keep"}}
	outcome, err := HandleApp(app, map[string]any{
		"action": "patch_settings",
		"patch":  map[string]any{"api_key": "sk-nope"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Error == "" || app.saved != nil {
		t.Fatalf("credential patch: %#v saved=%v", outcome, app.saved)
	}
}

func TestCompanionAppConfirmsSettingsQuitAndRelaunch(t *testing.T) {
	app := &fakeApp{settings: config.AppSettings{ActiveModel: "old"}}
	pending, err := HandleApp(app, map[string]any{
		"action": "patch_settings",
		"patch":  map[string]any{"active_model": "new"},
	})
	if err != nil || !pending.NeedsConfirmation || app.saved != nil {
		t.Fatalf("unconfirmed patch: %#v err=%v", pending, err)
	}
	applied, err := HandleApp(app, map[string]any{
		"action":    "patch_settings",
		"confirmed": true,
		"patch":     map[string]any{"active_model": "new"},
	})
	if err != nil || !applied.OK || app.saved == nil || app.saved.ActiveModel != "new" {
		t.Fatalf("confirmed patch: %#v saved=%v err=%v", applied, app.saved, err)
	}

	quit, err := HandleApp(app, map[string]any{"action": "quit"})
	if err != nil || !quit.NeedsConfirmation || quit.Then != "" {
		t.Fatalf("unconfirmed quit: %#v", quit)
	}
	confirmed, err := HandleApp(app, map[string]any{"action": "quit", "confirmed": true})
	if err != nil || confirmed.Then != "quit" {
		t.Fatalf("confirmed quit: %#v err=%v", confirmed, err)
	}
	confirmed.RunAfter(app)
	if app.quit != 1 {
		t.Fatalf("quit calls: %d", app.quit)
	}

	relaunch, err := HandleApp(app, map[string]any{"action": "relaunch", "confirmed": true})
	if err != nil || relaunch.Then != "relaunch" {
		t.Fatalf("relaunch: %#v err=%v", relaunch, err)
	}
	relaunch.RunAfter(app)
	if app.relaunch != 1 {
		t.Fatalf("relaunch calls: %d", app.relaunch)
	}
}

func TestSpeakManyQueuesWithoutConfirmAndCapsSteer(t *testing.T) {
	catalog := &fakeCatalog{refs: map[string]ConversationRef{
		"a": {ID: "a", Title: "A"},
		"b": {ID: "b", Title: "B"},
	}}
	speaker := &fakeSpeaker{produced: true}
	dispatcher := NewDispatcher(catalog, speaker, NewBoard(), func() bool { return true })
	queued := dispatcher.SpeakMany(SpeakManyRequest{
		ConversationIDs: []string{"a", "b", "a"},
		Text:            "report cwd",
		IdempotencyKey:  "batch-1",
		Mode:            "queue",
	})
	batch, ok := queued.(SpeakManyResult)
	if !ok || !batch.Accepted || len(batch.Results) != 2 || speaker.calls != 2 {
		t.Fatalf("queue batch: %#v calls=%d", queued, speaker.calls)
	}
	steered := dispatcher.SpeakMany(SpeakManyRequest{
		ConversationIDs: []string{"a", "b"},
		Text:            "stop and listen",
		IdempotencyKey:  "batch-2",
		Mode:            "steer",
	})
	confirm, ok := steered.(DispatchResult)
	if !ok || !confirm.NeedsConfirmation || speaker.calls != 2 {
		t.Fatalf("steer batch should wait: %#v calls=%d", steered, speaker.calls)
	}
	tooMany := dispatcher.SpeakMany(SpeakManyRequest{
		ConversationIDs: []string{"1", "2", "3", "4", "5", "6", "7", "8", "9"},
		Text:            "nope",
		IdempotencyKey:  "batch-3",
	})
	failed, ok := tooMany.(DispatchResult)
	if !ok || failed.Error == "" {
		t.Fatalf("cap: %#v", tooMany)
	}
}
