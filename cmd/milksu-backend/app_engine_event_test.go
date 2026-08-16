package main

import (
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestEmitEngineEventKeepsRedactedRuntimeFailureInDiagnostics(t *testing.T) {
	recorder := appdata.NewDiagnosticRecorder(8)
	application := &App{diagnostics: recorder}

	application.emitEngineEvent(engine.Event{
		Type:  "engine.error",
		Error: "Access denied at bridge.js:42 token=synthetic-secret-value",
	})

	events := recorder.Snapshot()
	if len(events) != 1 {
		t.Fatalf("diagnostic event count = %d, want 1: %#v", len(events), events)
	}
	message := events[0].Message
	if !strings.Contains(message, "engine.error") ||
		!strings.Contains(message, "bridge.js:42") {
		t.Fatalf("diagnostic event lost runtime detail: %q", message)
	}
	if strings.Contains(message, "synthetic-secret-value") ||
		!strings.Contains(message, "[REDACTED]") {
		t.Fatalf("diagnostic event did not redact credential material: %q", message)
	}
}
