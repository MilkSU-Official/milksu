package ctf

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const CapabilityName = "ctf.core"

type Runtime interface {
	GetJob(context.Context, string) (securityruntime.JobProjection, error)
	ReadArtifact(context.Context, securityruntime.Artifact) ([]byte, error)
}

type Capability struct {
	runtime Runtime
}

type CapabilityResult struct {
	Summary             string
	MediaType           string
	Complete            bool
	ExistingArtifactIDs []string
	Artifacts           []securityruntime.ArtifactDraft
	Candidate           bool
}

func NewCapability(runtime Runtime) *Capability {
	return &Capability{runtime: runtime}
}

func (c *Capability) EffectSpec(actionName string, input json.RawMessage) (securityruntime.EffectSpec, error) {
	switch actionName {
	case "ctf.inspect_material":
		var value struct {
			MaterialID string `json:"materialId"`
		}
		if err := json.Unmarshal(input, &value); err != nil || value.MaterialID == "" {
			return securityruntime.EffectSpec{}, fmt.Errorf("inspect_material requires materialId")
		}
		return securityruntime.EffectSpec{
			Class: "read_only", IdempotencyKey: "ctf.inspect:" + value.MaterialID,
			Cleanup: "none", Approval: "not-required: user-admitted material",
			ScopeCheck: "artifact must belong to the current Job",
		}, nil
	case "ctf.decode_hex":
		var value struct {
			ArtifactID string `json:"artifactId"`
		}
		if err := json.Unmarshal(input, &value); err != nil || value.ArtifactID == "" {
			return securityruntime.EffectSpec{}, fmt.Errorf("decode_hex requires artifactId")
		}
		return securityruntime.EffectSpec{
			Class: "local_file.create", IdempotencyKey: "ctf.decode-hex:" + value.ArtifactID,
			Cleanup: "retain with challenge evidence", Approval: "not-required: app-private artifact directory",
			ScopeCheck: "source artifact must belong to the current Job",
		}, nil
	case "ctf.decode_text":
		value, err := decodeTextInput(input)
		if err != nil {
			return securityruntime.EffectSpec{}, err
		}
		fingerprint := sha256.Sum256([]byte(value.Encoding + "\x00" + strconv.Itoa(value.MaxLayers) + "\x00" + value.Source))
		return securityruntime.EffectSpec{
			Class: "local_file.create", IdempotencyKey: "ctf.decode-text:" + hex.EncodeToString(fingerprint[:]),
			Cleanup: "retain with challenge evidence", Approval: "not-required: deterministic local text transform",
			ScopeCheck: "input is bounded text already present in the admitted challenge or its observations",
		}, nil
	case "ctf.submit_flag":
		var value struct {
			Candidate   string `json:"candidate"`
			Explanation string `json:"explanation"`
		}
		if err := json.Unmarshal(input, &value); err != nil || strings.TrimSpace(value.Candidate) == "" || strings.TrimSpace(value.Explanation) == "" {
			return securityruntime.EffectSpec{}, fmt.Errorf("submit_flag requires candidate and evidence explanation")
		}
		if len([]rune(value.Candidate)) > 512 || len([]rune(value.Explanation)) > 2000 {
			return securityruntime.EffectSpec{}, fmt.Errorf("submit_flag candidate or explanation is too long")
		}
		return securityruntime.EffectSpec{
			Class: "local_submission.record", IdempotencyKey: "ctf.submit:" + strings.TrimSpace(value.Candidate),
			Cleanup: "retain with judge evidence", Approval: "not-required: local judge only",
			ScopeCheck: "submission is evaluated only by this Job's local judge",
		}, nil
	case "ctf.coach_hint":
		var value struct {
			Hint     string `json:"hint"`
			Concept  string `json:"concept"`
			Question string `json:"question"`
			Level    int    `json:"level"`
		}
		if err := json.Unmarshal(input, &value); err != nil || strings.TrimSpace(value.Hint) == "" || strings.TrimSpace(value.Question) == "" || value.Level < 1 || value.Level > 3 {
			return securityruntime.EffectSpec{}, fmt.Errorf("coach_hint requires a hint, guiding question, and level 1-3")
		}
		return securityruntime.EffectSpec{
			Class: "learning.record", IdempotencyKey: fmt.Sprintf("ctf.hint:%d:%s", value.Level, strings.TrimSpace(value.Concept)),
			Cleanup: "retain with human outcome", Approval: "not-required: explanatory learning record",
			ScopeCheck: "hint may reference only evidence in the current Job",
		}, nil
	default:
		return securityruntime.EffectSpec{}, fmt.Errorf("unsupported CTF action %q", actionName)
	}
}

