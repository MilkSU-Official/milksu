package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
)

var allowedSchemaKeywords = map[string]struct{}{
	"type": {}, "description": {}, "properties": {}, "required": {},
	"additionalProperties": {}, "items": {}, "enum": {},
	"minLength": {}, "maxLength": {}, "minimum": {}, "maximum": {},
	"minItems": {}, "maxItems": {},
}

func validateSchemaDefinition(schema map[string]any, root bool) error {
	for key := range schema {
		if _, ok := allowedSchemaKeywords[key]; !ok {
			return fmt.Errorf("unsupported JSON Schema keyword %q", key)
		}
	}
	typeName, ok := schema["type"].(string)
	if !ok {
		return errors.New("every schema node requires a string type")
	}
	if root && typeName != "object" {
		return errors.New("top-level schema type must be object")
	}
	switch typeName {
	case "object":
		properties, _ := schema["properties"].(map[string]any)
		for name, raw := range properties {
			child, ok := raw.(map[string]any)
			if !ok {
				return fmt.Errorf("property %q schema must be an object", name)
			}
			if err := validateSchemaDefinition(child, false); err != nil {
				return fmt.Errorf("property %q: %w", name, err)
			}
		}
		if rawRequired, exists := schema["required"]; exists {
			required, ok := rawRequired.([]any)
			if !ok {
				return errors.New("required must be an array")
			}
			seen := map[string]struct{}{}
			for _, raw := range required {
				name, ok := raw.(string)
				if !ok || name == "" {
					return errors.New("required entries must be non-empty strings")
				}
				if _, duplicate := seen[name]; duplicate {
					return fmt.Errorf("required contains duplicate %q", name)
				}
				seen[name] = struct{}{}
				if _, declared := properties[name]; !declared {
					return fmt.Errorf("required property %q is not declared", name)
				}
			}
		}
		if raw, exists := schema["additionalProperties"]; exists {
			if _, ok := raw.(bool); !ok {
				return errors.New("additionalProperties must be boolean in v1")
			}
		}
	case "array":
		items, ok := schema["items"].(map[string]any)
		if !ok {
			return errors.New("array schema requires an items object")
		}
		if err := validateSchemaDefinition(items, false); err != nil {
			return fmt.Errorf("items: %w", err)
		}
	case "string", "number", "integer", "boolean", "null":
	default:
		return fmt.Errorf("unsupported JSON Schema type %q", typeName)
	}
	return validateSchemaBounds(schema, typeName)
}

func validateSchemaBounds(schema map[string]any, typeName string) error {
	for _, key := range []string{"minLength", "maxLength", "minItems", "maxItems"} {
		if raw, exists := schema[key]; exists {
			value, ok := jsonNumberInt(raw)
			if !ok || value < 0 || value > maxRuntimeResultBytes {
				return fmt.Errorf("%s must be a bounded non-negative integer", key)
			}
		}
	}
	for _, key := range []string{"minimum", "maximum"} {
		if raw, exists := schema[key]; exists {
			if _, ok := jsonNumberFloat(raw); !ok {
				return fmt.Errorf("%s must be numeric", key)
			}
		}
	}
	if raw, exists := schema["enum"]; exists {
		values, ok := raw.([]any)
		if !ok || len(values) == 0 || len(values) > 128 {
			return errors.New("enum must contain 1-128 values")
		}
		for _, value := range values {
			if err := validateSchemaValueType(typeName, value); err != nil {
				return fmt.Errorf("enum: %w", err)
			}
		}
	}
	return nil
}

