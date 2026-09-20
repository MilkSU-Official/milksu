package companion

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type TranscriptCursor struct {
	ByteOffset int64  `json:"byteOffset"`
	EntryID    string `json:"entryId"`
	Timestamp  string `json:"timestamp"`
	LineLength int64  `json:"lineLength"`
}

type TranscriptEntry struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Role      string `json:"role,omitempty"`
	Text      string `json:"text,omitempty"`
	Error     string `json:"error,omitempty"`
}

type TranscriptPage struct {
	Entries    []TranscriptEntry `json:"entries"`
	NextCursor *TranscriptCursor `json:"nextCursor,omitempty"`
	PrevCursor *TranscriptCursor `json:"prevCursor,omitempty"`
	HasMore    bool              `json:"hasMore"`
	File       string            `json:"file,omitempty"`
}

type CompanionArchive struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	Modified   int64  `json:"modified"`
	Exportable bool   `json:"exportable"`
}

const defaultTranscriptLimit = 40
const maxTranscriptLimit = 200

func FindCompanionSessionFile(agentDir string) (string, error) {
	sessionDir := filepath.Join(agentDir, "sessions")
	entries, err := os.ReadDir(sessionDir)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("list companion sessions: %w", err)
	}
	var latest string
	var latestMod int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		if !strings.Contains(entry.Name(), "_"+SessionID+".jsonl") && entry.Name() != SessionID+".jsonl" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().UnixNano() >= latestMod {
			latestMod = info.ModTime().UnixNano()
			latest = filepath.Join(sessionDir, entry.Name())
		}
	}
	return latest, nil
}

func ReadTranscriptPage(path string, limit int, cursor *TranscriptCursor, before bool) (TranscriptPage, error) {
	if strings.TrimSpace(path) == "" {
		return TranscriptPage{}, nil
	}
	if limit <= 0 {
		limit = defaultTranscriptLimit
	}
	if limit > maxTranscriptLimit {
		limit = maxTranscriptLimit
	}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return TranscriptPage{}, nil
		}
		return TranscriptPage{}, fmt.Errorf("open companion transcript: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return TranscriptPage{}, err
	}
	if cursor == nil || before {
		return readTranscriptTail(file, info.Size(), limit, cursor)
	}
	return readTranscriptForward(file, info.Size(), limit, cursor)
}

func ArchiveCompanionFile(agentDir, path string) (CompanionArchive, error) {
	if strings.TrimSpace(path) == "" {
		return CompanionArchive{}, fmt.Errorf("companion transcript path is required")
	}
	archiveDir := filepath.Join(agentDir, "archive")
	if err := os.MkdirAll(archiveDir, 0o700); err != nil {
		return CompanionArchive{}, err
	}
	name := filepath.Base(path)
	dest := filepath.Join(archiveDir, name)
	if err := os.Rename(path, dest); err != nil {
		return CompanionArchive{}, fmt.Errorf("archive companion transcript: %w", err)
	}
	info, err := os.Stat(dest)
	if err != nil {
		return CompanionArchive{}, err
	}
	return CompanionArchive{
		Name:       name,
		Size:       info.Size(),
		Modified:   info.ModTime().UnixMilli(),
		Exportable: true,
	}, nil
}

func ListCompanionArchives(agentDir string) ([]CompanionArchive, error) {
	archiveDir := filepath.Join(agentDir, "archive")
	entries, err := os.ReadDir(archiveDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []CompanionArchive{}, nil
		}
		return nil, err
	}
	result := make([]CompanionArchive, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		result = append(result, CompanionArchive{
			Name:       entry.Name(),
			Size:       info.Size(),
			Modified:   info.ModTime().UnixMilli(),
			Exportable: true,
		})
	}
	return result, nil
}