func (c *Capability) Execute(ctx context.Context, jobID string, action securityruntime.Action) (CapabilityResult, error) {
	projection, err := c.runtime.GetJob(ctx, jobID)
	if err != nil {
		return CapabilityResult{}, err
	}
	switch action.Name {
	case "ctf.inspect_material":
		return c.inspectMaterial(ctx, projection, action.Input)
	case "ctf.decode_hex":
		return c.decodeHex(ctx, projection, action.Input)
	case "ctf.decode_text":
		return c.decodeText(action.Input)
	case "ctf.submit_flag":
		return c.submitFlag(action.Input)
	case "ctf.coach_hint":
		return c.coachHint(action.Input)
	default:
		return CapabilityResult{}, fmt.Errorf("unsupported CTF action %q", action.Name)
	}
}

type textDecodeInput struct {
	Source    string `json:"source"`
	Encoding  string `json:"encoding"`
	MaxLayers int    `json:"maxLayers"`
}

func decodeTextInput(input json.RawMessage) (textDecodeInput, error) {
	var value textDecodeInput
	if err := json.Unmarshal(input, &value); err != nil {
		return textDecodeInput{}, fmt.Errorf("decode text input: %w", err)
	}
	value.Source = strings.TrimSpace(value.Source)
	value.Encoding = strings.ToLower(strings.TrimSpace(value.Encoding))
	if value.Source == "" || len([]rune(value.Source)) > 65_536 {
		return textDecodeInput{}, fmt.Errorf("decode_text source is required and must be at most 65536 characters")
	}
	switch value.Encoding {
	case "auto", "base64", "hex", "binary", "morse", "url":
	default:
		return textDecodeInput{}, fmt.Errorf("decode_text uses an unsupported encoding %q", value.Encoding)
	}
	if value.MaxLayers < 1 || value.MaxLayers > 20 {
		return textDecodeInput{}, fmt.Errorf("decode_text maxLayers must be between 1 and 20")
	}
	return value, nil
}

func (c *Capability) decodeText(input json.RawMessage) (CapabilityResult, error) {
	value, err := decodeTextInput(input)
	if err != nil {
		return CapabilityResult{}, err
	}
	decoded := []byte(value.Source)
	applied := make([]string, 0, value.MaxLayers)
	for layer := 0; layer < value.MaxLayers; layer++ {
		var next []byte
		var used string
		if value.Encoding == "auto" {
			next, used, err = decodeDetectedText(decoded)
		} else {
			next, err = decodeTextLayer(decoded, value.Encoding)
			used = value.Encoding
		}
		if err != nil {
			if layer == 0 {
				return CapabilityResult{}, err
			}
			break
		}
		decoded = next
		applied = append(applied, used)
		if value.Encoding != "auto" && value.MaxLayers == 1 {
			break
		}
	}
	if len(applied) == 0 {
		return CapabilityResult{}, fmt.Errorf("decode_text could not detect a supported encoding")
	}
	mediaType := "application/octet-stream"
	if utf8.Valid(decoded) {
		mediaType = "text/plain; charset=utf-8"
	}
	return CapabilityResult{
		Summary: fmt.Sprintf(
			"Text decode applied %d layer(s) [%s] and produced %d bytes:\n%s",
			len(applied), strings.Join(applied, " → "), len(decoded), describeBytes(decoded),
		),
		MediaType: "application/vnd.milksu.ctf-observation+json", Complete: true,
		Artifacts: []securityruntime.ArtifactDraft{{MediaType: mediaType, Data: decoded}},
	}, nil
}

func decodeDetectedText(source []byte) ([]byte, string, error) {
	value := strings.TrimSpace(string(source))
	for _, encoding := range []string{"binary", "morse", "hex", "base64", "url"} {
		decoded, err := decodeTextLayer([]byte(value), encoding)
		if err == nil {
			return decoded, encoding, nil
		}
	}
	return nil, "", fmt.Errorf("text does not match a supported deterministic encoding")
}

