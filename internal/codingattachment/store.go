package codingattachment

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxCount      = 8
	MaxFileBytes  = 32 * 1024 * 1024
	MaxTotalBytes = 96 * 1024 * 1024
)

// Attachment is the safe, persisted reference shared by the desktop UI and
// Sidecar. The original file path and contents never enter conversation JSON.
type Attachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
}

type Store struct {
	root string
}

func NewStore(root string) (*Store, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" || !filepath.IsAbs(root) {
		return nil, fmt.Errorf("Coding attachment root must be absolute")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create Coding attachment directory: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return nil, fmt.Errorf("tighten Coding attachment directory: %w", err)
	}
	return &Store{root: root}, nil
}

func (s *Store) Import(paths []string) ([]Attachment, error) {
	if len(paths) > MaxCount {
		return nil, fmt.Errorf("一次最多添加 %d 个附件", MaxCount)
	}
	attachments := make([]Attachment, 0, len(paths))
	total := int64(0)
	for _, sourcePath := range paths {
		attachment, data, err := readSource(sourcePath)
		if err != nil {
			return nil, err
		}
		total += attachment.Size
		if total > MaxTotalBytes {
			return nil, fmt.Errorf("附件合计不能超过 96 MiB")
		}
		if err := s.persist(attachment, data); err != nil {
			return nil, err
		}
		attachments = append(attachments, attachment)
	}
	return attachments, nil
}

func readSource(sourcePath string) (Attachment, []byte, error) {
	sourcePath = strings.TrimSpace(sourcePath)
	info, err := os.Lstat(sourcePath)
	if err != nil {
		return Attachment{}, nil, fmt.Errorf("读取附件信息: %w", err)
	}
	name := filepath.Base(sourcePath)
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return Attachment{}, nil, fmt.Errorf("附件 %q 必须是普通文件，不能是链接或目录", name)
	}
	if err := validateName(name); err != nil {
		return Attachment{}, nil, err
	}
	if info.Size() <= 0 || info.Size() > MaxFileBytes {
		return Attachment{}, nil, fmt.Errorf("附件 %q 必须在 1 字节到 32 MiB 之间", name)
	}

	file, err := os.Open(sourcePath)
	if err != nil {
		return Attachment{}, nil, fmt.Errorf("打开附件 %q: %w", name, err)
	}
	openedInfo, statErr := file.Stat()
	if statErr != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) ||
		openedInfo.Size() != info.Size() {
		_ = file.Close()
		return Attachment{}, nil, fmt.Errorf("附件 %q 在读取前发生变化", name)
	}
	data, readErr := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
	closeErr := file.Close()
	if readErr != nil {
		return Attachment{}, nil, fmt.Errorf("读取附件 %q: %w", name, readErr)
	}
	if closeErr != nil {
		return Attachment{}, nil, fmt.Errorf("关闭附件 %q: %w", name, closeErr)
	}
	if len(data) == 0 || len(data) > MaxFileBytes || int64(len(data)) != info.Size() {
		return Attachment{}, nil, fmt.Errorf("附件 %q 在读取时发生变化或大小无效", name)
	}

	digest := sha256.Sum256(data)
	digestHex := hex.EncodeToString(digest[:])
	mediaType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	if mediaType == "" {
		mediaType = http.DetectContentType(data)
	}
	if separator := strings.IndexByte(mediaType, ';'); separator >= 0 {
		mediaType = mediaType[:separator]
	}
	return Attachment{
		ID:        digestHex,
		Name:      name,
		MediaType: mediaType,
		Size:      int64(len(data)),
		SHA256:    digestHex,
	}, data, nil
}

func validateName(name string) error {
	if name == "" || name == "." || name == string(filepath.Separator) ||
		len([]rune(name)) > 160 || !utf8.ValidString(name) ||
		strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return fmt.Errorf("附件文件名无效")
	}
	return nil
}

func (s *Store) persist(attachment Attachment, data []byte) error {
	directory := filepath.Join(s.root, attachment.ID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create attachment content directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("tighten attachment content directory: %w", err)
	}
	destination := filepath.Join(directory, attachment.Name)
	if existing, err := os.Lstat(destination); err == nil {
		if !existing.Mode().IsRegular() || existing.Mode()&os.ModeSymlink != 0 ||
			existing.Size() != attachment.Size {
			return fmt.Errorf("附件存储目标 %q 已存在但内容无效", attachment.Name)
		}
		existingData, readErr := os.ReadFile(destination)
		if readErr != nil {
			return fmt.Errorf("verify existing attachment %q: %w", attachment.Name, readErr)
		}
		existingDigest := sha256.Sum256(existingData)
		if hex.EncodeToString(existingDigest[:]) != attachment.SHA256 {
			return fmt.Errorf("附件存储目标 %q 的哈希不一致", attachment.Name)
		}
		return os.Chmod(destination, 0o600)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect attachment destination %q: %w", attachment.Name, err)
	}

	temporary, err := os.CreateTemp(directory, ".import-*")
	if err != nil {
		return fmt.Errorf("create attachment temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("tighten attachment temporary file: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write attachment %q: %w", attachment.Name, err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync attachment %q: %w", attachment.Name, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close attachment %q: %w", attachment.Name, err)
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		return fmt.Errorf("store attachment %q: %w", attachment.Name, err)
	}
	return nil
}
