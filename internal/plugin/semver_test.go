package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStrictSemanticVersionOrdering(t *testing.T) {
	invalid := []string{"1", "1.0", "01.0.0", "1.01.0", "1.0.00", "1.0.0-01", "v1.0.0", "1.0.0+"}
	for _, value := range invalid {
		if _, err := parseSemanticVersion(value); err == nil {
			t.Errorf("parseSemanticVersion(%q) unexpectedly succeeded", value)
		}
	}
	ordered := []string{"1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"}
	for index := 1; index < len(ordered); index++ {
		comparison, err := compareSemanticVersions(ordered[index-1], ordered[index])
		if err != nil || comparison >= 0 {
			t.Fatalf("compare %q < %q = %d, %v", ordered[index-1], ordered[index], comparison, err)
		}
	}
	comparison, err := compareSemanticVersions("1.0.0+build.1", "1.0.0+build.2")
	if err != nil || comparison != 0 {
		t.Fatalf("build metadata changed precedence: %d, %v", comparison, err)
	}
}

func TestSameMajorToolCompatibility(t *testing.T) {
	input := json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"additionalProperties":false}`)
	output := json.RawMessage(`{"type":"object","properties":{"count":{"type":"integer"}},"required":["count"],"additionalProperties":false}`)
	current := testManifest("test.compat")
	current.Contributes.Tools = []ToolContribution{{Name: "inspect", Description: "Inspect", InputSchema: input, OutputSchema: output, Effect: ToolEffectRead}}
	next := current
	next.Version = "1.1.0"
	if err := validateSameMajorCompatibility(current, next); err != nil {
		t.Fatal(err)
	}
	next.Contributes.Tools = nil
	if err := validateSameMajorCompatibility(current, next); err == nil || !strings.Contains(err.Error(), "remove tool") {
		t.Fatalf("removed tool compatibility error = %v", err)
	}
	next = current
	next.Version = "1.1.0"
	next.Contributes.Tools = append([]ToolContribution(nil), current.Contributes.Tools...)
	next.Contributes.Tools[0].InputSchema = json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}`)
	if err := validateSameMajorCompatibility(current, next); err == nil || !strings.Contains(err.Error(), "became required") {
		t.Fatalf("narrowed input compatibility error = %v", err)
	}
}

func TestSameMajorOutputSchemaCannotOpenAdditionalProperties(t *testing.T) {
	input := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	closed := json.RawMessage(`{"type":"object","properties":{"count":{"type":"integer"}},"required":["count"],"additionalProperties":false}`)
	opened := json.RawMessage(`{"type":"object","properties":{"count":{"type":"integer"}},"required":["count"]}`)
	current := testManifest("test.output-compat")
	current.Version = "1.0.0"
	current.Contributes.Tools = []ToolContribution{{Name: "inspect", Description: "Inspect", InputSchema: input, OutputSchema: closed, Effect: ToolEffectRead}}
	next := current
	next.Version = "1.1.0"
	next.Contributes.Tools = append([]ToolContribution(nil), current.Contributes.Tools...)
	next.Contributes.Tools[0].OutputSchema = opened
	if err := validateSameMajorCompatibility(current, next); err == nil || !strings.Contains(err.Error(), "became open") {
		t.Fatalf("open output schema compatibility error = %v", err)
	}
}
