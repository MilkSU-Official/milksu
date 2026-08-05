package ctf

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const maxAutoExtractBytes int64 = 64 * 1024 * 1024

func autoExtractAgentMaterial(
	workspacePath string,
	exportedName string,
	digest string,
	data []byte,
	inspection AgentMaterialInspection,
) ([]string, error) {
	if inspection.ArchiveFormat == "" {
		return []string{}, nil
	}
	if len(digest) < 12 {
		return nil, fmt.Errorf("材料摘要无效")
	}
	extractionParent := filepath.Join(workspacePath, "materials", "extracted")
	if err := os.MkdirAll(extractionParent, 0o700); err != nil {
		return nil, fmt.Errorf("创建归档展开目录失败")
	}
	baseName := archiveExtractionBase(exportedName, digest)
	finalRoot := filepath.Join(extractionParent, baseName)
	if _, err := os.Stat(finalRoot); err == nil {
		return listExistingExtraction(workspacePath, finalRoot)
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("检查已有展开目录失败")
	}

	temporaryRoot, err := os.MkdirTemp(extractionParent, ".milksu-extract-*")
	if err != nil {
		return nil, fmt.Errorf("创建临时展开目录失败")
	}
	defer os.RemoveAll(temporaryRoot)
	if err := os.Chmod(temporaryRoot, 0o700); err != nil {
		return nil, fmt.Errorf("保护临时展开目录失败")
	}

	relativeFiles, err := extractArchiveInto(
		temporaryRoot,
		exportedName,
		data,
		inspection.ArchiveFormat,
	)
	if err != nil {
		return nil, err
	}
	if len(relativeFiles) == 0 {
		return nil, fmt.Errorf("归档中没有可用的普通文件")
	}
	if err := os.Rename(temporaryRoot, finalRoot); err != nil {
		if _, statErr := os.Stat(finalRoot); statErr == nil {
			return listExistingExtraction(workspacePath, finalRoot)
		}
		return nil, fmt.Errorf("提交归档展开目录失败")
	}
	return workspaceExtractionPaths(workspacePath, finalRoot, relativeFiles), nil
}

func archiveExtractionBase(name, digest string) string {
	name = strings.TrimSpace(filepath.Base(name))
	lower := strings.ToLower(name)
	for _, suffix := range []string{".tar.gz", ".tgz", ".zip", ".tar", ".gz"} {
		if strings.HasSuffix(lower, suffix) {
			name = name[:len(name)-len(suffix)]
			break
		}
	}
	name = strings.Trim(strings.TrimSpace(name), ".")
	if name == "" {
		name = "archive"
	}
	var builder strings.Builder
	for _, character := range name {
		switch {
		case character >= 'a' && character <= 'z',
			character >= 'A' && character <= 'Z',
			character >= '0' && character <= '9',
			character == '-', character == '_':
			builder.WriteRune(character)
		default:
			builder.WriteRune('-')
		}
	}
	cleaned := strings.Trim(builder.String(), "-")
	if cleaned == "" {
		cleaned = "archive"
	}
	if len(cleaned) > 60 {
		cleaned = cleaned[:60]
	}
	return cleaned + "-" + digest[:12]
}

func extractArchiveInto(root, exportedName string, data []byte, format string) ([]string, error) {
	switch format {
	case "zip":
		return extractZIPInto(root, data)
	case "tar":
		return extractTARInto(root, tar.NewReader(bytes.NewReader(data)))
	case "tar.gz":
		reader, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("Gzip 数据损坏")
		}
		defer reader.Close()
		return extractTARInto(root, tar.NewReader(reader))
	case "gzip":
		return extractGZIPInto(root, exportedName, data)
	default:
		return nil, fmt.Errorf("不支持的归档格式 %s", format)
	}
}

