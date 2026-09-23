// Package imagegencatalog classifies ImageGen model ids.
//
// TokenFlux composite keys use an admin-chosen prefix. MilkSU image groups
// use a prefix ending in "-image" (openai-image/, google-image/, x-ai-image/).
// Chat groups keep the prefix without that suffix (openai/, google/, x-ai/).
package imagegencatalog

import "strings"

const (
	Schema = "milksu-imagegen-catalog/v1"
	// TransportGPTImage is the OpenAI Images API with GPT Image fields.
	TransportGPTImage = "gpt-image"
	// TransportImages is the OpenAI Images API without GPT Image-only fields.
	// x-ai-image / grok-imagine uses this shape.
	TransportImages = "images-minimal"
	// TransportGemini is Gemini generateContent. google-image does not accept
	// the OpenAI Images API.
	TransportGemini = "gemini"
)

// Model is one image route projected from the live catalog for Settings and RPC.
type Model struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Vendor   string `json:"vendor"`
	Platform string `json:"platform"`
	// SupportsEdit is a request-shape hint, not an allowlist. The Images API
	// does not say which ids accept /v1/images/edits; GPT Image and Grok Imagine
	// ids do. Other image routes stay generate-only until a call proves otherwise.
	SupportsEdit bool `json:"supports_edit"`
}

// Snapshot is the ImageGen slice of the current model catalog.
type Snapshot struct {
	Schema string  `json:"schema"`
	Models []Model `json:"models"`
}

// IsImageModelID reports whether the composite-key prefix ends in "-image".
func IsImageModelID(id string) bool {
	id = strings.TrimSpace(id)
	slash := strings.IndexByte(id, '/')
	if slash <= len("-image") || slash >= len(id)-1 {
		return false
	}
	if strings.ContainsAny(id, " \t\r\n\x00") {
		return false
	}
	vendor := id[:slash]
	return strings.HasSuffix(vendor, "-image") && len(vendor) > len("-image")
}

// Transport is how to call an image id. Empty means the id is not an image route.
// google-image uses Gemini generateContent. gpt-image ids use the GPT Image
// request body. Other -image routes, including grok-imagine, use the small
// Images API body.
func Transport(id string) string {
	if !IsImageModelID(id) {
		return ""
	}
	lower := strings.ToLower(strings.TrimSpace(id))
	vendor := lower
	if slash := strings.IndexByte(lower, '/'); slash > 0 {
		vendor = lower[:slash]
	}
	switch {
	case vendor == "google-image":
		return TransportGemini
	case strings.Contains(lower, "gpt-image"):
		return TransportGPTImage
	default:
		return TransportImages
	}
}

// Describe projects one live catalog entry. Name falls back to the id.
func Describe(id, name string) Model {
	id = strings.TrimSpace(id)
	name = strings.TrimSpace(name)
	if name == "" || name == id {
		name = id
	}
	vendor := id
	if slash := strings.IndexByte(id, '/'); slash > 0 {
		vendor = id[:slash]
	}
	return Model{
		ID:           id,
		Name:         name,
		Vendor:       vendor,
		Platform:     vendor,
		SupportsEdit: SupportsEdit(id),
	}
}

// SupportsEdit reports whether this id is a GPT Image or Grok Imagine route.
func SupportsEdit(id string) bool {
	lower := strings.ToLower(strings.TrimSpace(id))
	return strings.Contains(lower, "gpt-image") || strings.Contains(lower, "grok-imagine")
}
