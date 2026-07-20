package browserextension

import "embed"

//go:embed manifest.json popup.html popup.js
var Assets embed.FS
