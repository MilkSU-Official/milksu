// Package imagegencatalog holds the curated ImageGen model list.
//
// Chat / Coding models live in modelcatalog and must never appear here.
// ImageGen models are OpenAI-compatible Images API ids that TokenFlux (or a
// personal OpenAI-compatible relay) can route. MilkSU always calls
// /v1/images/generations or /v1/images/edits; it does not speak each vendor's
// native image protocol.
package imagegencatalog

import "strings"

const Schema = "milksu-imagegen-catalog/v1"

// Model is one curated image-generation entry shown only in the ImageGen picker.
type Model struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Vendor   string `json:"vendor"`
	Platform string `json:"platform"`
	// SupportsEdit is true when /v1/images/edits is expected to work for this id.
	SupportsEdit bool `json:"supports_edit"`
}

// Snapshot is the public ImageGen catalog payload for Settings and Desktop RPC.
type Snapshot struct {
	Schema string  `json:"schema"`
	Models []Model `json:"models"`
}

// Builtin is the product ImageGen catalog. Keep chat models out of this list.
func Builtin() Snapshot {
	return Snapshot{
		Schema: Schema,
		Models: []Model{
			{
				ID:           "openai/gpt-image-2",
				Name:         "GPT Image 2",
				Vendor:       "openai",
				Platform:     "OpenAI",
				SupportsEdit: true,
			},
			{
				ID:           "openai/gpt-image-1",
				Name:         "GPT Image 1",
				Vendor:       "openai",
				Platform:     "OpenAI",
				SupportsEdit: true,
			},
			{
				ID:           "xai/grok-imagine-image",
				Name:         "Grok Imagine",
				Vendor:       "xai",
				Platform:     "xAI",
				SupportsEdit: true,
			},
			{
				ID:           "xai/grok-imagine-image-2.0",
				Name:         "Grok Imagine 2.0",
				Vendor:       "xai",
				Platform:     "xAI",
				SupportsEdit: true,
			},
			{
				ID:           "google/imagen-4.0-generate-001",
				Name:         "Imagen 4",
				Vendor:       "google",
				Platform:     "Google",
				SupportsEdit: false,
			},
			{
				ID:           "google/imagen-3.0-generate-002",
				Name:         "Imagen 3",
				Vendor:       "google",
				Platform:     "Google",
				SupportsEdit: false,
			},
			{
				ID:           "black-forest-labs/flux-2-pro",
				Name:         "FLUX.2 Pro",
				Vendor:       "black-forest-labs",
				Platform:     "Black Forest Labs",
				SupportsEdit: false,
			},
			{
				ID:           "black-forest-labs/flux-schnell",
				Name:         "FLUX Schnell",
				Vendor:       "black-forest-labs",
				Platform:     "Black Forest Labs",
				SupportsEdit: false,
			},
			{
				ID:           "ideogram-ai/ideogram-v3",
				Name:         "Ideogram V3",
				Vendor:       "ideogram",
				Platform:     "Ideogram",
				SupportsEdit: false,
			},
			{
				ID:           "recraft-ai/recraft-v3",
				Name:         "Recraft V3",
				Vendor:       "recraft",
				Platform:     "Recraft",
				SupportsEdit: false,
			},
		},
	}
}

// Lookup returns a curated model by id (case-sensitive after trim).
func Lookup(id string) (Model, bool) {
	needle := strings.TrimSpace(id)
	if needle == "" {
		return Model{}, false
	}
	for _, model := range Builtin().Models {
		if model.ID == needle {
			return model, true
		}
	}
	return Model{}, false
}

// KnownID reports whether id is in the curated ImageGen catalog.
func KnownID(id string) bool {
	_, ok := Lookup(id)
	return ok
}
