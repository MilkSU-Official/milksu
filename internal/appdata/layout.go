package appdata

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

const (
	DataLayoutFile           = "data-layout.json"
	DataLayoutSchema         = "milksu-data-layout/v1"
	CurrentDataLayoutVersion = 1
	maxDataLayoutBytes       = 16 * 1024
)

type DataLayout struct {
	Schema    string `json:"schema"`
	Version   int    `json:"version"`
	UpdatedAt string `json:"updatedAt"`
}

func ReadDataLayout(directory string) (DataLayout, error) {
	directory, err := secureRoot(directory)
	if err != nil {
		return DataLayout{}, err
	}
	return readDataLayout(filepath.Join(directory, DataLayoutFile))
}

func ensureDataLayout(directory string) error {
	path := filepath.Join(directory, DataLayoutFile)
	layout, err := readDataLayout(path)
	if errors.Is(err, os.ErrNotExist) {
		return writeDataLayout(path, DataLayout{
			Schema:    DataLayoutSchema,
			Version:   CurrentDataLayoutVersion,
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		})
	}
	if err != nil {
		return fmt.Errorf("read MilkSU data layout: %w", err)
	}
	if layout.Schema != DataLayoutSchema {
		return fmt.Errorf(
			"unsupported MilkSU data layout schema %q; expected %q",
			layout.Schema,
			DataLayoutSchema,
		)
	}
	if layout.Version > CurrentDataLayoutVersion {
		return fmt.Errorf(
			"MilkSU data layout version %d is newer than this app supports (%d); upgrade MilkSU instead of opening it with an older build",
			layout.Version,
			CurrentDataLayoutVersion,
		)
	}
	if layout.Version < 0 {
		return fmt.Errorf("invalid MilkSU data layout version %d", layout.Version)
	}
	for layout.Version < CurrentDataLayoutVersion {
		nextVersion := layout.Version + 1
		if err := migrateDataLayout(directory, layout.Version, nextVersion); err != nil {
			return err
		}
		layout.Version = nextVersion
		layout.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if err := writeDataLayout(path, layout); err != nil {
			return err
		}
	}
	return nil
}

func migrateDataLayout(directory string, fromVersion, toVersion int) error {
	switch {
	case fromVersion == 0 && toVersion == 1:
		// Existing M3 data stores already run their own idempotent SQLite and
		// file migrations. Version 1 records that legacy user data has crossed
		// the application-level compatibility boundary without moving it.
		return nil
	default:
		return fmt.Errorf(
			"no MilkSU data layout migration from version %d to %d for %q",
			fromVersion,
			toVersion,
			directory,
		)
	}
}

func readDataLayout(path string) (DataLayout, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return DataLayout{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return DataLayout{}, fmt.Errorf("%s must be a regular file", DataLayoutFile)
	}
	if info.Size() > maxDataLayoutBytes {
		return DataLayout{}, fmt.Errorf("%s is larger than %d bytes", DataLayoutFile, maxDataLayoutBytes)
	}
	file, err := os.Open(path)
	if err != nil {
		return DataLayout{}, err
	}
	defer file.Close()
	var layout DataLayout
	decoder := json.NewDecoder(io.LimitReader(file, maxDataLayoutBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&layout); err != nil {
		return DataLayout{}, fmt.Errorf("decode %s: %w", DataLayoutFile, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return DataLayout{}, fmt.Errorf("%s contains trailing JSON data", DataLayoutFile)
	}
	return layout, nil
}

func writeDataLayout(path string, layout DataLayout) error {
	payload, err := json.MarshalIndent(layout, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", DataLayoutFile, err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(path), ".milksu-data-layout-*")
	if err != nil {
		return fmt.Errorf("create temporary %s: %w", DataLayoutFile, err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary %s: %w", DataLayoutFile, err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary %s: %w", DataLayoutFile, err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary %s: %w", DataLayoutFile, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary %s: %w", DataLayoutFile, err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("install %s: %w", DataLayoutFile, err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("protect %s: %w", DataLayoutFile, err)
	}
	return nil
}