func validateToolInput(raw json.RawMessage, schemaRaw json.RawMessage) error {
	if len(raw) == 0 || len(raw) > maxRuntimeResultBytes {
		return errors.New("tool input must be a bounded JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("tool input contains trailing JSON data")
	}
	var schema map[string]any
	schemaDecoder := json.NewDecoder(bytes.NewReader(schemaRaw))
	schemaDecoder.UseNumber()
	if err := schemaDecoder.Decode(&schema); err != nil {
		return err
	}
	return validateSchemaValue(schema, value, "input")
}

func validateSchemaValue(schema map[string]any, value any, path string) error {
	typeName, _ := schema["type"].(string)
	if err := validateSchemaValueType(typeName, value); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	if enum, ok := schema["enum"].([]any); ok {
		matched := false
		encoded, _ := json.Marshal(value)
		for _, candidate := range enum {
			candidateJSON, _ := json.Marshal(candidate)
			if bytes.Equal(encoded, candidateJSON) {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("%s is not one of the allowed values", path)
		}
	}
	switch typed := value.(type) {
	case map[string]any:
		properties, _ := schema["properties"].(map[string]any)
		required, _ := schema["required"].([]any)
		for _, rawName := range required {
			name, _ := rawName.(string)
			if _, ok := typed[name]; !ok {
				return fmt.Errorf("%s.%s is required", path, name)
			}
		}
		if additional, exists := schema["additionalProperties"].(bool); exists && !additional {
			for name := range typed {
				if _, declared := properties[name]; !declared {
					return fmt.Errorf("%s.%s is not allowed", path, name)
				}
			}
		}
		names := make([]string, 0, len(typed))
		for name := range typed {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			childRaw, declared := properties[name]
			if !declared {
				continue
			}
			child, _ := childRaw.(map[string]any)
			if err := validateSchemaValue(child, typed[name], path+"."+name); err != nil {
				return err
			}
		}
	case []any:
		if minimum, ok := jsonNumberInt(schema["minItems"]); ok && int64(len(typed)) < minimum {
			return fmt.Errorf("%s has fewer than %d items", path, minimum)
		}
		if maximum, ok := jsonNumberInt(schema["maxItems"]); ok && int64(len(typed)) > maximum {
			return fmt.Errorf("%s has more than %d items", path, maximum)
		}
		items, _ := schema["items"].(map[string]any)
		for index, item := range typed {
			if err := validateSchemaValue(items, item, fmt.Sprintf("%s[%d]", path, index)); err != nil {
				return err
			}
		}
	case string:
		if minimum, ok := jsonNumberInt(schema["minLength"]); ok && int64(len([]rune(typed))) < minimum {
			return fmt.Errorf("%s is shorter than %d characters", path, minimum)
		}
		if maximum, ok := jsonNumberInt(schema["maxLength"]); ok && int64(len([]rune(typed))) > maximum {
			return fmt.Errorf("%s is longer than %d characters", path, maximum)
		}
	case json.Number:
		value, _ := typed.Float64()
		if minimum, ok := jsonNumberFloat(schema["minimum"]); ok && value < minimum {
			return fmt.Errorf("%s is below %v", path, minimum)
		}
		if maximum, ok := jsonNumberFloat(schema["maximum"]); ok && value > maximum {
			return fmt.Errorf("%s is above %v", path, maximum)
		}
	}
	return nil
}

func validateSchemaValueType(typeName string, value any) error {
	switch typeName {
	case "object":
		if _, ok := value.(map[string]any); !ok {
			return errors.New("must be an object")
		}
	case "array":
		if _, ok := value.([]any); !ok {
			return errors.New("must be an array")
		}
	case "string":
		if _, ok := value.(string); !ok {
			return errors.New("must be a string")
		}
	case "number":
		if _, ok := jsonNumberFloat(value); !ok {
			return errors.New("must be a number")
		}
	case "integer":
		number, ok := jsonNumberFloat(value)
		if !ok || math.Trunc(number) != number {
			return errors.New("must be an integer")
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return errors.New("must be a boolean")
		}
	case "null":
		if value != nil {
			return errors.New("must be null")
		}
	default:
		return fmt.Errorf("has unsupported type %q", typeName)
	}
	return nil
}

func jsonNumberFloat(value any) (float64, bool) {
	switch number := value.(type) {
	case json.Number:
		result, err := number.Float64()
		return result, err == nil
	case float64:
		return number, true
	default:
		return 0, false
	}
}

func jsonNumberInt(value any) (int64, bool) {
	switch number := value.(type) {
	case json.Number:
		result, err := number.Int64()
		return result, err == nil
	case float64:
		if math.Trunc(number) == number {
			return int64(number), true
		}
	}
	return 0, false
}