func DeleteCompanionArchive(agentDir, name string) error {
	cleaned := filepath.Base(strings.TrimSpace(name))
	if cleaned == "" || cleaned != name || !strings.HasSuffix(cleaned, ".jsonl") {
		return fmt.Errorf("invalid companion archive name")
	}
	path := filepath.Join(agentDir, "archive", cleaned)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func readTranscriptForward(file *os.File, size int64, limit int, cursor *TranscriptCursor) (TranscriptPage, error) {
	start := int64(0)
	if cursor != nil {
		start = cursor.ByteOffset + cursor.LineLength
	}
	if start > size {
		return TranscriptPage{File: file.Name()}, nil
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return TranscriptPage{}, err
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	offset := start
	entries := make([]TranscriptEntry, 0, limit)
	var last *TranscriptCursor
	hasMore := false
	for scanner.Scan() {
		line := scanner.Bytes()
		lineLength := int64(len(line) + 1)
		entry, ok := decodeTranscriptLine(line)
		if ok {
			if len(entries) == limit {
				hasMore = true
				break
			}
			entries = append(entries, entry)
			last = &TranscriptCursor{
				ByteOffset: offset,
				EntryID:    entry.ID,
				Timestamp:  entry.Timestamp,
				LineLength: lineLength,
			}
		}
		offset += lineLength
	}
	if err := scanner.Err(); err != nil {
		return TranscriptPage{}, err
	}
	page := TranscriptPage{
		Entries: entries,
		HasMore: hasMore,
		File:    file.Name(),
	}
	if last != nil {
		page.NextCursor = last
		page.PrevCursor = last
	}
	return page, nil
}

func readTranscriptTail(file *os.File, size int64, limit int, before *TranscriptCursor) (TranscriptPage, error) {
	end := size
	if before != nil && before.ByteOffset > 0 {
		end = before.ByteOffset
	}
	if end <= 0 {
		return TranscriptPage{File: file.Name()}, nil
	}
	chunk := int64(64 * 1024)
	var collected []scannedLine
	remaining := end
	for remaining > 0 && len(collected) <= limit+1 {
		readSize := chunk
		if remaining < readSize {
			readSize = remaining
		}
		remaining -= readSize
		buf := make([]byte, readSize)
		if _, err := file.ReadAt(buf, remaining); err != nil && err != io.EOF {
			return TranscriptPage{}, err
		}
		lines := splitLines(buf, remaining)
		collected = append(lines, collected...)
		if remaining > 0 && len(buf) > 0 && buf[0] != '\n' {
			// Incomplete first line belongs to the previous chunk; drop it.
			if len(collected) > 0 && collected[0].offset == remaining {
				collected = collected[1:]
			}
		}
	}
	decoded := make([]scannedEntry, 0, len(collected))
	for _, line := range collected {
		entry, ok := decodeTranscriptLine(line.raw)
		if !ok {
			continue
		}
		decoded = append(decoded, scannedEntry{
			entry: entry,
			cursor: TranscriptCursor{
				ByteOffset: line.offset,
				EntryID:    entry.ID,
				Timestamp:  entry.Timestamp,
				LineLength: line.length,
			},
		})
	}
	hasMore := false
	if before == nil && len(decoded) > limit {
		hasMore = true
		decoded = decoded[len(decoded)-limit:]
	} else if before != nil && len(decoded) > limit {
		hasMore = true
		decoded = decoded[len(decoded)-limit:]
	}
	page := TranscriptPage{
		Entries: make([]TranscriptEntry, 0, len(decoded)),
		HasMore: hasMore,
		File:    file.Name(),
	}
	for _, item := range decoded {
		page.Entries = append(page.Entries, item.entry)
	}
	if len(decoded) > 0 {
		first := decoded[0].cursor
		last := decoded[len(decoded)-1].cursor
		page.PrevCursor = &first
		page.NextCursor = &last
	}
	return page, nil
}

type scannedLine struct {
	offset int64
	length int64
	raw    []byte
}

type scannedEntry struct {
	entry  TranscriptEntry
	cursor TranscriptCursor
}

func splitLines(buf []byte, base int64) []scannedLine {
	result := make([]scannedLine, 0)
	offset := base
	for len(buf) > 0 {
		index := bytes.IndexByte(buf, '\n')
		if index < 0 {
			result = append(result, scannedLine{offset: offset, length: int64(len(buf)), raw: append([]byte(nil), buf...)})
			break
		}
		result = append(result, scannedLine{
			offset: offset,
			length: int64(index + 1),
			raw:    append([]byte(nil), buf[:index]...),
		})
		buf = buf[index+1:]
		offset += int64(index + 1)
	}
	return result
}

func decodeTranscriptLine(line []byte) (TranscriptEntry, bool) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return TranscriptEntry{}, false
	}
	var raw map[string]any
	if json.Unmarshal(line, &raw) != nil {
		return TranscriptEntry{}, false
	}
	kind := strings.TrimSpace(stringValue(raw["type"]))
	if kind == "" || kind == "session" {
		return TranscriptEntry{}, false
	}
	entry := TranscriptEntry{
		ID:        strings.TrimSpace(stringValue(raw["id"])),
		Type:      kind,
		Timestamp: strings.TrimSpace(stringValue(raw["timestamp"])),
	}
	if message, ok := raw["message"].(map[string]any); ok {
		entry.Role = strings.TrimSpace(stringValue(message["role"]))
		entry.Text = extractMessageText(message["content"])
		if errText := strings.TrimSpace(stringValue(message["errorMessage"])); errText != "" {
			entry.Error = errText
		}
	}
	if content, ok := raw["content"]; ok && entry.Text == "" {
		entry.Text = extractMessageText(content)
	}
	if text := strings.TrimSpace(stringValue(raw["summary"])); text != "" && entry.Text == "" {
		entry.Text = text
	}
	if entry.Error == "" {
		if errText := strings.TrimSpace(stringValue(raw["errorMessage"])); errText != "" {
			entry.Error = errText
		} else if errText := strings.TrimSpace(stringValue(raw["error"])); errText != "" {
			entry.Error = errText
		}
	}
	if entry.ID == "" {
		entry.ID = fmt.Sprintf("%s:%s", entry.Type, entry.Timestamp)
	}
	// model_change / thinking_level_change have no user-visible body. Keep
	// failed assistant turns (empty content + errorMessage) so the chat can
	// show the real failure instead of the JSONL type name "message".
	if entry.Text == "" && entry.Error == "" && kind != "message" {
		return TranscriptEntry{}, false
	}
	return entry, true
}

func extractMessageText(content any) string {
	switch typed := content.(type) {
	case string:
		return typed
	case []any:
		var builder strings.Builder
		for _, item := range typed {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if text := strings.TrimSpace(stringValue(block["text"])); text != "" {
				if builder.Len() > 0 {
					builder.WriteByte('\n')
				}
				builder.WriteString(text)
			}
		}
		return builder.String()
	default:
		return ""
	}
}
