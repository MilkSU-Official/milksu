package imagegencatalog

import "testing"

func TestIsImageModelIDUsesPrefixSuffix(t *testing.T) {
	image := []string{
		"openai-image/gpt-image-2",
		"openai-image/gpt-image-2.5-flare",
		"google-image/nano-banana-2",
		"google-image/gemini-3.1-flash-image",
		"x-ai-image/grok-imagine-image-2.0",
		"future-lab-image/some-new-model",
	}
	chat := []string{
		"openai/gpt-5.6",
		"openai/gpt-image-2",
		"google/gemini-3.8-flash-tiered",
		"x-ai/grok-4.7",
		"deepseek/deepseek-flash",
		"alibaba/qwen3.7-max",
		"grok-imagine-image-2.0",
		"",
	}
	for _, id := range image {
		if !IsImageModelID(id) {
			t.Fatalf("expected image route %q", id)
		}
	}
	for _, id := range chat {
		if IsImageModelID(id) {
			t.Fatalf("chat id classified as image: %q", id)
		}
	}
}

func TestTransportFollowsTheImagePrefix(t *testing.T) {
	if got := Transport("openai-image/gpt-image-2"); got != TransportGPTImage {
		t.Fatalf("gpt = %q", got)
	}
	if got := Transport("x-ai-image/grok-imagine-image-2.0"); got != TransportImages {
		t.Fatalf("grok = %q", got)
	}
	if got := Transport("google-image/nano-banana-2"); got != TransportGemini {
		t.Fatalf("google = %q", got)
	}
	if got := Transport("google-image/gemini-3.1-flash-image"); got != TransportGemini {
		t.Fatalf("gemini = %q", got)
	}
	if got := Transport("future-lab-image/example"); got != TransportImages {
		t.Fatalf("other image group = %q", got)
	}
	if got := Transport("openai/gpt-image-2"); got != "" {
		t.Fatalf("chat prefix = %q", got)
	}
	if got := Transport("x-ai/grok-4.7"); got != "" {
		t.Fatalf("grok chat = %q", got)
	}
}
