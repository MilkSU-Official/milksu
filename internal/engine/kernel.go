package engine

import "strings"

const (
	KernelPi  = "pi"
	KernelDSH = "dsh"
)

func NormalizeKernel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case KernelDSH, "deepseek", "deepseek-harness":
		return KernelDSH
	default:
		return KernelPi
	}
}
