package lab

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const JobContextFileName = "TASK.md"

var (
	jobSecretKeyPattern    = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{12,}\b`)
	jobSecretBearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}`)
	jobSecretFlagPattern   = regexp.MustCompile(`(?i)\b(?:flag|nssctf|ctf)\{[^}\r\n]{1,512}\}`)
)

// WriteJobContext mirrors the lab job the user already saved into the job
// workspace. The next session reads this request; report.md stays the result.
func WriteJobContext(workspacePath string, job Job) error {
	workspacePath = strings.TrimSpace(workspacePath)
	if workspacePath == "" {
		return fmt.Errorf("lab job workspace is required")
	}
	normalized, err := normalizeJob(job)
	if err != nil {
		return err
	}
	scope := "远程"
	if normalized.Scope == "local" {
		scope = "本机"
	}
	var builder strings.Builder
	builder.WriteString("# ")
	builder.WriteString(redactJobText(normalized.Title))
	builder.WriteString("\n\n范围：")
	builder.WriteString(scope)
	builder.WriteString("\n\n要求：")
	builder.WriteString(redactJobText(normalized.Request))
	builder.WriteString("\n\n这是用户给这次实验室作业的要求。观察和结果写在 report.md。它不是已确认的发现。\n")
	return writeJobFile(filepath.Join(workspacePath, JobContextFileName), []byte(builder.String()))
}

func redactJobText(value string) string {
	value = jobSecretFlagPattern.ReplaceAllString(value, "[redacted]")
	value = jobSecretKeyPattern.ReplaceAllString(value, "[redacted]")
	value = jobSecretBearerPattern.ReplaceAllString(value, "[redacted]")
	return value
}

func writeJobFile(path string, body []byte) error {
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("lab job context must not be a symbolic link")
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect lab job context: %w", err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return fmt.Errorf("write lab job context: %w", err)
	}
	return os.Chmod(path, 0o600)
}