func extractZIPInto(root string, data []byte) ([]string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("ZIP 目录损坏")
	}
	if len(reader.File) > maxArchiveEntries {
		return nil, fmt.Errorf("ZIP 条目超过 %d 个上限", maxArchiveEntries)
	}
	remaining := maxAutoExtractBytes
	seen := make(map[string]struct{}, len(reader.File))
	extracted := make([]string, 0, len(reader.File))
	for _, entry := range reader.File {
		if entry.Flags&0x1 != 0 {
			return nil, fmt.Errorf("ZIP 包含加密条目")
		}
		relative, directory, err := safeArchiveRelativePath(entry.Name)
		if err != nil {
			return nil, err
		}
		mode := entry.Mode()
		if mode&os.ModeSymlink != 0 || mode&os.ModeType != 0 && !mode.IsDir() {
			return nil, fmt.Errorf("ZIP 包含链接或特殊文件")
		}
		if directory || entry.FileInfo().IsDir() {
			if err := secureExtractionDirectory(root, relative); err != nil {
				return nil, err
			}
			continue
		}
		if _, duplicate := seen[relative]; duplicate {
			return nil, fmt.Errorf("归档包含重复路径 %q", relative)
		}
		seen[relative] = struct{}{}
		if entry.UncompressedSize64 > uint64(maxAutoExtractBytes) ||
			int64(entry.UncompressedSize64) > remaining {
			return nil, fmt.Errorf("ZIP 展开后超过 %d MiB 上限", maxAutoExtractBytes/(1024*1024))
		}
		source, err := entry.Open()
		if err != nil {
			return nil, fmt.Errorf("读取 ZIP 条目 %q 失败", relative)
		}
		written, writeErr := writeExtractedRegularFile(root, relative, source, remaining)
		closeErr := source.Close()
		if writeErr != nil {
			return nil, writeErr
		}
		if closeErr != nil {
			return nil, fmt.Errorf("关闭 ZIP 条目 %q 失败", relative)
		}
		remaining -= written
		extracted = append(extracted, relative)
	}
	sort.Strings(extracted)
	return extracted, nil
}

func extractTARInto(root string, reader *tar.Reader) ([]string, error) {
	remaining := maxAutoExtractBytes
	seen := make(map[string]struct{})
	extracted := make([]string, 0)
	entries := 0
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("Tar 目录损坏或被截断")
		}
		entries++
		if entries > maxArchiveEntries {
			return nil, fmt.Errorf("Tar 条目超过 %d 个上限", maxArchiveEntries)
		}
		relative, directory, err := safeArchiveRelativePath(header.Name)
		if err != nil {
			return nil, err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if !directory {
				directory = true
			}
		case tar.TypeReg, tar.TypeRegA:
		default:
			return nil, fmt.Errorf("Tar 包含链接或特殊文件")
		}
		if directory {
			if err := secureExtractionDirectory(root, relative); err != nil {
				return nil, err
			}
			continue
		}
		if header.Size < 0 || header.Size > remaining {
			return nil, fmt.Errorf("Tar 展开后超过 %d MiB 上限", maxAutoExtractBytes/(1024*1024))
		}
		if _, duplicate := seen[relative]; duplicate {
			return nil, fmt.Errorf("归档包含重复路径 %q", relative)
		}
		seen[relative] = struct{}{}
		written, err := writeExtractedRegularFile(root, relative, reader, remaining)
		if err != nil {
			return nil, err
		}
		if written != header.Size {
			return nil, fmt.Errorf("Tar 条目 %q 长度不一致", relative)
		}
		remaining -= written
		extracted = append(extracted, relative)
	}
	sort.Strings(extracted)
	return extracted, nil
}

func extractGZIPInto(root, exportedName string, data []byte) ([]string, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("Gzip 数据损坏")
	}
	defer reader.Close()
	name := strings.TrimSuffix(exportedName, filepath.Ext(exportedName))
	if strings.TrimSpace(name) == "" {
		name = "payload.bin"
	}
	relative, _, err := safeArchiveRelativePath(name)
	if err != nil {
		return nil, err
	}
	if _, err := writeExtractedRegularFile(root, relative, reader, maxAutoExtractBytes); err != nil {
		return nil, err
	}
	return []string{relative}, nil
}

