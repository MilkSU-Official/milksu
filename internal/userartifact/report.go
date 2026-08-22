package userartifact

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const ReportFileName = "report.md"
const RelatedFileName = "related.md"

func SeedRelated(workspace, cveID string) error {
	workspace = strings.TrimSpace(workspace)
	if workspace == "" {
		return fmt.Errorf("MilkSU related-CVE workspace is required")
	}
	path := filepath.Join(workspace, RelatedFileName)
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("MilkSU related CVE file must not be a symbolic link")
		}
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect MilkSU related CVE file: %w", err)
	}
	id := strings.TrimSpace(cveID)
	heading := "关联 CVE"
	if id != "" {
		heading = "关联 CVE · " + id
	}
	body := "# " + heading + "\n\n## 上游\n\n## 下游\n\n## 同类\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		return fmt.Errorf("write MilkSU related CVE file: %w", err)
	}
	return nil
}

func SeedReport(workspace, heading string) error {
	workspace = strings.TrimSpace(workspace)
	if workspace == "" {
		return fmt.Errorf("MilkSU report workspace is required")
	}
	path := filepath.Join(workspace, ReportFileName)
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("MilkSU report must not be a symbolic link")
		}
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect MilkSU report: %w", err)
	}
	title := strings.TrimSpace(heading)
	if title == "" {
		title = "报告"
	}
	body := "# " + title + "\n\n## 摘要\n\n## 环境\n\n## 进程\n\n## 网络\n\n## 步骤\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		return fmt.Errorf("write MilkSU report: %w", err)
	}
	return nil
}
