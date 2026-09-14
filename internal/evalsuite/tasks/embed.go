package tasks

import "embed"

//go:embed cybench
//go:embed secbench
//go:embed autopen
//go:embed frontier
//go:embed cybergym
var FS embed.FS
