package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
)

const maxDesktopRPCMessageBytes = 128 << 20

type desktopRPCSource string

const (
	desktopRPCSourceRenderer     desktopRPCSource = "renderer"
	desktopRPCSourceElectronHost desktopRPCSource = "electron_host"
)

type desktopHost interface {
	Emit(event string, value any)
	Call(ctx context.Context, method string, payload any, result any) error
}

type desktopRPC struct {
	input      io.Reader
	output     io.Writer
	appMethods map[string]desktopAppMethod
	writeMu    sync.Mutex
	nextID     atomic.Uint64
	mu         sync.Mutex
	pending    map[string]chan desktopRPCMessage
}

type desktopRPCMessage struct {
	Type    string            `json:"type"`
	ID      string            `json:"id,omitempty"`
	Source  desktopRPCSource  `json:"source,omitempty"`
	Method  string            `json:"method,omitempty"`
	Event   string            `json:"event,omitempty"`
	Args    []json.RawMessage `json:"args,omitempty"`
	Payload any               `json:"payload,omitempty"`
	Result  json.RawMessage   `json:"result,omitempty"`
	Error   string            `json:"error,omitempty"`
}

func newDesktopRPC(input io.Reader, output io.Writer) *desktopRPC {
	return &desktopRPC{
		input: input, output: output,
		pending: make(map[string]chan desktopRPCMessage),
	}
}

func (r *desktopRPC) attach(app *App) {
	if app == nil {
		r.appMethods = nil
		return
	}
	r.appMethods = desktopAppMethods(app)
}

func (r *desktopRPC) ready() {
	_ = r.write(desktopRPCMessage{Type: "ready"})
}

func (r *desktopRPC) Emit(event string, value any) {
	if strings.TrimSpace(event) == "" {
		return
	}
	_ = r.write(desktopRPCMessage{Type: "event", Event: event, Payload: value})
}

func (r *desktopRPC) Call(
	ctx context.Context,
	method string,
	payload any,
	result any,
) error {
	method = strings.TrimSpace(method)
	if method == "" {
		return errors.New("desktop host method is required")
	}
	id := fmt.Sprintf("host-%d", r.nextID.Add(1))
	response := make(chan desktopRPCMessage, 1)
	r.mu.Lock()
	r.pending[id] = response
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.pending, id)
		r.mu.Unlock()
	}()
	if err := r.write(desktopRPCMessage{
		Type: "host_request", ID: id, Method: method, Payload: payload,
	}); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case message := <-response:
		if message.Error != "" {
			return errors.New(message.Error)
		}
		if result == nil || len(message.Result) == 0 || string(message.Result) == "null" {
			return nil
		}
		if err := json.Unmarshal(message.Result, result); err != nil {
			return fmt.Errorf("decode desktop host response: %w", err)
		}
		return nil
	}
}

func (r *desktopRPC) serve() error {
	scanner := bufio.NewScanner(r.input)
	scanner.Buffer(make([]byte, 64<<10), maxDesktopRPCMessageBytes)
	for scanner.Scan() {
		var message desktopRPCMessage
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			_ = r.write(desktopRPCMessage{Type: "protocol_error", Error: "invalid desktop RPC message"})
			continue
		}
		switch message.Type {
		case "invoke":
			go r.invoke(message)
		case "host_response":
			r.resolveHostResponse(message)
		case "shutdown":
			return nil
		default:
			_ = r.write(desktopRPCMessage{
				Type: "protocol_error", ID: message.ID,
				Error: "unsupported desktop RPC message type",
			})
		}
	}
	return scanner.Err()
}

func (r *desktopRPC) resolveHostResponse(message desktopRPCMessage) {
	r.mu.Lock()
	response := r.pending[message.ID]
	r.mu.Unlock()
	if response != nil {
		response <- message
	}
}

func (r *desktopRPC) invoke(message desktopRPCMessage) {
	result, err := invokeRegisteredAppMethod(
		r.appMethods,
		message.Source,
		message.Method,
		message.Args,
	)
	response := desktopRPCMessage{Type: "result", ID: message.ID}
	if err != nil {
		response.Error = err.Error()
	} else if result != nil {
		encoded, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			response.Error = "encode desktop method result: " + marshalErr.Error()
		} else {
			response.Result = encoded
		}
	} else {
		response.Result = json.RawMessage("null")
	}
	_ = r.write(response)
}

