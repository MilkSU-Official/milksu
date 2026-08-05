package ctf

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxArchiveEntries                = 2048
	maxArchiveScanBytes        int64 = 64 * 1024 * 1024
	maxArchiveExpandedBytes          = 128 * 1024 * 1024
	suspiciousCompressionRatio       = 100
	maxInspectionWarnings            = 16
)

type AgentMaterialInspection struct {
	DetectedType      string   `json:"detectedType"`
	ArchiveFormat     string   `json:"archiveFormat,omitempty"`
	EntryCount        int      `json:"entryCount,omitempty"`
	UncompressedBytes int64    `json:"uncompressedBytes,omitempty"`
	ReviewRequired    bool     `json:"reviewRequired"`
	Warnings          []string `json:"warnings"`
}

func inspectAgentMaterial(name, declaredMediaType string, data []byte) AgentMaterialInspection {
	inspection := AgentMaterialInspection{
		DetectedType: detectMaterialType(data),
		Warnings:     []string{},
	}
	switch inspection.DetectedType {
	case "zip":
		inspection.ArchiveFormat = "zip"
		inspectZIPMaterial(data, &inspection)
	case "tar":
		inspection.ArchiveFormat = "tar"
		inspectTARMaterial(bytes.NewReader(data), &inspection)
	case "gzip":
		inspection.ArchiveFormat = "gzip"
		inspectGZIPMaterial(data, &inspection)
	}
	if warning := mediaTypeMismatchWarning(name, declaredMediaType, inspection.DetectedType); warning != "" {
		addInspectionWarning(&inspection, warning)
	}
	inspection.ReviewRequired = len(inspection.Warnings) > 0
	return inspection
}

func detectMaterialType(data []byte) string {
	switch {
	case len(data) >= 4 &&
		(bytes.Equal(data[:4], []byte{'P', 'K', 3, 4}) ||
			bytes.Equal(data[:4], []byte{'P', 'K', 5, 6}) ||
			bytes.Equal(data[:4], []byte{'P', 'K', 7, 8})):
		return "zip"
	case len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b:
		return "gzip"
	case len(data) >= 265 && string(data[257:262]) == "ustar":
		return "tar"
	case len(data) >= 4 && bytes.Equal(data[:4], []byte{0x7f, 'E', 'L', 'F'}):
		return "elf"
	case len(data) >= 2 && bytes.Equal(data[:2], []byte{'M', 'Z'}):
		return "pe"
	case len(data) >= 5 && bytes.Equal(data[:5], []byte("%PDF-")):
		return "pdf"
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}):
		return "png"
	case looksLikeText(data):
		return "text"
	default:
		return "binary"
	}
}

func looksLikeText(data []byte) bool {
	if !utf8.Valid(data) {
		return false
	}
	for _, value := range string(data) {
		if value == 0 || unicode.IsControl(value) &&
			value != '\n' && value != '\r' && value != '\t' {
			return false
		}
	}
	return true
}

func inspectZIPMaterial(data []byte, inspection *AgentMaterialInspection) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		addInspectionWarning(inspection, "ZIP 目录损坏或无法解析")
		return
	}
	if len(reader.File) > maxArchiveEntries {
		addInspectionWarning(
			inspection,
			fmt.Sprintf("归档包含 %d 个条目，超过 %d 个预检上限", len(reader.File), maxArchiveEntries),
		)
	}
	for index, file := range reader.File {
		if index >= maxArchiveEntries {
			break
		}
		inspection.EntryCount++
		if file.UncompressedSize64 > uint64(^uint64(0)>>1) {
			addInspectionWarning(inspection, "归档条目声明了无法表示的展开大小")
			continue
		}
		addUncompressedBytes(inspection, int64(file.UncompressedSize64))
		inspectArchiveEntry(file.Name, file.Mode()&0o111 != 0, file.Mode()&0o170000 == 0o120000, inspection)
		if file.Flags&0x1 != 0 {
			addInspectionWarning(inspection, "归档包含加密条目，Agent 无法在预检阶段核验内容")
		}
		if file.CompressedSize64 > 0 &&
			file.UncompressedSize64 > 1024*1024 &&
			file.UncompressedSize64/file.CompressedSize64 > suspiciousCompressionRatio {
			addInspectionWarning(inspection, "归档包含异常高压缩比条目，可能导致资源耗尽")
		}
	}
	appendArchiveSizeWarning(inspection)
}

func inspectGZIPMaterial(data []byte, inspection *AgentMaterialInspection) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		addInspectionWarning(inspection, "Gzip 数据损坏或无法解析")
		return
	}
	defer reader.Close()
	limited := &io.LimitedReader{R: reader, N: maxArchiveScanBytes + 1}
	buffer, err := io.ReadAll(limited)
	if err != nil {
		addInspectionWarning(inspection, "Gzip 预检读取失败")
		return
	}
	if int64(len(buffer)) > maxArchiveScanBytes {
		inspection.UncompressedBytes = int64(len(buffer))
		addInspectionWarning(
			inspection,
			fmt.Sprintf("Gzip 展开数据超过 %d MiB 预检上限", maxArchiveScanBytes/(1024*1024)),
		)
		return
	}
	inspection.UncompressedBytes = int64(len(buffer))
	if detectMaterialType(buffer) != "tar" {
		if int64(len(buffer)) > int64(len(data))*suspiciousCompressionRatio && len(buffer) > 1024*1024 {
			addInspectionWarning(inspection, "Gzip 数据压缩比异常高，需要在隔离环境中解压")
		}
		return
	}
	inspection.ArchiveFormat = "tar.gz"
	inspection.EntryCount = 0
	inspection.UncompressedBytes = 0
	inspectTARMaterial(bytes.NewReader(buffer), inspection)
}

