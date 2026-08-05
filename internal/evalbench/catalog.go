package evalbench

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Split string

const (
	SplitDevelopment Split = "development"
	SplitTest        Split = "test"
)

var (
	taskIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	yearPattern   = regexp.MustCompile(`^[0-9]{4}$`)
)

type Task struct {
	ID           string `json:"id"`
	Split        Split  `json:"split"`
	Year         string `json:"year"`
	Event        string `json:"event"`
	Category     string `json:"category"`
	Challenge    string `json:"challenge"`
	RelativePath string `json:"relativePath"`

	// Directory is local-only adapter state. It is deliberately omitted from
	// reports so an exported benchmark summary does not leak a user's paths.
	Directory string `json:"-"`
}

type Catalog struct {
	SchemaVersion string `json:"schemaVersion"`
	Source        Source `json:"source"`
	Split         Split  `json:"split"`
	Tasks         []Task `json:"tasks"`
}

type catalogEntry struct {
	Year      string `json:"year"`
	Event     string `json:"event"`
	Category  string `json:"category"`
	Challenge string `json:"challenge"`
	Path      string `json:"path"`
}

var supportedCategories = map[string]struct{}{
	"crypto":    {},
	"forensics": {},
	"misc":      {},
	"pwn":       {},
	"rev":       {},
	"web":       {},
}

// ImportNYUCTFBenchCatalog imports only the pinned dataset index and verifies
// that each indexed task directory contains challenge.json. It never reads
// challenge.json, challenge artifacts, Docker configuration, flags, commands,
// transcripts, or model output.
func ImportNYUCTFBenchCatalog(root string, split Split) (Catalog, error) {
	if err := validateSplit(split); err != nil {
		return Catalog{}, err
	}
	resolvedRoot, err := resolveDirectory(root)
	if err != nil {
		return Catalog{}, fmt.Errorf("resolve benchmark root: %w", err)
	}

	indexPath := filepath.Join(resolvedRoot, string(split)+"_dataset.json")
	indexPath, err = resolveContainedPath(resolvedRoot, indexPath)
	if err != nil {
		return Catalog{}, fmt.Errorf("resolve %s catalog: %w", split, err)
	}
	info, err := os.Stat(indexPath)
	if err != nil {
		return Catalog{}, fmt.Errorf("stat %s catalog: %w", split, err)
	}
	if !info.Mode().IsRegular() {
		return Catalog{}, fmt.Errorf("%s catalog is not a regular file", split)
	}

	raw, err := readBoundedFile(indexPath, defaultMaximumCatalogSize)
	if err != nil {
		return Catalog{}, fmt.Errorf("read %s catalog: %w", split, err)
	}
	entries := map[string]catalogEntry{}
	if err := decodeStrictJSON(raw, &entries); err != nil {
		return Catalog{}, fmt.Errorf("decode %s catalog: %w", split, err)
	}
	if len(entries) == 0 {
		return Catalog{}, fmt.Errorf("%s catalog is empty", split)
	}

	ids := make([]string, 0, len(entries))
	for id := range entries {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	tasks := make([]Task, 0, len(ids))
	for _, id := range ids {
		entry := entries[id]
		task, err := importTaskDirectory(resolvedRoot, split, id, entry)
		if err != nil {
			return Catalog{}, err
		}
		tasks = append(tasks, task)
	}
	return Catalog{
		SchemaVersion: CatalogSchemaVersion,
		Source:        NYUCTFBenchSource(),
		Split:         split,
		Tasks:         tasks,
	}, nil
}

func importTaskDirectory(root string, split Split, id string, entry catalogEntry) (Task, error) {
	if !taskIDPattern.MatchString(id) || len(id) > 200 {
		return Task{}, fmt.Errorf("catalog task id %q is invalid", id)
	}
	if !yearPattern.MatchString(entry.Year) {
		return Task{}, fmt.Errorf("catalog task %q has invalid year %q", id, entry.Year)
	}
	if entry.Event != "CSAW-Quals" && entry.Event != "CSAW-Finals" {
		return Task{}, fmt.Errorf("catalog task %q has unsupported event %q", id, entry.Event)
	}
	if _, ok := supportedCategories[entry.Category]; !ok {
		return Task{}, fmt.Errorf("catalog task %q has unsupported category %q", id, entry.Category)
	}
	if strings.TrimSpace(entry.Challenge) == "" || len(entry.Challenge) > 256 {
		return Task{}, fmt.Errorf("catalog task %q has invalid challenge name", id)
	}
	if err := validateTaskPath(split, entry.Path); err != nil {
		return Task{}, fmt.Errorf("catalog task %q: %w", id, err)
	}

	taskPath := filepath.Join(root, filepath.FromSlash(entry.Path))
	taskPath, err := resolveContainedPath(root, taskPath)
	if err != nil {
		return Task{}, fmt.Errorf("resolve catalog task %q directory: %w", id, err)
	}
	taskInfo, err := os.Stat(taskPath)
	if err != nil {
		return Task{}, fmt.Errorf("stat catalog task %q directory: %w", id, err)
	}
	if !taskInfo.IsDir() {
		return Task{}, fmt.Errorf("catalog task %q path is not a directory", id)
	}

	metadataPath, err := resolveContainedPath(taskPath, filepath.Join(taskPath, "challenge.json"))
	if err != nil {
		return Task{}, fmt.Errorf("resolve catalog task %q metadata: %w", id, err)
	}
	metadataInfo, err := os.Stat(metadataPath)
	if err != nil {
		return Task{}, fmt.Errorf("stat catalog task %q metadata: %w", id, err)
	}
	if !metadataInfo.Mode().IsRegular() {
		return Task{}, fmt.Errorf("catalog task %q metadata is not a regular file", id)
	}

	return Task{
		ID:           id,
		Split:        split,
		Year:         entry.Year,
		Event:        entry.Event,
		Category:     entry.Category,
		Challenge:    entry.Challenge,
		RelativePath: entry.Path,
		Directory:    taskPath,
	}, nil
}

func validateSplit(split Split) error {
	if split != SplitDevelopment && split != SplitTest {
		return fmt.Errorf("unsupported benchmark split %q", split)
	}
	return nil
}

func validateTaskPath(split Split, value string) error {
	if value == "" || len(value) > 1024 || strings.Contains(value, `\`) {
		return errors.New("task path is invalid")
	}
	cleaned := path.Clean(value)
	if cleaned != value || path.IsAbs(value) || value == "." || strings.HasPrefix(value, "../") {
		return errors.New("task path must be a normalized relative slash path")
	}
	if !strings.HasPrefix(value, string(split)+"/") {
		return fmt.Errorf("task path must be under the %s split", split)
	}
	return nil
}

func resolveDirectory(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", errors.New("path is required")
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("path is not a directory")
	}
	return resolved, nil
}

func resolveContainedPath(root, candidate string) (string, error) {
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(root, resolved)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", errors.New("path escapes benchmark root")
	}
	return resolved, nil
}

func readBoundedFile(filePath string, limit int64) ([]byte, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	return data, nil
}

func decodeStrictJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}
