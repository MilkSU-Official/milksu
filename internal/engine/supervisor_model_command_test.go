package engine

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

// The sidecar process is per workspace and can only resolve the custom relay that was active
// when it was spawned (engineEnvironment exports a single MILKSU_CUSTOM_PROVIDER_* slot). A
// conversation whose manual choice is a *different* custom relay therefore lost its provider
// definition and silently fell back to the account source - the user's own report: the picker
// showed custom-relay-deepseek, the engine ran milksu-account with a 502.
//
// The definition has to travel with the turn instead of relying on the process environment.
func TestSendMessageCarriesTheConversationCustomProviderDefinition(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{
		stdin:     writer,
		workspace: workspace,
	}
	defer func() {
		supervisor.mu.Lock()
		supervisor.process = nil
		supervisor.sessions = make(map[string]struct{})
		supervisor.mu.Unlock()
	}()

	baseURL := "https://api.deepseek.example.test"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "custom-relay-deepseek"
	settings.ActiveModel = "deepseek-flash"
	settings.Providers["custom-relay-deepseek"] = config.ProviderConfig{
		Custom: true, Enabled: true, Name: "DeepSeek",
		Models: []string{"deepseek-flash"}, APIKey: "deepseek-personal-secret",
		BaseURL: &baseURL,
	}
	settings.Relay = &config.RelayConfig{
		Enabled: true, URL: "https://tokenflux.example.test/v1", Key: "account-secret",
	}

	if err := supervisor.SendMessage(
		"session-manual-model",
		"hello",
		workspace,
		"",
		"go",
		"workspace-auto",
		nil,
		"",
		nil,
		nil,
		nil,
		nil,
		settings,
	); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(line, &command); err != nil {
		t.Fatal(err)
	}
	if command["provider"] != "custom-relay-deepseek" || command["model"] != "deepseek-flash" {
		t.Fatalf("manual choice must reach the sidecar: %#v", command)
	}
	custom, ok := command["customProvider"].(map[string]any)
	if !ok {
		t.Fatalf("the conversation's own relay definition must travel with the turn: %#v", command)
	}
	if custom["id"] != "custom-relay-deepseek" ||
		custom["baseUrl"] != baseURL ||
		custom["key"] != "deepseek-personal-secret" {
		t.Fatalf("unexpected custom provider payload: %#v", custom)
	}
	// The account credential belongs to the account source; it must not ride along here.
	for key, value := range custom {
		if strings.Contains(strings.TrimSpace(toString(value)), "account-secret") {
			t.Fatalf("account credential leaked into the turn payload: %s", key)
		}
	}
}

func toString(value any) string {
	text, _ := value.(string)
	return text
}

// The recovered session must be built on the conversation's own model. Creating it without a
// provider/model leaves it on whatever the process default resolves to, which is how the global
// default used to end up inside an existing conversation.
func TestBackgroundRecoveryCarriesTheConversationModel(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{stdin: writer, workspace: workspace}
	defer func() {
		supervisor.mu.Lock()
		supervisor.process = nil
		supervisor.sessions = make(map[string]struct{})
		supervisor.mu.Unlock()
	}()

	baseURL := "https://api.deepseek.example.test"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "custom-relay-deepseek"
	settings.ActiveModel = "deepseek-flash"
	settings.Providers["custom-relay-deepseek"] = config.ProviderConfig{
		Custom: true, Enabled: true, Name: "DeepSeek",
		Models: []string{"deepseek-flash"}, APIKey: "deepseek-personal-secret",
		BaseURL: &baseURL,
	}

	emitted := make(chan struct{}, 1)
	go func() {
		_, _ = supervisor.recoverBackgroundTaskSession(
			"session-recovered",
			workspace,
			CodingPolicy{ExecutionMode: "go", ApprovalPolicy: "workspace-auto"},
			settings,
		)
		emitted <- struct{}{}
	}()

	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(line, &command); err != nil {
		t.Fatal(err)
	}
	if command["action"] != "create_session" {
		t.Fatalf("unexpected recovery command: %#v", command)
	}
	if command["provider"] != "custom-relay-deepseek" || command["model"] != "deepseek-flash" {
		t.Fatalf("recovery must carry the conversation's own model: %#v", command)
	}
	order, ok := command["modelSourceOrder"].([]any)
	if !ok || len(order) == 0 {
		t.Fatalf("recovery must carry the model source order: %#v", command)
	}
	custom, ok := command["customProvider"].(map[string]any)
	if !ok || custom["id"] != "custom-relay-deepseek" {
		t.Fatalf("recovery must carry the conversation's relay definition: %#v", command)
	}
	// Let the recovery finish instead of waiting out its timeout.
	supervisor.emitEvent(normalizeBridgeEvent(bridgeEvent{
		Type: "ready",
		ID:   "session-recovered",
	}))
	writer.Close()
	<-emitted
}

