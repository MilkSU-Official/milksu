package conversation

import "strings"

const (
	KernelPi  = "pi"
	KernelDSH = "dsh"
)

// NormalizeKernel maps persisted / client values onto the two supported
// runtimes. Empty, unknown, or legacy records become Pi.
func NormalizeKernel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case KernelDSH, "deepseek", "deepseek-harness":
		return KernelDSH
	default:
		return KernelPi
	}
}

// HasStarted reports whether the conversation already has a real user turn.
// Queued steer text does not lock the kernel.
func HasStarted(value StoredConversation) bool {
	for _, message := range value.Messages {
		if message.Role != "user" {
			continue
		}
		if message.Status != nil && strings.TrimSpace(*message.Status) == "queued" {
			continue
		}
		return true
	}
	return false
}
