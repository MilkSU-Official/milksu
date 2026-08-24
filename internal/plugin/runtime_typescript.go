package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type typeScriptExecutor struct {
	node   string
	worker string
}

func (e typeScriptExecutor) Invoke(ctx context.Context, record *packageRecord, request runtimeInvocation) (runtimeResult, error) {
	node := strings.TrimSpace(e.node)
	worker := strings.TrimSpace(e.worker)
	if node == "" || worker == "" {
		return runtimeResult{}, errors.New("TypeScript plugin runtime is unavailable")
	}
	entry, err := securePackageFile(record.directory, record.manifest.Runtime.Entry, maxEntryBytes)
	if err != nil {
		return runtimeResult{}, err
	}
	worker, err = filepath.Abs(worker)
	if err != nil {
		return runtimeResult{}, err
	}
	loader := filepath.Join(filepath.Dir(worker), "deny-loader.mjs")
	if info, statErr := os.Lstat(loader); statErr != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return runtimeResult{}, errors.New("TypeScript plugin module guard is unavailable")
	}
	loaderURL := filePathURL(loader)
	workerURL := filePathURL(worker)
	entryURL := filePathURL(entry)
	arguments := []string{
		"--permission",
		"--allow-worker",
		"--max-old-space-size=64",
		"--disable-proto=throw",
		"--experimental-loader=" + loaderURL,
		"--allow-fs-read=" + loader,
		"--allow-fs-read=" + worker,
		"--allow-fs-read=" + entry,
		worker,
		entry,
	}
	command := exec.CommandContext(ctx, node, arguments...)
	command.Dir = record.directory
	command.Env = []string{
		"MILKSU_PLUGIN_ID=" + record.manifest.ID,
		"MILKSU_PLUGIN_WORKER_URL=" + workerURL,
		"MILKSU_PLUGIN_ENTRY_URL=" + entryURL,
		"NO_COLOR=1",
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return runtimeResult{}, err
	}
	command.Stdin = bytes.NewReader(append(payload, '\n'))
	var stdout bytes.Buffer
	var stderr limitedBuffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return runtimeResult{}, fmt.Errorf("TypeScript plugin timed out: %w", ctx.Err())
		}
		return runtimeResult{}, fmt.Errorf("TypeScript plugin failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	if stdout.Len() > maxRuntimeResultBytes || bytes.Count(stdout.Bytes(), []byte{'\n'}) > 1 {
		return runtimeResult{}, errors.New("TypeScript plugin returned an invalid message stream")
	}
	var result runtimeResult
	decoder := json.NewDecoder(io.LimitReader(&stdout, maxRuntimeResultBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return runtimeResult{}, fmt.Errorf("decode TypeScript plugin result: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return runtimeResult{}, errors.New("TypeScript plugin result contains trailing data")
	}
	if err := validateRuntimeResult(result, request.StorageEnabled); err != nil {
		return runtimeResult{}, err
	}
	return result, nil
}

func filePathURL(path string) string {
	normalized := filepath.ToSlash(path)
	if len(normalized) >= 2 && normalized[1] == ':' {
		normalized = "/" + normalized
	}
	// Node's pathToFileURL percent-encodes a literal tilde while net/url keeps
	// it unescaped. The module guard compares exact URLs, so Windows 8.3 paths
	// such as HANKAE~1 must use Node's canonical spelling too.
	return strings.ReplaceAll((&url.URL{Scheme: "file", Path: normalized}).String(), "~", "%7E")
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(value []byte) (int, error) {
	remaining := 16<<10 - b.Len()
	if remaining <= 0 {
		return len(value), nil
	}
	if len(value) > remaining {
		_, _ = b.Buffer.Write(value[:remaining])
		return len(value), nil
	}
	return b.Buffer.Write(value)
}