type desktopAppMethod struct {
	function any
	source   desktopRPCSource
}

func rendererDesktopMethod(function any) desktopAppMethod {
	return desktopAppMethod{function: function, source: desktopRPCSourceRenderer}
}

func electronHostDesktopMethod(function any) desktopAppMethod {
	return desktopAppMethod{function: function, source: desktopRPCSourceElectronHost}
}

// desktopAppMethods is the complete production RPC surface. Keep renderer
// methods aligned with DesktopAppBindings in app/src/desktop.ts. Credentials
// are deliberately bound to the Electron host domain and are never renderer
// methods. Reflection below operates only on these explicit method values.
func desktopAppMethods(app *App) map[string]desktopAppMethod {
	return map[string]desktopAppMethod{
		"GetSettings":                          rendererDesktopMethod(app.GetSettings),
		"GetModelCatalog":                      rendererDesktopMethod(app.GetModelCatalog),
		"SaveSettingsCmd":                      rendererDesktopMethod(app.SaveSettingsCmd),
		"ListPlugins":                          rendererDesktopMethod(app.ListPlugins),
		"SetPluginEnabled":                     rendererDesktopMethod(app.SetPluginEnabled),
		"GetPluginSettingsScript":              rendererDesktopMethod(app.GetPluginSettingsScript),
		"GetActivePluginTheme":                 rendererDesktopMethod(app.GetActivePluginTheme),
		"CallPluginUI":                         rendererDesktopMethod(app.CallPluginUI),
		"ChoosePluginBackground":               rendererDesktopMethod(app.ChoosePluginBackground),
		"ChoosePluginSurface":                  rendererDesktopMethod(app.ChoosePluginSurface),
		"GetPluginSurfaceAsset":                rendererDesktopMethod(app.GetPluginSurfaceAsset),
		"ChoosePluginPackage":                  rendererDesktopMethod(app.ChoosePluginPackage),
		"InstallStagedPlugin":                  rendererDesktopMethod(app.InstallStagedPlugin),
		"DiscardStagedPlugin":                  rendererDesktopMethod(app.DiscardStagedPlugin),
		"RollbackPlugin":                       rendererDesktopMethod(app.RollbackPlugin),
		"UninstallPlugin":                      rendererDesktopMethod(app.UninstallPlugin),
		"SetPluginExternalEnabled":             rendererDesktopMethod(app.SetPluginExternalEnabled),
		"ListPluginPublishers":                 rendererDesktopMethod(app.ListPluginPublishers),
		"RevokePluginPublisher":                rendererDesktopMethod(app.RevokePluginPublisher),
		"GetPluginMCPConfig":                   rendererDesktopMethod(app.GetPluginMCPConfig),
		"ListSecurityTools":                    rendererDesktopMethod(app.ListSecurityTools),
		"SetSecurityToolEnabled":               rendererDesktopMethod(app.SetSecurityToolEnabled),
		"StartSecurityToolSetup":               rendererDesktopMethod(app.StartSecurityToolSetup),
		"GetSecurityToolSetup":                 rendererDesktopMethod(app.GetSecurityToolSetup),
		"CheckSecurityTool":                    rendererDesktopMethod(app.CheckSecurityTool),
		"PrepareSecurityToolCodingHandoff":     rendererDesktopMethod(app.PrepareSecurityToolCodingHandoff),
		"GetLocalDataStatus":                   rendererDesktopMethod(app.GetLocalDataStatus),
		"GetUserArtifactDirectoryStatus":       rendererDesktopMethod(app.GetUserArtifactDirectoryStatus),
		"ExportLocalDataBackup":                rendererDesktopMethod(app.ExportLocalDataBackup),
		"ScheduleLocalDataRestore":             rendererDesktopMethod(app.ScheduleLocalDataRestore),
		"ExportLocalDiagnostics":               rendererDesktopMethod(app.ExportLocalDiagnostics),
		"RevealLocalDataDirectory":             rendererDesktopMethod(app.RevealLocalDataDirectory),
		"RevealUserArtifactDirectory":          rendererDesktopMethod(app.RevealUserArtifactDirectory),
		"GetStartupRecoveryStatus":             rendererDesktopMethod(app.GetStartupRecoveryStatus),
		"GetSessionIndexStatus":                rendererDesktopMethod(app.GetSessionIndexStatus),
		"RefreshSessionIndex":                  rendererDesktopMethod(app.RefreshSessionIndex),
		"SearchSessionHistory":                 rendererDesktopMethod(app.SearchSessionHistory),
		"GetSessionHistoryGraph":               rendererDesktopMethod(app.GetSessionHistoryGraph),
		"ListConversations":                    rendererDesktopMethod(app.ListConversations),
		"ListArchivedConversations":            rendererDesktopMethod(app.ListArchivedConversations),
		"SaveConversation":                     rendererDesktopMethod(app.SaveConversation),
		"EnsureCodingArtifactWorkspace":        rendererDesktopMethod(app.EnsureCodingArtifactWorkspace),
		"ArchiveConversation":                  rendererDesktopMethod(app.ArchiveConversation),
		"RestoreConversation":                  rendererDesktopMethod(app.RestoreConversation),
		"DeleteArchivedConversation":           rendererDesktopMethod(app.DeleteArchivedConversation),
		"DeleteConversation":                   rendererDesktopMethod(app.DeleteConversation),
		"ListLabJobs":                          rendererDesktopMethod(app.ListLabJobs),
		"ListArchivedLabJobs":                  rendererDesktopMethod(app.ListArchivedLabJobs),
		"SaveLabJob":                           rendererDesktopMethod(app.SaveLabJob),
		"ArchiveLabJob":                        rendererDesktopMethod(app.ArchiveLabJob),
		"RestoreLabJob":                        rendererDesktopMethod(app.RestoreLabJob),
		"GenerateConversationTitle":            rendererDesktopMethod(app.GenerateConversationTitle),
		"ChooseAgentWorkspace":                 rendererDesktopMethod(app.ChooseAgentWorkspace),
		"GetCodingProjectMemory":               rendererDesktopMethod(app.GetCodingProjectMemory),
		"RememberCodingProject":                rendererDesktopMethod(app.RememberCodingProject),
		"ForgetCodingProject":                  rendererDesktopMethod(app.ForgetCodingProject),
		"ChooseCTFMaterials":                   rendererDesktopMethod(app.ChooseCTFMaterials),
		"ChooseCodingAttachments":              rendererDesktopMethod(app.ChooseCodingAttachments),
		"ImportCodingAttachments":              rendererDesktopMethod(app.ImportCodingAttachments),
		"PreviewCodingAttachment":              rendererDesktopMethod(app.PreviewCodingAttachment),
		"SendMessage":                          rendererDesktopMethod(app.SendMessage),
		"AbortMessage":                         rendererDesktopMethod(app.AbortMessage),
		"RespondToolApproval":                  rendererDesktopMethod(app.RespondToolApproval),
		"RefreshCodingBackgroundTasks":         rendererDesktopMethod(app.RefreshCodingBackgroundTasks),
		"StartCodingBackgroundTask":            rendererDesktopMethod(app.StartCodingBackgroundTask),
		"StopCodingBackgroundTask":             rendererDesktopMethod(app.StopCodingBackgroundTask),
		"CompactCodingSession":                 rendererDesktopMethod(app.CompactCodingSession),
		"ListCodingTerminals":                  rendererDesktopMethod(app.ListCodingTerminals),
		"StartCodingTerminal":                  rendererDesktopMethod(app.StartCodingTerminal),
		"WriteCodingTerminal":                  rendererDesktopMethod(app.WriteCodingTerminal),
		"ResizeCodingTerminal":                 rendererDesktopMethod(app.ResizeCodingTerminal),
		"StopCodingTerminal":                   rendererDesktopMethod(app.StopCodingTerminal),
		"CloseCodingTerminal":                  rendererDesktopMethod(app.CloseCodingTerminal),
		"GetCodingEnvironment":                 rendererDesktopMethod(app.GetCodingEnvironment),
		"GetCodingMCPConfig":                   rendererDesktopMethod(app.GetCodingMCPConfig),
		"GetCodingDiff":                        rendererDesktopMethod(app.GetCodingDiff),
		"OpenCodingFileInEditor":               rendererDesktopMethod(app.OpenCodingFileInEditor),
		"ApplyCodingGitAction":                 rendererDesktopMethod(app.ApplyCodingGitAction),
		"ApplyCodingGitHunkAction":             rendererDesktopMethod(app.ApplyCodingGitHunkAction),
		"PrepareCodingPullRequest":             rendererDesktopMethod(app.PrepareCodingPullRequest),
		"PublishCodingPullRequest":             rendererDesktopMethod(app.PublishCodingPullRequest),
		"GetCodingArtifactPreview":             rendererDesktopMethod(app.GetCodingArtifactPreview),
		"StartCodingBrowser":                   rendererDesktopMethod(app.StartCodingBrowser),
		"EnsureCodingBrowser":                  rendererDesktopMethod(app.EnsureCodingBrowser),
		"GetCodingBrowserStatus":               rendererDesktopMethod(app.GetCodingBrowserStatus),
		"SetCodingBrowserViewport":             rendererDesktopMethod(app.SetCodingBrowserViewport),
		"NavigateCodingBrowser":                rendererDesktopMethod(app.NavigateCodingBrowser),
		"CodingBrowserGoBack":                  rendererDesktopMethod(app.CodingBrowserGoBack),
		"CodingBrowserGoForward":               rendererDesktopMethod(app.CodingBrowserGoForward),
		"ReloadCodingBrowser":                  rendererDesktopMethod(app.ReloadCodingBrowser),
		"CreateCodingBrowserTab":               rendererDesktopMethod(app.CreateCodingBrowserTab),
		"ActivateCodingBrowserTab":             rendererDesktopMethod(app.ActivateCodingBrowserTab),
		"CloseCodingBrowserTab":                rendererDesktopMethod(app.CloseCodingBrowserTab),
		"StopCodingBrowser":                    rendererDesktopMethod(app.StopCodingBrowser),
		"RevealCodingBrowserEvidence":          rendererDesktopMethod(app.RevealCodingBrowserEvidence),
		"ListCodingComputerUseTargets":         rendererDesktopMethod(app.ListCodingComputerUseTargets),
		"GetCodingComputerUseStatus":           rendererDesktopMethod(app.GetCodingComputerUseStatus),
		"PrepareCodingComputerUseDriver":       rendererDesktopMethod(app.PrepareCodingComputerUseDriver),
		"ActivateCodingComputerUse":            rendererDesktopMethod(app.ActivateCodingComputerUse),
		"RequestCodingComputerUsePermissions":  rendererDesktopMethod(app.RequestCodingComputerUsePermissions),
		"RelaunchDesktopApp":                   rendererDesktopMethod(app.RelaunchDesktopApp),
		"StartCodingComputerUse":               rendererDesktopMethod(app.StartCodingComputerUse),
		"StopCodingComputerUse":                rendererDesktopMethod(app.StopCodingComputerUse),
		"SteerMessage":                         rendererDesktopMethod(app.SteerMessage),
		"RemoveQueuedMessage":                  rendererDesktopMethod(app.RemoveQueuedMessage),
		"TestAgentModel":                       rendererDesktopMethod(app.TestAgentModel),
		"GetCodingUsageSnapshot":               rendererDesktopMethod(app.GetCodingUsageSnapshot),
		"ImportNSSCTFChallenge":                rendererDesktopMethod(app.ImportNSSCTFChallenge),
		"SyncNSSCTFCatalog":                    rendererDesktopMethod(app.SyncNSSCTFCatalog),
		"GetNSSCTFTrainingDashboard":           rendererDesktopMethod(app.GetNSSCTFTrainingDashboard),
		"RecommendCTFDailyChallenge":           rendererDesktopMethod(app.RecommendCTFDailyChallenge),
		"ListNSSCTFCatalog":                    rendererDesktopMethod(app.ListNSSCTFCatalog),
		"GetCTFTrainingPlatforms":              rendererDesktopMethod(app.GetCTFTrainingPlatforms),
		"OpenNSSCTFChallenge":                  rendererDesktopMethod(app.OpenNSSCTFChallenge),
		"OpenCTFSourceURL":                     rendererDesktopMethod(app.OpenCTFSourceURL),
		"OpenChromeExtensionManager":           rendererDesktopMethod(app.OpenChromeExtensionManager),
		"OpenPlaywrightBrowserExtension":       rendererDesktopMethod(app.OpenPlaywrightBrowserExtension),
		"RevealBrowserExtension":               rendererDesktopMethod(app.RevealBrowserExtension),
		"GetCTFShowCatalogStatus":              rendererDesktopMethod(app.GetCTFShowCatalogStatus),
		"OpenCTFShowChallenges":                rendererDesktopMethod(app.OpenCTFShowChallenges),
		"ImportCTFShowChallenge":               rendererDesktopMethod(app.ImportCTFShowChallenge),
		"SubmitCTFShowWebFlag":                 rendererDesktopMethod(app.SubmitCTFShowWebFlag),
		"GetNSSCTFWebBridgeStatus":             rendererDesktopMethod(app.GetNSSCTFWebBridgeStatus),
		"ImportNSSCTFWebPageMaterial":          rendererDesktopMethod(app.ImportNSSCTFWebPageMaterial),
		"ImportNSSCTFWebAttachment":            rendererDesktopMethod(app.ImportNSSCTFWebAttachment),
		"SubmitNSSCTFWebFlag":                  rendererDesktopMethod(app.SubmitNSSCTFWebFlag),
		"GetNSSCTFArenaCurrent":                rendererDesktopMethod(app.GetNSSCTFArenaCurrent),
		"StartNSSCTFArena":                     rendererDesktopMethod(app.StartNSSCTFArena),
		"SubmitNSSCTFArenaFlag":                rendererDesktopMethod(app.SubmitNSSCTFArenaFlag),
		"AbandonNSSCTFArena":                   rendererDesktopMethod(app.AbandonNSSCTFArena),
		"OpenNSSCTFArena":                      rendererDesktopMethod(app.OpenNSSCTFArena),
		"StartCTFChallenge":                    rendererDesktopMethod(app.StartCTFChallenge),
		"ListCTFJobs":                          rendererDesktopMethod(app.ListCTFJobs),
		"GetCTFJob":                            rendererDesktopMethod(app.GetCTFJob),
		"GetCTFArtifactPreview":                rendererDesktopMethod(app.GetCTFArtifactPreview),
		"RequestCTFEndpoint":                   rendererDesktopMethod(app.RequestCTFEndpoint),
		"ApproveCTFEndpoint":                   rendererDesktopMethod(app.ApproveCTFEndpoint),
		"DenyCTFEndpoint":                      rendererDesktopMethod(app.DenyCTFEndpoint),
		"PrepareCTFAgentWorkspace":             rendererDesktopMethod(app.PrepareCTFAgentWorkspace),
		"PrepareCTFToolBuilderWorkspace":       rendererDesktopMethod(app.PrepareCTFToolBuilderWorkspace),
		"PrepareCTFStrategistWorkspace":        rendererDesktopMethod(app.PrepareCTFStrategistWorkspace),
		"SaveCTFTrainingMemory":                rendererDesktopMethod(app.SaveCTFTrainingMemory),
		"GetCTFMemoryContext":                  rendererDesktopMethod(app.GetCTFMemoryContext),
		"ArchiveCTFMemory":                     rendererDesktopMethod(app.ArchiveCTFMemory),
		"GetCTFToolWorkshopState":              rendererDesktopMethod(app.GetCTFToolWorkshopState),
		"GetCTFAgentBudgetStatus":              rendererDesktopMethod(app.GetCTFAgentBudgetStatus),
		"GetCTFAgentRunCheckpoint":             rendererDesktopMethod(app.GetCTFAgentRunCheckpoint),
		"GetCTFAgentReplay":                    rendererDesktopMethod(app.GetCTFAgentReplay),
		"GenerateCTFTrainingReport":            rendererDesktopMethod(app.GenerateCTFTrainingReport),
		"CancelCTFJob":                         rendererDesktopMethod(app.CancelCTFJob),
		"RecordCTFLearning":                    rendererDesktopMethod(app.RecordCTFLearning),
		"ContinueCTFJob":                       rendererDesktopMethod(app.ContinueCTFJob),
		"ReviewCTFSubmission":                  rendererDesktopMethod(app.ReviewCTFSubmission),
		"PrepareCTFExternalSubmission":         rendererDesktopMethod(app.PrepareCTFExternalSubmission),
		"RecordCTFExternalVerdict":             rendererDesktopMethod(app.RecordCTFExternalVerdict),
		"EnsureVulnTrackingWorkspace":          rendererDesktopMethod(app.EnsureVulnTrackingWorkspace),
		"ListVulnJobs":                         rendererDesktopMethod(app.ListVulnJobs),
		"GetVulnJob":                           rendererDesktopMethod(app.GetVulnJob),
		"FetchCISAKEVFeed":                     rendererDesktopMethod(app.FetchCISAKEVFeed),
		"FetchNVDCVE":                          rendererDesktopMethod(app.FetchNVDCVE),
		"SearchNVDCVEs":                        rendererDesktopMethod(app.SearchNVDCVEs),
		"FetchFIRSTEPSS":                       rendererDesktopMethod(app.FetchFIRSTEPSS),
		"FetchOSVCVE":                          rendererDesktopMethod(app.FetchOSVCVE),
		"FetchGitHubAdvisories":                rendererDesktopMethod(app.FetchGitHubAdvisories),
		"FetchVulhubPracticeCatalog":           rendererDesktopMethod(app.FetchVulhubPracticeCatalog),
		"RevealVulnerabilityFeedSnapshot":      rendererDesktopMethod(app.RevealVulnerabilityFeedSnapshot),
		"ChooseVulnerabilityPracticeDirectory": rendererDesktopMethod(app.ChooseVulnerabilityPracticeDirectory),
		"StartVulnerabilityPractice":           rendererDesktopMethod(app.StartVulnerabilityPractice),
		"GetVulnerabilityPracticeStatus":       rendererDesktopMethod(app.GetVulnerabilityPracticeStatus),
		"StopVulnerabilityPractice":            rendererDesktopMethod(app.StopVulnerabilityPractice),
		"RecordVulnLearning":                   rendererDesktopMethod(app.RecordVulnLearning),
		"RecordVulnAssetVerification":          rendererDesktopMethod(app.RecordVulnAssetVerification),
		"CancelVulnJob":                        rendererDesktopMethod(app.CancelVulnJob),

		"SetAccountModelCredential":   electronHostDesktopMethod(app.SetAccountModelCredential),
		"ClearAccountModelCredential": electronHostDesktopMethod(app.ClearAccountModelCredential),
	}
}

