package ctf

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeTextHandlesRealNSSCTFIntroEncodingPatterns(t *testing.T) {
	capability := &Capability{}

	nested := []byte("NSSCTF{b4se64_n3st3d_l4y3rs}")
	for range 10 {
		next := make([]byte, base64.StdEncoding.EncodedLen(len(nested)))
		base64.StdEncoding.Encode(next, nested)
		nested = next
	}
	assertTextDecode(t, capability, map[string]any{
		"source": string(nested), "encoding": "auto", "maxLayers": 16,
	}, "NSSCTF{b4se64_n3st3d_l4y3rs}", "10 layer(s)")

	assertTextDecode(t, capability, map[string]any{
		"source":   "01001110 01010011 01010011 01000011 01010100 01000110 01111011 01100010 00110001 01101110 00110100 01110010 01111001 01011111 01110100 00110000 01011111 01110100 00110011 01111000 01110100 01111101",
		"encoding": "auto", "maxLayers": 4,
	}, "NSSCTF{b1n4ry_t0_t3xt}", "[binary]")

	assertTextDecode(t, capability, map[string]any{
		"source":   "-- --- .-. ... . ..--.- -.-. --- -.. . ..--.- -.. . -.-. --- -.. . -..",
		"encoding": "morse", "maxLayers": 1,
	}, "MORSE_CODE_DECODED", "[morse]")
}

func TestDecodeTextRejectsUnsupportedOrUnencodedInput(t *testing.T) {
	capability := &Capability{}
	for _, input := range []map[string]any{
		{"source": "plain text", "encoding": "auto", "maxLayers": 4},
		{"source": "abc", "encoding": "rot13", "maxLayers": 1},
		{"source": "YWJj", "encoding": "base64", "maxLayers": 21},
	} {
		encoded, _ := json.Marshal(input)
		if _, err := capability.decodeText(encoded); err == nil {
			t.Fatalf("invalid decode input was accepted: %#v", input)
		}
	}
}

func TestDecodeTextEffectDoesNotLeakSourceIntoIdempotencyKey(t *testing.T) {
	capability := &Capability{}
	const source = "U0VDUkVUe25vdF9pbl9lZmZlY3Rfa2V5fQ=="
	input, _ := json.Marshal(map[string]any{
		"source": source, "encoding": "base64", "maxLayers": 1,
	})
	effect, err := capability.EffectSpec("ctf.decode_text", input)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(effect.IdempotencyKey, source) || !strings.HasPrefix(effect.IdempotencyKey, "ctf.decode-text:") {
		t.Fatalf("unexpected decode idempotency key: %q", effect.IdempotencyKey)
	}
}

func assertTextDecode(t *testing.T, capability *Capability, input map[string]any, expected, summaryPart string) {
	t.Helper()
	encoded, _ := json.Marshal(input)
	result, err := capability.decodeText(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Artifacts) != 1 || string(result.Artifacts[0].Data) != expected {
		t.Fatalf("unexpected decode result: %#v", result)
	}
	if !strings.Contains(result.Summary, summaryPart) || !strings.Contains(result.Summary, expected) {
		t.Fatalf("decode summary is missing provenance or output: %q", result.Summary)
	}
}
