package browserextension

import "embed"

//go:embed manifest.json popup.html popup.js background.js
var Assets embed.FS
