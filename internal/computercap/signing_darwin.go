//go:build darwin

package computercap

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func platformSigningStatus() SigningStatus {
	executablePath, err := os.Executable()
	if err != nil {
		return SigningStatus{
			BundleID:  hostBundleID,
			Signature: "unknown",
			Problem:   "无法定位当前 MilkSU 可执行文件，不能判断 macOS 权限绑定身份。",
		}
	}
	subjectPath := signingSubjectPath(executablePath)
	status := SigningStatus{
		BundleID:       hostBundleID,
		ExecutablePath: subjectPath,
		Signature:      "unknown",
		TeamIdentifier: "unknown",
	}
	output, err := runCodesignInspect(subjectPath)
	if err != nil {
		status.Signature = "unsigned"
		status.Problem = "当前构建未能通过 codesign 检查；macOS 可能无法稳定复用辅助功能/屏幕录制授权。"
		return status
	}
	parseCodesignOutput(output, &status)
	if status.Signature == "" || status.Signature == "unknown" {
		status.Signature = "signed"
	}
	if status.TeamIdentifier == "" {
		status.TeamIdentifier = "not set"
	}
	status.StableIdentity = status.Signature != "adhoc" &&
		status.Signature != "unsigned" &&
		status.TeamIdentifier != "not set" &&
		status.TeamIdentifier != "unknown"
	if !status.StableIdentity && status.Problem == "" {
		status.Problem = "当前构建不是稳定 Developer ID 签名；系统设置里显示已勾选时，TCC 探针仍可能对当前二进制返回未授权。"
	}
	return status
}

func signingSubjectPath(executablePath string) string {
	cleaned := filepath.Clean(executablePath)
	marker := ".app/Contents/MacOS/"
	index := strings.Index(cleaned, marker)
	if index < 0 {
		return cleaned
	}
	return cleaned[:index+len(".app")]
}

func runCodesignInspect(path string) (string, error) {
	command := exec.Command("/usr/bin/codesign", "-dv", "--verbose=4", path)
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Start(); err != nil {
		return "", err
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		return output.String(), err
	case <-time.After(2 * time.Second):
		killProcess(command)
		return output.String(), os.ErrDeadlineExceeded
	}
}

func parseCodesignOutput(output string, status *SigningStatus) {
	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "Signature="):
			signature := strings.TrimSpace(strings.TrimPrefix(line, "Signature="))
			if strings.EqualFold(signature, "adhoc") {
				status.Signature = "adhoc"
			} else if signature != "" {
				status.Signature = "signed"
			}
		case strings.HasPrefix(line, "TeamIdentifier="):
			status.TeamIdentifier = strings.TrimSpace(strings.TrimPrefix(line, "TeamIdentifier="))
		}
	}
}