func inspectTARMaterial(reader io.Reader, inspection *AgentMaterialInspection) {
	archive := tar.NewReader(reader)
	for inspection.EntryCount < maxArchiveEntries {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			addInspectionWarning(inspection, "Tar 目录损坏、被截断或无法解析")
			break
		}
		inspection.EntryCount++
		if header.Size < 0 {
			addInspectionWarning(inspection, "Tar 条目声明了无效大小")
			continue
		}
		addUncompressedBytes(inspection, header.Size)
		inspectArchiveEntry(
			header.Name,
			header.FileInfo().Mode()&0o111 != 0,
			header.Typeflag == tar.TypeSymlink || header.Typeflag == tar.TypeLink,
			inspection,
		)
	}
	if inspection.EntryCount >= maxArchiveEntries {
		addInspectionWarning(
			inspection,
			fmt.Sprintf("归档达到 %d 个条目预检上限", maxArchiveEntries),
		)
	}
	appendArchiveSizeWarning(inspection)
}

func inspectArchiveEntry(
	name string,
	executable bool,
	link bool,
	inspection *AgentMaterialInspection,
) {
	normalized := strings.ReplaceAll(strings.TrimSpace(name), "\\", "/")
	cleaned := path.Clean(normalized)
	if normalized == "" ||
		strings.ContainsRune(normalized, 0) ||
		path.IsAbs(normalized) ||
		cleaned == ".." ||
		strings.HasPrefix(cleaned, "../") ||
		hasWindowsDrivePrefix(normalized) {
		addInspectionWarning(inspection, "归档包含可能逃逸解压目录的路径")
	}
	if link {
		addInspectionWarning(inspection, "归档包含符号链接或硬链接")
	}
	if executable {
		addInspectionWarning(inspection, "归档包含可执行权限条目，解压后不要直接运行")
	}
}

func appendArchiveSizeWarning(inspection *AgentMaterialInspection) {
	if inspection.UncompressedBytes > maxArchiveExpandedBytes {
		addInspectionWarning(
			inspection,
			fmt.Sprintf(
				"归档声明展开后约 %d MiB，超过 %d MiB 预检阈值",
				inspection.UncompressedBytes/(1024*1024),
				maxArchiveExpandedBytes/(1024*1024),
			),
		)
	}
}

func addUncompressedBytes(inspection *AgentMaterialInspection, size int64) {
	const maxInt64 = int64(^uint64(0) >> 1)
	if size > maxInt64-inspection.UncompressedBytes {
		inspection.UncompressedBytes = maxInt64
		addInspectionWarning(inspection, "归档声明的总展开大小发生整数溢出")
		return
	}
	inspection.UncompressedBytes += size
}

func addInspectionWarning(inspection *AgentMaterialInspection, warning string) {
	for _, existing := range inspection.Warnings {
		if existing == warning {
			return
		}
	}
	if len(inspection.Warnings) >= maxInspectionWarnings {
		return
	}
	inspection.Warnings = append(inspection.Warnings, warning)
}

func hasWindowsDrivePrefix(value string) bool {
	return len(value) >= 2 &&
		((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) &&
		value[1] == ':'
}

func mediaTypeMismatchWarning(name, declaredMediaType, detectedType string) string {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(declaredMediaType, ";")[0]))
	extension := strings.ToLower(path.Ext(name))
	switch detectedType {
	case "zip":
		if mediaType != "" &&
			mediaType != "application/zip" &&
			mediaType != "application/octet-stream" {
			return fmt.Sprintf("声明媒体类型 %s 与检测到的 ZIP 不一致", mediaType)
		}
	case "gzip":
		if mediaType != "" &&
			mediaType != "application/gzip" &&
			mediaType != "application/x-gzip" &&
			mediaType != "application/octet-stream" {
			return fmt.Sprintf("声明媒体类型 %s 与检测到的 Gzip 不一致", mediaType)
		}
	case "tar":
		if mediaType != "" &&
			mediaType != "application/x-tar" &&
			mediaType != "application/octet-stream" {
			return fmt.Sprintf("声明媒体类型 %s 与检测到的 Tar 不一致", mediaType)
		}
	case "elf", "pe":
		if strings.HasPrefix(mediaType, "text/") {
			return fmt.Sprintf("声明媒体类型 %s 与检测到的可执行文件不一致", mediaType)
		}
	case "text":
		if extension == ".zip" || extension == ".gz" || extension == ".tar" {
			return "附件扩展名像归档，但内容检测为普通文本"
		}
	}
	return ""
}
