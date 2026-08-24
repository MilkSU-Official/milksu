package tasks

import "embed"

//go:embed cybench
//go:embed secbench
//go:embed autopen
var FS embed.FS
