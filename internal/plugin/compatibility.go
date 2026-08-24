package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
)

func validateSameMajorCompatibility(current, next Manifest) error {
	nextTools := make(map[string]ToolContribution, len(next.Contributes.Tools))
	for _, tool := range next.Contributes.Tools {
		nextTools[tool.Name] = tool
	}
	for _, currentTool := range current.Contributes.Tools {
		nextTool, exists := nextTools[currentTool.Name]
		if !exists {
			return fmt.Errorf("same-major upgrade cannot remove tool %q", currentTool.Name)
		}
		if currentTool.Effect != nextTool.Effect || currentTool.External != nextTool.External {
			return fmt.Errorf("same-major upgrade cannot change tool %q effect or external exposure", currentTool.Name)
		}
		if err := schemaDoesNotNarrowInput(currentTool.InputSchema, nextTool.InputSchema); err != nil {
			return fmt.Errorf("same-major tool %q input schema: %w", currentTool.Name, err)
		}
		if err := schemaDoesNotBreakOutput(currentTool.OutputSchema, nextTool.OutputSchema); err != nil {
			return fmt.Errorf("same-major tool %q output schema: %w", currentTool.Name, err)
		}
	}
	return nil
}

func decodeObjectSchema(raw json.RawMessage) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var schema map[string]any
	if err := decoder.Decode(&schema); err != nil {
		return nil, err
	}
	if schema["type"] != "object" {
		return nil, errors.New("top-level schema must remain an object")
	}
	return schema, nil
}

func schemaProperties(schema map[string]any) map[string]any {
	properties, _ := schema["properties"].(map[string]any)
	if properties == nil {
		return map[string]any{}
	}
	return properties
}

func schemaRequired(schema map[string]any) map[string]struct{} {
	result := map[string]struct{}{}
	values, _ := schema["required"].([]any)
	for _, value := range values {
		if name, ok := value.(string); ok {
			result[name] = struct{}{}
		}
	}
	return result
}

func schemaDoesNotNarrowInput(currentRaw, nextRaw json.RawMessage) error {
	current, err := decodeObjectSchema(currentRaw)
	if err != nil {
		return err
	}
	next, err := decodeObjectSchema(nextRaw)
	if err != nil {
		return err
	}
	currentProperties, nextProperties := schemaProperties(current), schemaProperties(next)
	for name, definition := range currentProperties {
		if !reflect.DeepEqual(definition, nextProperties[name]) {
			return fmt.Errorf("property %q was removed or narrowed", name)
		}
	}
	currentRequired := schemaRequired(current)
	for name := range schemaRequired(next) {
		if _, wasRequired := currentRequired[name]; !wasRequired {
			return fmt.Errorf("optional property %q became required", name)
		}
	}
	currentAdditional, currentSpecified := current["additionalProperties"].(bool)
	nextAdditional, nextSpecified := next["additionalProperties"].(bool)
	if (!currentSpecified || currentAdditional) && nextSpecified && !nextAdditional {
		return errors.New("additionalProperties was narrowed")
	}
	return nil
}

func schemaDoesNotBreakOutput(currentRaw, nextRaw json.RawMessage) error {
	current, err := decodeObjectSchema(currentRaw)
	if err != nil {
		return err
	}
	next, err := decodeObjectSchema(nextRaw)
	if err != nil {
		return err
	}
	currentProperties, nextProperties := schemaProperties(current), schemaProperties(next)
	for name, definition := range currentProperties {
		if !reflect.DeepEqual(definition, nextProperties[name]) {
			return fmt.Errorf("property %q was removed or changed", name)
		}
	}
	for name := range schemaRequired(current) {
		if _, remainsRequired := schemaRequired(next)[name]; !remainsRequired {
			return fmt.Errorf("required output property %q is no longer guaranteed", name)
		}
	}
	currentAdditional, currentSpecified := current["additionalProperties"].(bool)
	nextAdditional, nextSpecified := next["additionalProperties"].(bool)
	currentAllowsAdditional := !currentSpecified || currentAdditional
	nextAllowsAdditional := !nextSpecified || nextAdditional
	if !currentAllowsAdditional && nextAllowsAdditional {
		return errors.New("closed output schema became open")
	}
	if !currentAllowsAdditional && len(nextProperties) != len(currentProperties) {
		return errors.New("closed output schema gained properties")
	}
	return nil
}