func decodeTextLayer(source []byte, encoding string) ([]byte, error) {
	value := strings.TrimSpace(string(source))
	switch encoding {
	case "base64":
		compact := strings.Map(removeASCIIWhitespace, value)
		for _, codec := range []*base64.Encoding{
			base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding,
		} {
			decoded, err := codec.DecodeString(compact)
			if err == nil && len(decoded) > 0 {
				return decoded, nil
			}
		}
		return nil, fmt.Errorf("text is not valid Base64")
	case "hex":
		compact := strings.Map(removeASCIIWhitespace, value)
		if compact == "" || len(compact)%2 != 0 {
			return nil, fmt.Errorf("text is not valid hexadecimal")
		}
		decoded, err := hex.DecodeString(compact)
		if err != nil || len(decoded) == 0 {
			return nil, fmt.Errorf("text is not valid hexadecimal")
		}
		return decoded, nil
	case "binary":
		compact := strings.Map(removeASCIIWhitespace, value)
		if compact == "" || len(compact)%8 != 0 || strings.Trim(compact, "01") != "" {
			return nil, fmt.Errorf("text is not an 8-bit binary sequence")
		}
		decoded := make([]byte, len(compact)/8)
		for index := range decoded {
			number, err := strconv.ParseUint(compact[index*8:(index+1)*8], 2, 8)
			if err != nil {
				return nil, fmt.Errorf("text is not an 8-bit binary sequence")
			}
			decoded[index] = byte(number)
		}
		return decoded, nil
	case "morse":
		return decodeMorse(value)
	case "url":
		if !strings.Contains(value, "%") {
			return nil, fmt.Errorf("text does not contain URL escapes")
		}
		decoded, err := url.QueryUnescape(value)
		if err != nil || decoded == value {
			return nil, fmt.Errorf("text is not valid URL encoding")
		}
		return []byte(decoded), nil
	default:
		return nil, fmt.Errorf("unsupported text encoding %q", encoding)
	}
}

func removeASCIIWhitespace(value rune) rune {
	switch value {
	case ' ', '\n', '\r', '\t':
		return -1
	default:
		return value
	}
}

func decodeMorse(value string) ([]byte, error) {
	morse := map[string]string{
		".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F",
		"--.": "G", "....": "H", "..": "I", ".---": "J", "-.-": "K", ".-..": "L",
		"--": "M", "-.": "N", "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R",
		"...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X",
		"-.--": "Y", "--..": "Z",
		"-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4",
		".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
		"..--.-": "_", ".-.-.-": ".", "--..--": ",", "---...": ":", "-....-": "-",
		"-..-.": "/", ".--.-.": "@", "-.-.--": "!", "..--..": "?",
	}
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return nil, fmt.Errorf("text is not Morse code")
	}
	var result strings.Builder
	for _, field := range fields {
		if field == "/" {
			result.WriteByte(' ')
			continue
		}
		letter, ok := morse[field]
		if !ok {
			return nil, fmt.Errorf("unknown Morse token %q", field)
		}
		result.WriteString(letter)
	}
	if result.Len() == 0 {
		return nil, fmt.Errorf("text is not Morse code")
	}
	return []byte(result.String()), nil
}

