package labs

import "embed"

// Assets contains only fixed, reviewed training fixtures. Imported labs are
// never added to this filesystem at runtime.
//
//go:embed ctf/juice-shop/compose.yaml ctf/juice-shop/lab.sh ctf/juice-shop/lab.yaml ctf/juice-shop/LICENSE.upstream.txt ctf/juice-shop/README.md vuln/packet-parser/parser.c vuln/packet-parser/README.md
var Assets embed.FS
