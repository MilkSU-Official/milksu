package labs

import "embed"

// Assets contains only fixed, reviewed training fixtures. Imported labs are
// never added to this filesystem at runtime.
//
//go:embed vuln/packet-parser/parser.c vuln/packet-parser/README.md
var Assets embed.FS
