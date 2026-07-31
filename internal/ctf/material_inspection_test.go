package ctf

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"strings"
	"testing"
)

func TestInspectAgentMaterialReportsArchiveMetadata(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("notes/readme.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("fixture")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	inspection := inspectAgentMaterial("challenge.zip", "application/zip", buffer.Bytes())
	if inspection.DetectedType != "zip" ||
		inspection.ArchiveFormat != "zip" ||
		inspection.EntryCount != 1 ||
		inspection.UncompressedBytes != int64(len("fixture")) ||
		inspection.ReviewRequired ||
		len(inspection.Warnings) != 0 {
		t.Fatalf("unexpected ZIP inspection: %#v", inspection)
	}
}

func TestInspectAgentMaterialFlagsArchiveTraversalAndTypeMismatch(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	header := &zip.FileHeader{Name: "../escape.sh", Method: zip.Deflate}
	header.SetMode(0o755)
	entry, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("#!/bin/sh\n")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	inspection := inspectAgentMaterial("notes.txt", "text/plain", buffer.Bytes())
	if !inspection.ReviewRequired {
		t.Fatalf("dangerous archive did not require review: %#v", inspection)
	}
	joined := strings.Join(inspection.Warnings, "\n")
	for _, expected := range []string{"逃逸解压目录", "可执行权限", "媒体类型"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("inspection did not report %q: %#v", expected, inspection)
		}
	}
}

func TestInspectAgentMaterialRecognizesTarGzipWithoutExtractingFiles(t *testing.T) {
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	body := []byte("evidence")
	if err := tarWriter.WriteHeader(&tar.Header{
		Name: "bundle/evidence.txt",
		Mode: 0o600,
		Size: int64(len(body)),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}

	inspection := inspectAgentMaterial("bundle.tar.gz", "application/gzip", buffer.Bytes())
	if inspection.DetectedType != "gzip" ||
		inspection.ArchiveFormat != "tar.gz" ||
		inspection.EntryCount != 1 ||
		inspection.UncompressedBytes != int64(len(body)) ||
		inspection.ReviewRequired {
		t.Fatalf("unexpected tar.gz inspection: %#v", inspection)
	}
}
