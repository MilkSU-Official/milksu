package ctf

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
)

func TestValidateRequestAdmitsRawMaterialData(t *testing.T) {
	data := []byte("reverse apk placeholder")
	digest := sha256.Sum256(data)
	request := validChallengeRequest()
	request.Materials = []MaterialRequest{{
		Name:       "sample.apk.1",
		MediaType:  "application/zip",
		Provenance: "local-file-picker:sample.apk.1:sha256:" + hex.EncodeToString(digest[:]),
		Data:       data,
		Size:       int64(len(data)),
		SHA256:     hex.EncodeToString(digest[:]),
	}}

	admitted, err := validateRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(admitted.materials) != 1 || string(admitted.materials[0].data) != string(data) {
		t.Fatalf("raw material was not admitted: %#v", admitted.materials)
	}
}

func TestValidateRequestRejectsUnresolvedImportToken(t *testing.T) {
	request := validChallengeRequest()
	request.Materials = []MaterialRequest{{
		Name:        "sample.apk.1",
		MediaType:   "application/zip",
		Provenance:  "local-file-picker:sample.apk.1:sha256:" + strings.Repeat("a", 64),
		ImportToken: "ctfmat_deadbeef",
		Size:        42,
		SHA256:      strings.Repeat("a", 64),
	}}

	if _, err := validateRequest(request); err == nil {
		t.Fatal("expected unresolved import token rejection")
	}
}

func TestValidateRequestRejectsMixedMaterialTransport(t *testing.T) {
	request := validChallengeRequest()
	request.Materials = []MaterialRequest{{
		Name:       "mixed.txt",
		MediaType:  "text/plain",
		Provenance: "test",
		Data:       []byte("raw"),
		DataBase64: base64.StdEncoding.EncodeToString([]byte("inline")),
	}}

	if _, err := validateRequest(request); err == nil {
		t.Fatal("expected mixed raw and inline content rejection")
	}
}

func validChallengeRequest() ChallengeRequest {
	return ChallengeRequest{
		Title:             "Reverse sample",
		Statement:         "Static reverse challenge.",
		Category:          "reverse",
		CollaborationMode: "copilot",
		SourceKind:        "text",
		ExpectedFlag:      "",
		KnowledgePoints:   []string{"reverse"},
	}
}
