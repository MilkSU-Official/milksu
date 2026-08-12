package userartifact

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

const DirectoryOverrideEnv = "MILKSU_USER_ARTIFACTS_DIR"

type Kind string

const (
	KindCoding Kind = "Coding"
	KindCTF    Kind = "CTF"
	KindCVE    Kind = "CVE"
)

var cveIDPattern = regexp.MustCompile(`(?i)^CVE-[0-9]{4}-[0-9]+$`)

func Directory() (string, error) {
	if override := strings.TrimSpace(os.Getenv(DirectoryOverrideEnv)); override != "" {
		return validateRoot(override)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home for MilkSU artifacts: %w", err)
	}
	return filepath.Join(home, "Documents", "MilkSU"), nil
}

func Ensure(root string) (string, error) {
	validated, err := validateRoot(root)
	if err != nil {
		return "", err
	}
	for _, directory := range []string{
		validated,
		filepath.Join(validated, string(KindCoding)),
		filepath.Join(validated, string(KindCTF)),
		filepath.Join(validated, string(KindCVE)),
	} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return "", fmt.Errorf("create MilkSU artifact directory: %w", err)
		}
		if err := os.Chmod(directory, 0o700); err != nil {
			return "", fmt.Errorf("protect MilkSU artifact directory: %w", err)
		}
	}
	return validated, nil
}

func Section(root string, kind Kind) (string, error) {
	if !validKind(kind) {
		return "", fmt.Errorf("unsupported MilkSU artifact kind %q", kind)
	}
	validated, err := Ensure(root)
	if err != nil {
		return "", err
	}
	return filepath.Join(validated, string(kind)), nil
}

func Workspace(root string, kind Kind, identity, label string) (string, error) {
	if kind != KindCoding && kind != KindCVE {
		return "", fmt.Errorf("MilkSU can only create Coding or CVE workspaces here")
	}
	identity = strings.TrimSpace(identity)
	if identity == "" {
		return "", fmt.Errorf("MilkSU artifact workspace identity is required")
	}
	section, err := Section(root, kind)
	if err != nil {
		return "", err
	}

	name := ""
	if kind == KindCVE && cveIDPattern.MatchString(strings.TrimSpace(label)) {
		name = strings.ToUpper(strings.TrimSpace(label))
	} else {
		name = slug(label)
		if name == "" {
			name = strings.ToLower(string(kind))
		}
		identityDigest := sha256.Sum256([]byte(identity))
		name += "-" + hex.EncodeToString(identityDigest[:4])
	}

	workspace := filepath.Join(section, name)
	if err := ensureWithin(section, workspace); err != nil {
		return "", err
	}
	for _, directory := range []string{workspace, filepath.Join(workspace, ".git")} {
		if info, statErr := os.Lstat(directory); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("MilkSU artifact workspace must not be a symbolic link")
		} else if statErr != nil && !os.IsNotExist(statErr) {
			return "", fmt.Errorf("inspect MilkSU artifact workspace: %w", statErr)
		}
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return "", fmt.Errorf("create MilkSU artifact workspace: %w", err)
		}
		if err := os.Chmod(directory, 0o700); err != nil {
			return "", fmt.Errorf("protect MilkSU artifact workspace: %w", err)
		}
	}
	return workspace, nil
}

func validateRoot(value string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(value))
	if clean == "." || !filepath.IsAbs(clean) {
		return "", fmt.Errorf("MilkSU artifact directory must be an absolute path")
	}
	if filepath.Dir(clean) == clean {
		return "", fmt.Errorf("MilkSU artifact directory must not be the filesystem root")
	}
	if home, err := os.UserHomeDir(); err == nil && filepath.Clean(home) == clean {
		return "", fmt.Errorf("MilkSU artifact directory must not be the user home directory")
	}
	return clean, nil
}

func validKind(kind Kind) bool {
	return kind == KindCoding || kind == KindCTF || kind == KindCVE
}

func ensureWithin(root, target string) error {
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("MilkSU artifact workspace escaped its section")
	}
	return nil
}

func slug(value string) string {
	var builder strings.Builder
	previousSeparator := false
	characterCount := 0
	for _, character := range strings.TrimSpace(value) {
		switch {
		case unicode.IsLetter(character), unicode.IsDigit(character):
			builder.WriteRune(character)
			characterCount++
			previousSeparator = false
		case character == '-', character == '_', unicode.IsSpace(character):
			if builder.Len() > 0 && !previousSeparator {
				builder.WriteByte('-')
				characterCount++
				previousSeparator = true
			}
		}
		if characterCount >= 48 {
			break
		}
	}
	return strings.Trim(builder.String(), "-")
}