func (c *Capability) coachHint(input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		Hint     string `json:"hint"`
		Concept  string `json:"concept"`
		Question string `json:"question"`
		Level    int    `json:"level"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, err
	}
	value.Hint = strings.TrimSpace(value.Hint)
	value.Concept = strings.TrimSpace(value.Concept)
	value.Question = strings.TrimSpace(value.Question)
	if value.Hint == "" || value.Question == "" || value.Level < 1 || value.Level > 3 || len([]rune(value.Hint))+len([]rune(value.Question)) > 3000 {
		return CapabilityResult{}, fmt.Errorf("invalid coach hint")
	}
	data, _ := json.Marshal(value)
	return CapabilityResult{
		Summary:   fmt.Sprintf("第 %d 级提示（%s）：%s\n引导问题：%s", value.Level, value.Concept, value.Hint, value.Question),
		MediaType: "application/vnd.milksu.learning-hint+json", Complete: true,
		Artifacts: []securityruntime.ArtifactDraft{{MediaType: "application/json", Data: data}},
	}, nil
}

func (c *Capability) inspectMaterial(ctx context.Context, projection securityruntime.JobProjection, input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		MaterialID string `json:"materialId"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, fmt.Errorf("decode inspect input: %w", err)
	}
	artifact, ok := findArtifact(projection, value.MaterialID)
	if !ok || artifact.SourceActionID != "" {
		return CapabilityResult{}, fmt.Errorf("material is not an admitted Job artifact")
	}
	data, err := c.runtime.ReadArtifact(ctx, artifact)
	if err != nil {
		return CapabilityResult{}, err
	}
	summary := describeBytes(data)
	return CapabilityResult{
		Summary:   fmt.Sprintf("Material %s (%s, %d bytes):\n%s", artifact.ID, artifact.MediaType, len(data), summary),
		MediaType: "application/vnd.milksu.ctf-observation+json", Complete: true,
		ExistingArtifactIDs: []string{artifact.ID},
	}, nil
}

func (c *Capability) decodeHex(ctx context.Context, projection securityruntime.JobProjection, input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		ArtifactID string `json:"artifactId"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, fmt.Errorf("decode hex input: %w", err)
	}
	artifact, ok := findArtifact(projection, value.ArtifactID)
	if !ok {
		return CapabilityResult{}, fmt.Errorf("source artifact does not belong to the current Job")
	}
	data, err := c.runtime.ReadArtifact(ctx, artifact)
	if err != nil {
		return CapabilityResult{}, err
	}
	compact := strings.Map(func(value rune) rune {
		if value == ' ' || value == '\n' || value == '\r' || value == '\t' {
			return -1
		}
		return value
	}, string(data))
	if len(compact) == 0 || len(compact) > maxMaterialBytes*2 {
		return CapabilityResult{}, fmt.Errorf("hex input is empty or too large")
	}
	decoded, err := hex.DecodeString(compact)
	if err != nil {
		return CapabilityResult{}, fmt.Errorf("material is not valid hexadecimal: %w", err)
	}
	mediaType := "application/octet-stream"
	if utf8.Valid(decoded) {
		mediaType = "text/plain; charset=utf-8"
	}
	return CapabilityResult{
		Summary:   fmt.Sprintf("Hex decode produced %d bytes:\n%s", len(decoded), describeBytes(decoded)),
		MediaType: "application/vnd.milksu.ctf-observation+json", Complete: true,
		ExistingArtifactIDs: []string{artifact.ID},
		Artifacts:           []securityruntime.ArtifactDraft{{MediaType: mediaType, Data: decoded}},
	}, nil
}

func (c *Capability) submitFlag(input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		Candidate   string `json:"candidate"`
		Explanation string `json:"explanation"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, fmt.Errorf("decode flag submission: %w", err)
	}
	candidate := strings.TrimSpace(value.Candidate)
	explanation := strings.TrimSpace(value.Explanation)
	if candidate == "" || len([]rune(candidate)) > 512 || explanation == "" || len([]rune(explanation)) > 2000 {
		return CapabilityResult{}, fmt.Errorf("flag candidate or evidence explanation is empty or too long")
	}
	summary := "Flag candidate was committed for independent evaluation: " + explanation
	return CapabilityResult{
		Summary: summary, MediaType: "application/vnd.milksu.ctf-submission+json", Complete: true,
		Artifacts: []securityruntime.ArtifactDraft{{MediaType: "text/plain; charset=utf-8", Data: []byte(candidate)}},
		Candidate: true,
	}, nil
}

func findArtifact(projection securityruntime.JobProjection, id string) (securityruntime.Artifact, bool) {
	for _, artifact := range projection.Artifacts {
		if artifact.ID == id {
			return artifact, true
		}
	}
	return securityruntime.Artifact{}, false
}

func describeBytes(data []byte) string {
	const limit = 64 * 1024
	truncated := len(data) > limit
	if truncated {
		data = data[:limit]
	}
	var value string
	if utf8.Valid(data) {
		value = string(data)
	} else {
		value = hex.EncodeToString(data)
	}
	if truncated {
		value += "\n[truncated by M2-A material preview]"
	}
	return value
}
