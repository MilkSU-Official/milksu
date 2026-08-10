package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadLocalCTFMaterialsPreservesFactsWithoutLeakingPath(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "evidence.txt")
	data := []byte("flag format: NSSCTF{...}\n")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}

	materials, err := loadLocalCTFMaterials([]string{path})
	if err != nil {
		t.Fatal(err)
	}
	if len(materials) != 1 {
		t.Fatalf("expected one material, got %d", len(materials))
	}
	material := materials[0]
	decoded, err := base64.StdEncoding.DecodeString(material.DataBase64)
	if err != nil {
		t.Fatal(err)
	}
	if material.Name != "evidence.txt" ||
		material.MediaType != "text/plain" ||
		!bytes.Equal(decoded, data) ||
		!strings.HasPrefix(material.Provenance, "local-file-picker:evidence.txt:sha256:") {
		t.Fatalf("unexpected material: %#v", material)
	}
	if strings.Contains(material.Provenance, directory) {
		t.Fatalf("provenance leaked the source directory: %q", material.Provenance)
	}
}

func TestLoadLocalCTFMaterialsRejectsLinksAndLimits(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.txt")
	if err := os.WriteFile(target, []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directory, "link.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLocalCTFMaterials([]string{link}); err == nil {
		t.Fatal("expected symbolic link rejection")
	}

	oversized := filepath.Join(directory, "oversized.bin")
	if err := os.WriteFile(oversized, make([]byte, maxLocalCTFMaterialBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLocalCTFMaterials([]string{oversized}); err == nil {
		t.Fatal("expected oversized material rejection")
	}

	paths := make([]string, 0, maxLocalCTFMaterialCount+1)
	for index := 0; index <= maxLocalCTFMaterialCount; index++ {
		path := filepath.Join(directory, strings.Repeat("x", index+1)+".txt")
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	if _, err := loadLocalCTFMaterials(paths); err == nil {
		t.Fatal("expected material count rejection")
	}
}