func safeArchiveRelativePath(raw string) (string, bool, error) {
	if strings.ContainsRune(raw, 0) {
		return "", false, fmt.Errorf("归档路径包含 NUL")
	}
	normalized := strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/")
	directory := strings.HasSuffix(normalized, "/")
	cleaned := path.Clean(normalized)
	if normalized == "" || cleaned == "." ||
		path.IsAbs(normalized) ||
		cleaned == ".." ||
		strings.HasPrefix(cleaned, "../") ||
		hasWindowsDrivePrefix(normalized) {
		return "", false, fmt.Errorf("归档路径试图逃逸工作区")
	}
	return cleaned, directory, nil
}

func secureExtractionDirectory(root, relative string) error {
	destination, err := extractionDestination(root, relative)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return fmt.Errorf("创建归档目录 %q 失败", relative)
	}
	return os.Chmod(destination, 0o700)
}

func writeExtractedRegularFile(
	root string,
	relative string,
	source io.Reader,
	remaining int64,
) (int64, error) {
	destination, err := extractionDestination(root, relative)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return 0, fmt.Errorf("创建归档条目目录失败")
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".milksu-entry-*")
	if err != nil {
		return 0, fmt.Errorf("创建归档临时文件失败")
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return 0, fmt.Errorf("保护归档临时文件失败")
	}
	limited := &io.LimitedReader{R: source, N: remaining + 1}
	written, err := io.Copy(temporary, limited)
	if err != nil {
		temporary.Close()
		return 0, fmt.Errorf("写入归档条目 %q 失败", relative)
	}
	if written > remaining {
		temporary.Close()
		return 0, fmt.Errorf("归档展开后超过 %d MiB 上限", maxAutoExtractBytes/(1024*1024))
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return 0, fmt.Errorf("同步归档条目 %q 失败", relative)
	}
	if err := temporary.Close(); err != nil {
		return 0, fmt.Errorf("关闭归档条目 %q 失败", relative)
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		return 0, fmt.Errorf("提交归档条目 %q 失败", relative)
	}
	return written, nil
}

func extractionDestination(root, relative string) (string, error) {
	destination := filepath.Join(root, filepath.FromSlash(relative))
	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("解析展开目录失败")
	}
	resolvedDestination, err := filepath.Abs(destination)
	if err != nil {
		return "", fmt.Errorf("解析归档条目路径失败")
	}
	within, err := filepath.Rel(resolvedRoot, resolvedDestination)
	if err != nil || within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("归档路径试图逃逸工作区")
	}
	return resolvedDestination, nil
}

func workspaceExtractionPaths(
	workspacePath string,
	root string,
	relativeFiles []string,
) []string {
	result := make([]string, 0, len(relativeFiles))
	for _, relative := range relativeFiles {
		pathValue, err := filepath.Rel(
			workspacePath,
			filepath.Join(root, filepath.FromSlash(relative)),
		)
		if err == nil {
			result = append(result, filepath.ToSlash(pathValue))
		}
	}
	sort.Strings(result)
	return result
}

func listExistingExtraction(workspacePath, root string) ([]string, error) {
	relativeFiles := make([]string, 0)
	err := filepath.WalkDir(root, func(pathValue string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if pathValue == root {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !entry.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("已有归档展开目录包含链接或特殊文件")
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, pathValue)
		if err != nil {
			return err
		}
		relativeFiles = append(relativeFiles, filepath.ToSlash(relative))
		if len(relativeFiles) > maxArchiveEntries {
			return fmt.Errorf("已有归档展开目录条目过多")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(relativeFiles) == 0 {
		return nil, fmt.Errorf("已有归档展开目录为空")
	}
	return workspaceExtractionPaths(workspacePath, root, relativeFiles), nil
}

func boundedMaterialWarning(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
