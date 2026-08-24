package plugin

import (
	"strings"
	"testing"
)

func TestFilePathURLMatchesNodeTildeEncoding(t *testing.T) {
	value := filePathURL(`C:\Users\HANKAE~1\plugin\main.mjs`)
	if strings.Contains(value, "~") || !strings.Contains(value, "HANKAE%7E1") {
		t.Fatalf("filePathURL did not match Node pathToFileURL tilde encoding: %q", value)
	}
}
