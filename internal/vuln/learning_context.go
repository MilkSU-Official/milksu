package vuln

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const LearningContextFileName = "LEARNING.md"

var (
	domainSecretKeyPattern    = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{12,}\b`)
	domainSecretBearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}`)
	domainSecretFlagPattern   = regexp.MustCompile(`(?i)\b(?:flag|nssctf|ctf)\{[^}\r\n]{1,512}\}`)
)

// WriteLearningContext mirrors user-saved learning records into the research
// workspace. An empty list removes the file so a stale prior does not remain.
func WriteLearningContext(workspacePath, cveID string, records []LearningRecord) error {
	workspacePath = strings.TrimSpace(workspacePath)
	if workspacePath == "" {
		return fmt.Errorf("CVE learning workspace is required")
	}
	path := filepath.Join(workspacePath, LearningContextFileName)
	if len(records) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove CVE learning context: %w", err)
		}
		return nil
	}
	ordered := append([]LearningRecord(nil), records...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].CreatedAt.Before(ordered[j].CreatedAt)
	})
	var builder strings.Builder
	id := strings.ToUpper(strings.TrimSpace(cveID))
	builder.WriteString("# ")
	if id != "" {
		builder.WriteString(id)
		builder.WriteString(" ")
	}
	builder.WriteString("已保存的学习记录\n\n")
	builder.WriteString("这些是用户在这个 CVE 上明确记下的学习记录。它们是先验，不是复现证明，也不是当前材料的事实。采用前要用公告、补丁和这次实验重新核对。\n")
	for _, record := range ordered {
		title := strings.TrimSpace(record.Concept)
		if title == "" {
			title = strings.TrimSpace(record.Kind)
		}
		if title == "" {
			title = record.ID
		}
		builder.WriteString("\n## ")
		builder.WriteString(redactDomainText(title))
		builder.WriteString("\n\n")
		builder.WriteString(redactDomainText(strings.TrimSpace(record.Content)))
		builder.WriteString("\n\n- 类型：")
		builder.WriteString(redactDomainText(strings.TrimSpace(record.Kind)))
		if !record.CreatedAt.IsZero() {
			builder.WriteString("\n- 时间：")
			builder.WriteString(record.CreatedAt.UTC().Format(time.RFC3339))
		}
		builder.WriteString("\n")
	}
	return writeDomainFile(path, []byte(builder.String()))
}

func redactDomainText(value string) string {
	value = domainSecretFlagPattern.ReplaceAllString(value, "[redacted]")
	value = domainSecretKeyPattern.ReplaceAllString(value, "[redacted]")
	value = domainSecretBearerPattern.ReplaceAllString(value, "[redacted]")
	return value
}

func writeDomainFile(path string, body []byte) error {
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("domain memory file must not be a symbolic link")
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect domain memory file: %w", err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return fmt.Errorf("write domain memory file: %w", err)
	}
	return os.Chmod(path, 0o600)
}
