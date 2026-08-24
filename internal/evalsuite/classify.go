package evalsuite

import "strings"

func classifyError(message string) (kind, display string) {
	text := strings.ToLower(strings.TrimSpace(message))
	switch {
	case text == "":
		return ErrorKindRuntime, "评测中断"
	case strings.Contains(text, "abort"), strings.Contains(text, "stopped"), strings.Contains(text, "canceled"), strings.Contains(text, "cancelled"):
		return ErrorKindStopped, ""
	case strings.Contains(text, "401"),
		strings.Contains(text, "403"),
		strings.Contains(text, "unauthorized"),
		strings.Contains(text, "model_not_found"),
		strings.Contains(text, "api key"),
		strings.Contains(text, "apikey"),
		strings.Contains(text, "quota"),
		strings.Contains(text, "credit"),
		strings.Contains(text, "provider"),
		strings.Contains(text, "tokenflux"),
		strings.Contains(text, "relay"):
		return ErrorKindProvider, "模型服务不可用"
	case strings.Contains(text, "timeout"),
		strings.Contains(text, "timed out"),
		strings.Contains(text, "network"),
		strings.Contains(text, "connection"),
		strings.Contains(text, "econn"),
		strings.Contains(text, "dns"),
		strings.Contains(text, "tls"),
		strings.Contains(text, "unavailable"):
		return ErrorKindNetwork, "网络中断"
	default:
		return ErrorKindRuntime, "评测中断"
	}
}
