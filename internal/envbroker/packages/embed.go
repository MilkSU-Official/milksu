package packages

import "embed"

//go:embed juice-shop/compose.yaml whoami/compose.yaml webgoat/compose.yaml struts2-s2-045/compose.yaml
var FS embed.FS