func invokeAppMethod(
	app *App,
	source desktopRPCSource,
	name string,
	args []json.RawMessage,
) (result any, err error) {
	if app == nil {
		return nil, errors.New("desktop runtime is unavailable")
	}
	return invokeRegisteredAppMethod(desktopAppMethods(app), source, name, args)
}

func invokeRegisteredAppMethod(
	methods map[string]desktopAppMethod,
	source desktopRPCSource,
	name string,
	args []json.RawMessage,
) (result any, err error) {
	if methods == nil {
		return nil, errors.New("desktop runtime is unavailable")
	}
	name = strings.TrimSpace(name)
	method, ok := methods[name]
	if !ok {
		return nil, fmt.Errorf("unsupported desktop method %q", name)
	}
	if method.source != source {
		switch source {
		case desktopRPCSourceRenderer, desktopRPCSourceElectronHost:
			return nil, fmt.Errorf("desktop method %s is unavailable to %s", name, source)
		default:
			return nil, fmt.Errorf("unsupported desktop RPC source %q", source)
		}
	}
	return invokeDesktopMethod(name, method.function, args)
}

func invokeDesktopMethod(
	name string,
	function any,
	args []json.RawMessage,
) (result any, err error) {
	method := reflect.ValueOf(function)
	if !method.IsValid() || method.Kind() != reflect.Func {
		return nil, fmt.Errorf("desktop method %s has an invalid binding", name)
	}
	methodType := method.Type()
	if methodType.NumIn() != len(args) {
		return nil, fmt.Errorf(
			"desktop method %s expects %d arguments, received %d",
			name, methodType.NumIn(), len(args),
		)
	}
	values := make([]reflect.Value, len(args))
	for index, raw := range args {
		value := reflect.New(methodType.In(index))
		if err := json.Unmarshal(raw, value.Interface()); err != nil {
			return nil, fmt.Errorf("decode argument %d for %s: %w", index, name, err)
		}
		values[index] = value.Elem()
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("desktop method %s failed", name)
			result = nil
		}
	}()
	outputs := method.Call(values)
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	if len(outputs) > 0 && outputs[len(outputs)-1].Type().Implements(errorType) {
		last := outputs[len(outputs)-1]
		outputs = outputs[:len(outputs)-1]
		if !last.IsNil() {
			return nil, last.Interface().(error)
		}
	}
	switch len(outputs) {
	case 0:
		return nil, nil
	case 1:
		return outputs[0].Interface(), nil
	default:
		return nil, fmt.Errorf("desktop method %s has an unsupported result shape", name)
	}
}

func (r *desktopRPC) write(message desktopRPCMessage) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	encoded, err := json.Marshal(message)
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	_, err = r.output.Write(encoded)
	return err
}