// E) "Change it and it takes effect on the next turn": the relay chosen now must be the one the
// next turn uses, even though the sidecar process was spawned for a different one.
func TestEachTurnCarriesTheModelChosenForThatTurn(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{stdin: writer, workspace: workspace}
	defer func() {
		supervisor.mu.Lock()
		supervisor.process = nil
		supervisor.sessions = make(map[string]struct{})
		supervisor.mu.Unlock()
	}()

	firstURL := "https://relay-one.example.test"
	secondURL := "https://relay-two.example.test"
	base := config.DefaultSettings()
	base.Providers["relay-one"] = config.ProviderConfig{
		Custom: true, Enabled: true, Name: "Relay one", Models: []string{"model-one"},
		APIKey: "relay-one-secret", BaseURL: &firstURL,
	}
	base.Providers["relay-two"] = config.ProviderConfig{
		Custom: true, Enabled: true, Name: "Relay two", Models: []string{"model-two"},
		APIKey: "relay-two-secret", BaseURL: &secondURL,
	}
	// The process default is a third thing entirely: neither of the relays.
	base.ActiveProvider = "tokenflux"
	base.ActiveModel = "deepseek/deepseek-flash"

	read := func() map[string]any {
		t.Helper()
		line, readErr := bufio.NewReader(reader).ReadBytes('\n')
		if readErr != nil {
			t.Fatal(readErr)
		}
		var command map[string]any
		if jsonErr := json.Unmarshal(line, &command); jsonErr != nil {
			t.Fatal(jsonErr)
		}
		return command
	}

	first := base
	first.ActiveProvider = "relay-one"
	first.ActiveModel = "model-one"
	if err := supervisor.SendMessage(
		"session-switch", "first", workspace, "", "go", "workspace-auto",
		nil, "", nil, nil, nil, nil, first,
	); err != nil {
		t.Fatal(err)
	}
	command := read()
	if command["provider"] != "relay-one" || command["model"] != "model-one" {
		t.Fatalf("first turn must use the first relay: %#v", command)
	}
	if custom, _ := command["customProvider"].(map[string]any); custom["id"] != "relay-one" {
		t.Fatalf("first turn must carry the first relay definition: %#v", command)
	}

	second := base
	second.ActiveProvider = "relay-two"
	second.ActiveModel = "model-two"
	if err := supervisor.SendMessage(
		"session-switch", "second", workspace, "", "go", "workspace-auto",
		nil, "", nil, nil, nil, nil, second,
	); err != nil {
		t.Fatal(err)
	}
	command = read()
	if command["provider"] != "relay-two" || command["model"] != "model-two" {
		t.Fatalf("the next turn must use the newly chosen relay: %#v", command)
	}
	if custom, _ := command["customProvider"].(map[string]any); custom["id"] != "relay-two" ||
		custom["key"] != "relay-two-secret" {
		t.Fatalf("the next turn must carry the newly chosen relay definition: %#v", command)
	}
}

// F) Changing the app-level default must not change what an existing conversation runs. This is
// the user's rule 1, locked at the point where the run-time model is decided.
func TestChangingTheGlobalDefaultDoesNotChangeAnExistingConversation(t *testing.T) {
	settings := modelSelectionSettings()
	settings.Providers["custom-relay-deepseek"] = config.ProviderConfig{
		Custom: true, Enabled: true, Name: "DeepSeek",
		Models: []string{"deepseek-flash"}, APIKey: "deepseek-personal-secret",
	}

	before, err := ResolveTaskModel(settings, "", ModelModeManual, "custom-relay-deepseek", "deepseek-flash")
	if err != nil {
		t.Fatal(err)
	}
	// The user changes the app default to something broken.
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "deepseek/deepseek-flash"
	settings.ModelVerified = &config.ModelVerification{Provider: "tokenflux", Model: "deepseek/deepseek-flash"}
	after, err := ResolveTaskModel(settings, "", ModelModeManual, "custom-relay-deepseek", "deepseek-flash")
	if err != nil {
		t.Fatal(err)
	}
	if after.ActiveProvider != before.ActiveProvider || after.ActiveModel != before.ActiveModel {
		t.Fatalf("the default change leaked into an existing conversation: before=%s/%s after=%s/%s",
			before.ActiveProvider, before.ActiveModel, after.ActiveProvider, after.ActiveModel)
	}
	if after.ActiveProvider != "custom-relay-deepseek" || after.ActiveModel != "deepseek-flash" {
		t.Fatalf("existing conversation must keep running its own model: %#v", after)
	}
}
