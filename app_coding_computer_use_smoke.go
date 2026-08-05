package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/computercap"
)

const (
	computerUseAppSmokeResultEnv       = "MILKSU_COMPUTER_USE_APP_SMOKE_RESULT"
	computerUseAppSmokeConversationEnv = "MILKSU_COMPUTER_USE_APP_SMOKE_CONVERSATION_ID"
	computerUseAppSmokeTargetBundleEnv = "MILKSU_COMPUTER_USE_APP_SMOKE_TARGET_BUNDLE_ID"
	computerUseAppSmokeTargetPIDEnv    = "MILKSU_COMPUTER_USE_APP_SMOKE_TARGET_PID"
)

type computerUseAppSmokeReport struct {
	Schema            string                 `json:"schema"`
	RanAt             string                 `json:"ranAt"`
	DataDirectory     string                 `json:"dataDirectory"`
	ConversationID    string                 `json:"conversationId"`
	RequestedBundleID string                 `json:"requestedBundleId"`
	RequestedPID      int                    `json:"requestedPid,omitempty"`
	TargetCount       int                    `json:"targetCount"`
	SelectedTarget    computercap.Target     `json:"selectedTarget"`
	InitialStatus     computercap.Status     `json:"initialStatus"`
	StartedStatus     computercap.Status     `json:"startedStatus"`
	ConfirmedStatus   computercap.Status     `json:"confirmedStatus"`
	DescriptorEnabled bool                   `json:"descriptorEnabled"`
	Descriptor        computercap.Descriptor `json:"descriptor"`
	SocketPathExists  bool                   `json:"socketPathExists"`
	StoppedStatus     computercap.Status     `json:"stoppedStatus"`
	Error             string                 `json:"error,omitempty"`
}

func (a *App) maybeRunComputerUseAppSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(computerUseAppSmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := computerUseAppSmokeReport{
		Schema:            "milksu-computer-use-app-smoke/v1",
		RanAt:             time.Now().UTC().Format(time.RFC3339Nano),
		DataDirectory:     a.dataDirectory,
		ConversationID:    strings.TrimSpace(os.Getenv(computerUseAppSmokeConversationEnv)),
		RequestedBundleID: strings.TrimSpace(os.Getenv(computerUseAppSmokeTargetBundleEnv)),
		RequestedPID:      computerUseAppSmokeTargetPID(),
	}
	if report.ConversationID == "" {
		report.ConversationID = "computer-use-app-smoke"
	}
	if report.RequestedBundleID == "" {
		report.RequestedBundleID = "com.apple.calculator"
	}

	started := false
	defer func() {
		if started && a.computerUse != nil {
			stopped, err := a.StopCodingComputerUse(report.ConversationID)
			report.StoppedStatus = stopped
			if err != nil && report.Error == "" {
				report.Error = fmt.Sprintf("stop Computer Use app smoke session: %v", err)
			}
		}
		if err := writeComputerUseAppSmokeReport(resultPath, report); err != nil {
			a.diagnostics.Record("computer-use", "error", "packaged app smoke report failed")
		}
	}()

	if a.computerUse == nil {
		report.Error = "Computer Use service is unavailable"
		return
	}
	report.InitialStatus = a.GetCodingComputerUseStatus()

	targets, err := a.ListCodingComputerUseTargets()
	if err != nil {
		report.Error = fmt.Sprintf("list visible Computer Use targets: %v", err)
		return
	}
	report.TargetCount = len(targets)
	target, ok := selectComputerUseAppSmokeTarget(
		targets,
		report.RequestedBundleID,
		report.RequestedPID,
	)
	if !ok {
		report.Error = fmt.Sprintf(
			"requested visible target %s pid=%d was not found",
			report.RequestedBundleID,
			report.RequestedPID,
		)
		return
	}
	report.SelectedTarget = target

	startedStatus, err := a.StartCodingComputerUse(
		report.ConversationID,
		target.PID,
		target.WindowID,
	)
	report.StartedStatus = startedStatus
	if err != nil {
		report.Error = fmt.Sprintf("start Computer Use app smoke session: %v", err)
		return
	}
	started = true
	report.ConfirmedStatus = a.GetCodingComputerUseStatus()
	if !report.ConfirmedStatus.Enabled ||
		report.ConfirmedStatus.Phase != "ready" ||
		report.ConfirmedStatus.ConversationID != report.ConversationID ||
		report.ConfirmedStatus.Target.PID != target.PID ||
		report.ConfirmedStatus.Target.WindowID != target.WindowID ||
		report.ConfirmedStatus.Target.BundleID != target.BundleID {
		report.Error = "Computer Use app smoke status did not preserve the selected target"
		return
	}

	descriptor, enabled := a.computerUse.Descriptor(report.ConversationID)
	report.Descriptor = descriptor
	report.DescriptorEnabled = enabled
	if !enabled ||
		descriptor.TargetBundleID != target.BundleID ||
		descriptor.TargetPID != target.PID ||
		descriptor.TargetWindowID != target.WindowID ||
		descriptor.SocketPath == "" {
		report.Error = "Computer Use app smoke descriptor was missing or changed target scope"
		return
	}
	if info, statErr := os.Stat(descriptor.SocketPath); statErr == nil && !info.IsDir() {
		report.SocketPathExists = true
	} else {
		report.Error = fmt.Sprintf("Computer Use app smoke driver socket unavailable: %v", statErr)
		return
	}

	stopped, err := a.StopCodingComputerUse(report.ConversationID)
	started = false
	report.StoppedStatus = stopped
	if err != nil {
		report.Error = fmt.Sprintf("stop Computer Use app smoke session: %v", err)
		return
	}
	if stopped.Enabled || stopped.ConversationID != "" || stopped.SessionID != "" {
		report.Error = "Computer Use app smoke stop left a visible session enabled"
	}
}

func computerUseAppSmokeTargetPID() int {
	raw := strings.TrimSpace(os.Getenv(computerUseAppSmokeTargetPIDEnv))
	if raw == "" {
		return 0
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 1 {
		return 0
	}
	return value
}

func selectComputerUseAppSmokeTarget(
	targets []computercap.Target,
	bundleID string,
	pid int,
) (computercap.Target, bool) {
	bundleID = strings.TrimSpace(bundleID)
	for _, target := range targets {
		if pid > 1 && target.PID != pid {
			continue
		}
		if bundleID != "" && target.BundleID != bundleID {
			continue
		}
		return target, true
	}
	if pid <= 1 {
		return computercap.Target{}, false
	}
	for _, target := range targets {
		if target.PID == pid {
			return target, true
		}
	}
	return computercap.Target{}, false
}

func writeComputerUseAppSmokeReport(path string, report computerUseAppSmokeReport) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve Computer Use app smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create Computer Use app smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Computer Use app smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-computer-use-app-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary Computer Use app smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary Computer Use app smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary Computer Use app smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary Computer Use app smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Computer Use app smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install Computer Use app smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect Computer Use app smoke report: %w", err)
	}
	return nil
}
