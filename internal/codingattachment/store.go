package codingattachment

import (
	"crypto/sha256"
	"encoding/base64"
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

// ImportPayload is the bounded renderer-to-Desktop representation used for
// clipboard and drag/drop files that do not have a stable local path.
type ImportPayload struct {
	Name       string `json:"name"`
	MediaType  string `json:"mediaType"`
	DataBase64 string `json:"dataBase64"`
}

type Preview struct {
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
	Kind      string `json:"kind"`
	DataURL   string `json:"dataUrl,omitempty"`
	Text      string `json:"text,omitempty"`
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

// prepareImportedData 是**所有入口**共用的“导入前准备”：把 iPhone 的 HEIC 照片换成 PNG
// （只换容器，像素尺寸不变；磁盘上那张原图不动，库里只存一份副本）。
//
// 两条入口都要走它：文件选择器（Store.Import）与把字节交进来的那条（Store.ImportPayloads）——
// 以前只有后者转，读者从选择器添加 HEIC 时会原样落库、发不出去。
func prepareImportedData(name, mediaType string, data []byte) (string, string, []byte, error) {
	if !LooksLikeHEIC(data) && !IsHEIFMediaType(mediaType) {
		return name, mediaType, data, nil
	}
	converted, convertErr := ConvertHEICToPNG(data, nil)
	if convertErr != nil {
		// 诚实告知是哪张、为什么——不静默丢弃，也不偷偷发一张坏图。
		return name, mediaType, data, fmt.Errorf("附件 %q 是 HEIC/HEIF 照片，无法在本机转成 PNG：%v", name, convertErr)
	}
	return PNGNameFor(name), "image/png", converted, nil
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

func (s *Store) ImportPayloads(payloads []ImportPayload) ([]Attachment, error) {
	if len(payloads) > MaxCount {
		return nil, fmt.Errorf("一次最多添加 %d 个附件", MaxCount)
	}
	attachments := make([]Attachment, 0, len(payloads))
	total := int64(0)
	for _, payload := range payloads {
		if base64.StdEncoding.DecodedLen(len(payload.DataBase64)) > MaxFileBytes {
			return nil, fmt.Errorf("附件 %q 必须在 1 字节到 32 MiB 之间", payload.Name)
		}
		data, err := base64.StdEncoding.DecodeString(payload.DataBase64)
		if err != nil {
			return nil, fmt.Errorf("附件 %q 的数据无效", payload.Name)
		}
		name := payload.Name
		mediaType := payload.MediaType
		// 所有入口共用同一套准备（HEIC ⇒ PNG），见 prepareImportedData——
		// 以前只有这条入口会转，从文件选择器进来的 HEIC 会原样落库。
		name, mediaType, data, prepErr := prepareImportedData(name, payload.MediaType, data)
		if prepErr != nil {
			return nil, prepErr
		}
		attachment, err := attachmentFromData(name, mediaType, data)
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

	// 选择器进来的文件同样要准备（HEIC ⇒ PNG），否则它会原样落库、发不出去。

	name, mediaType, data, prepErr := prepareImportedData(name, "", data)

	if prepErr != nil {

		return Attachment{}, nil, prepErr

	}

	attachment, err := attachmentFromData(name, mediaType, data)
	return attachment, data, err
}

func attachmentFromData(name, declaredMediaType string, data []byte) (Attachment, error) {
	if err := validateName(name); err != nil {
		return Attachment{}, err
	}
	if len(data) == 0 || len(data) > MaxFileBytes {
		return Attachment{}, fmt.Errorf("附件 %q 必须在 1 字节到 32 MiB 之间", name)
	}
	digest := sha256.Sum256(data)
	digestHex := hex.EncodeToString(digest[:])
	return Attachment{
		ID:        digestHex,
		Name:      name,
		MediaType: resolveAttachmentMediaType(name, declaredMediaType, data),
		Size:      int64(len(data)),
		SHA256:    digestHex,
	}, nil
}

func resolveAttachmentMediaType(name, declaredMediaType string, data []byte) string {
	detected := strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	if separator := strings.IndexByte(detected, ';'); separator >= 0 {
		detected = detected[:separator]
	}
	if strings.HasPrefix(detected, "image/") {
		return detected
	}
	mediaType := strings.TrimSpace(strings.ToLower(declaredMediaType))
	if parsed, _, err := mime.ParseMediaType(mediaType); err == nil {
		mediaType = parsed
	} else {
		mediaType = ""
	}
	if mediaType == "" {
		mediaType = mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	}
	if mediaType == "" {
		mediaType = detected
	}
	if separator := strings.IndexByte(mediaType, ';'); separator >= 0 {
		mediaType = mediaType[:separator]
	}
	return mediaType
}

func (s *Store) Preview(attachment Attachment) (Preview, error) {
	data, err := s.read(attachment)
	if err != nil {
		return Preview{}, err
	}
	mediaType := resolveAttachmentMediaType(attachment.Name, attachment.MediaType, data)
	preview := Preview{
		Name: attachment.Name, MediaType: mediaType,
		Size: int64(len(data)), Kind: "metadata",
	}
	if strings.HasPrefix(mediaType, "image/") && len(data) <= 12*1024*1024 {
		preview.Kind = "image"
		preview.DataURL = "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data)
		return preview, nil
	}
	if (strings.HasPrefix(mediaType, "text/") ||
		strings.Contains(mediaType, "json") ||
		strings.Contains(mediaType, "xml")) && len(data) <= 1024*1024 && utf8.Valid(data) {
		preview.Kind = "text"
		preview.Text = string(data)
	}
	return preview, nil
}

func (s *Store) read(attachment Attachment) ([]byte, error) {
	if len(attachment.ID) != sha256.Size*2 || attachment.ID != attachment.SHA256 {
		return nil, fmt.Errorf("附件元数据无效")
	}
	if _, err := hex.DecodeString(attachment.ID); err != nil {
		return nil, fmt.Errorf("附件元数据无效")
	}
	if err := validateName(attachment.Name); err != nil {
		return nil, err
	}
	path := filepath.Join(s.root, attachment.ID, attachment.Name)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("附件 %q 不可用", attachment.Name)
	}
	if attachment.Size != 0 && info.Size() != attachment.Size {
		return nil, fmt.Errorf("附件 %q 不可用", attachment.Name)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取附件 %q: %w", attachment.Name, err)
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != attachment.SHA256 {
		return nil, fmt.Errorf("附件 %q 完整性校验失败", attachment.Name)
	}
	return data, nil
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
