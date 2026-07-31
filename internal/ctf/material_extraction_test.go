package ctf

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAutoExtractZIPWritesOnlyPrivateRegularFiles(t *testing.T) {
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	readme, err := writer.Create("docs/readme.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(readme, "hello"); err != nil {
		t.Fatal(err)
	}
	header := &zip.FileHeader{Name: "bin/tool"}
	header.SetMode(0o755)
	tool, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(tool, "#!/bin/sh\n"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	workspace := t.TempDir()
	inspection := inspectAgentMaterial("bundle.zip", "application/zip", archive.Bytes())
	paths, err := autoExtractAgentMaterial(
		workspace,
		"bundle.zip",
		strings.Repeat("a", 64),
		archive.Bytes(),
		inspection,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 ||
		!strings.HasSuffix(paths[0], "/bin/tool") ||
		!strings.HasSuffix(paths[1], "/docs/readme.txt") {
		t.Fatalf("unexpected extracted paths: %#v", paths)
	}
	for _, relative := range paths {
		fullPath := filepath.Join(workspace, filepath.FromSlash(relative))
		info, err := os.Stat(fullPath)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 || !info.Mode().IsRegular() {
			t.Fatalf("extracted file is not private regular data: %s %s", fullPath, info.Mode())
		}
	}
	toolData, err := os.ReadFile(filepath.Join(workspace, filepath.FromSlash(paths[0])))
	if err != nil {
		t.Fatal(err)
	}
	if string(toolData) != "#!/bin/sh\n" {
		t.Fatalf("unexpected extracted executable data: %q", toolData)
	}

	again, err := autoExtractAgentMaterial(
		workspace,
		"bundle.zip",
		strings.Repeat("a", 64),
		archive.Bytes(),
		inspection,
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(again, "\n") != strings.Join(paths, "\n") {
		t.Fatalf("repeat extraction changed paths: %#v != %#v", again, paths)
	}
}

func TestAutoExtractRejectsArchiveTraversalAndLinks(t *testing.T) {
	for name, archive := range map[string][]byte{
		"traversal": makeZIPArchive(t, "../escape.txt", 0o600, "escape"),
		"symlink":   makeZIPArchive(t, "link", os.ModeSymlink|0o777, "../target"),
	} {
		t.Run(name, func(t *testing.T) {
			workspace := t.TempDir()
			inspection := inspectAgentMaterial("unsafe.zip", "application/zip", archive)
			paths, err := autoExtractAgentMaterial(
				workspace,
				"unsafe.zip",
				strings.Repeat("b", 64),
				archive,
				inspection,
			)
			if err == nil || len(paths) != 0 {
				t.Fatalf("unsafe archive was extracted: paths=%#v err=%v", paths, err)
			}
			if _, err := os.Stat(filepath.Join(workspace, "escape.txt")); !os.IsNotExist(err) {
				t.Fatalf("archive escaped extraction root: %v", err)
			}
		})
	}
}

func TestAutoExtractTarGzip(t *testing.T) {
	var compressed bytes.Buffer
	gzipWriter := gzip.NewWriter(&compressed)
	tarWriter := tar.NewWriter(gzipWriter)
	content := []byte("flag evidence")
	if err := tarWriter.WriteHeader(&tar.Header{
		Name: "evidence/result.txt", Mode: 0o777, Size: int64(len(content)),
		Typeflag: tar.TypeReg,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}

	workspace := t.TempDir()
	inspection := inspectAgentMaterial(
		"fixture.tar.gz",
		"application/gzip",
		compressed.Bytes(),
	)
	if inspection.ArchiveFormat != "tar.gz" {
		t.Fatalf("tar.gz was not detected: %#v", inspection)
	}
	paths, err := autoExtractAgentMaterial(
		workspace,
		"fixture.tar.gz",
		strings.Repeat("c", 64),
		compressed.Bytes(),
		inspection,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || !strings.HasSuffix(paths[0], "/evidence/result.txt") {
		t.Fatalf("unexpected tar.gz paths: %#v", paths)
	}
	data, err := os.ReadFile(filepath.Join(workspace, filepath.FromSlash(paths[0])))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(content) {
		t.Fatalf("unexpected extracted tar.gz data: %q", data)
	}
	info, err := os.Stat(filepath.Join(workspace, filepath.FromSlash(paths[0])))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("tar executable permissions survived extraction: %s", info.Mode())
	}
}

func TestWriteExtractedRegularFileEnforcesActualByteLimit(t *testing.T) {
	root := t.TempDir()
	written, err := writeExtractedRegularFile(
		root,
		"large.bin",
		strings.NewReader("12345"),
		4,
	)
	if err == nil || written != 0 {
		t.Fatalf("oversized stream was written: bytes=%d err=%v", written, err)
	}
	if _, err := os.Stat(filepath.Join(root, "large.bin")); !os.IsNotExist(err) {
		t.Fatalf("oversized output was committed: %v", err)
	}
}

func makeZIPArchive(
	t *testing.T,
	name string,
	mode os.FileMode,
	content string,
) []byte {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	header := &zip.FileHeader{Name: name}
	header.SetMode(mode)
	entry, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(entry, content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return archive.Bytes()
}
