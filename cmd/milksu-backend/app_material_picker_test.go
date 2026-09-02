package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestLocalCTFMaterialImportReturnsTokenWithoutLeakingPath(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "evidence.txt")
	data := []byte("flag format: NSSCTF{...}\n")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}

	store := newLocalCTFMaterialStore()
	materials, err := store.Import([]string{path})
	if err != nil {
		t.Fatal(err)
	}
	if len(materials) != 1 {
		t.Fatalf("expected one material, got %d", len(materials))
	}
	material := materials[0]
	digest := sha256.Sum256(data)
	wantDigest := hex.EncodeToString(digest[:])
	if material.Name != "evidence.txt" ||
		material.MediaType != "text/plain" ||
		material.DataBase64 != "" ||
		!strings.HasPrefix(material.ImportToken, "ctfmat_") ||
		material.Size != int64(len(data)) ||
		material.SHA256 != wantDigest ||
		!strings.HasPrefix(material.Provenance, "local-file-picker:evidence.txt:sha256:") {
		t.Fatalf("unexpected material: %#v", material)
	}
	if strings.Contains(material.Provenance, directory) {
		t.Fatalf("provenance leaked the source directory: %q", material.Provenance)
	}

	resolved, cleanup, err := store.Resolve(ctf.ChallengeRequest{Materials: materials})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if len(resolved.Materials) != 1 || !bytes.Equal(resolved.Materials[0].Data, data) {
		t.Fatalf("local material did not resolve to the original bytes: %#v", resolved.Materials)
	}
	if resolved.Materials[0].ImportToken != "" || resolved.Materials[0].DataBase64 != "" {
		t.Fatalf("resolved material should not retain transport-only fields: %#v", resolved.Materials[0])
	}
}

func TestLocalCTFMaterialImportAcceptsLargeReverseAttachments(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "sample.apk.1")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(33 * 1024 * 1024); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	store := newLocalCTFMaterialStore()
	materials, err := store.Import([]string{path})
	if err != nil {
		t.Fatal(err)
	}
	if len(materials) != 1 {
		t.Fatalf("expected one material, got %d", len(materials))
	}
	if materials[0].DataBase64 != "" || materials[0].Size != 33*1024*1024 {
		t.Fatalf("large material should be represented by metadata token: %#v", materials[0])
	}
	if materials[0].MediaType == "" {
		t.Fatal("large material should have a detected media type")
	}
}

func TestLocalCTFMaterialImportRejectsLinksAndLimits(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.txt")
	if err := os.WriteFile(target, []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directory, "link.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	store := newLocalCTFMaterialStore()
	if _, err := store.Import([]string{link}); err == nil {
		t.Fatal("expected symbolic link rejection")
	}

	oversized := filepath.Join(directory, "oversized.bin")
	file, err := os.Create(oversized)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxLocalCTFMaterialBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Import([]string{oversized}); err == nil {
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
	if _, err := store.Import(paths); err == nil {
		t.Fatal("expected material count rejection")
	}
}

func TestLocalCTFMaterialResolveRejectsChangedFiles(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "evidence.bin")
	if err := os.WriteFile(path, []byte("aaaa"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := newLocalCTFMaterialStore()
	materials, err := store.Import([]string{path})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("bbbb"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Resolve(ctf.ChallengeRequest{Materials: materials}); err == nil {
		t.Fatal("expected changed local material rejection")
	}
}

func TestAppStartCTFChallengeResolvesLocalMaterialToken(t *testing.T) {
	directory := t.TempDir()
	runtimeService, err := securityruntime.NewService(filepath.Join(directory, "runtime"), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctfService, err := ctf.NewService(runtimeService, ctf.ServiceOptions{})
	if err != nil {
		_ = runtimeService.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = ctfService.Close()
		_ = runtimeService.Close()
	})

	app := &App{
		ctx:          context.Background(),
		ctfMaterials: newLocalCTFMaterialStore(),
		jobs:         runtimeService,
		ctfJobs:      ctfService,
	}
	path := filepath.Join(directory, "twtapp30303.apk.1")
	data := []byte("PK\x03\x04static reverse fixture")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	materials, err := app.ctfMaterials.Import([]string{path})
	if err != nil {
		t.Fatal(err)
	}

	projection, err := app.StartCTFChallenge(ctf.ChallengeRequest{
		Title:             "Reverse APK",
		Statement:         "Static analysis only.",
		Category:          "reverse",
		CollaborationMode: "copilot",
		DeferAgent:        true,
		SourceKind:        "text",
		Materials:         materials,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Challenge.Materials) != 1 || len(projection.Artifacts) != 1 {
		t.Fatalf("expected one admitted material and artifact: %#v", projection)
	}
	artifactData, err := runtimeService.ReadArtifact(context.Background(), projection.Artifacts[0])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(artifactData, data) {
		t.Fatalf("artifact data mismatch: got %q want %q", artifactData, data)
	}
	if projection.Challenge.Materials[0].Name != "twtapp30303.apk.1" ||
		projection.Challenge.Materials[0].Size != int64(len(data)) {
		t.Fatalf("unexpected admitted material metadata: %#v", projection.Challenge.Materials[0])
	}
	if _, _, err := app.ctfMaterials.Resolve(ctf.ChallengeRequest{Materials: materials}); err == nil {
		t.Fatal("expected consumed token to be unavailable after successful challenge start")
	}
}
