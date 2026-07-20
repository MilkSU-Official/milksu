package securityruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
)

type ArtifactStore struct {
	root string
}

func NewArtifactStore(root string) (*ArtifactStore, error) {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create artifact store: %w", err)
	}
	return &ArtifactStore{root: root}, nil
}

func (s *ArtifactStore) Put(ctx context.Context, jobID, sourceActionID, mediaType string, data []byte) (Artifact, bool, error) {
	if err := validateIdentifier("source action id", sourceActionID); err != nil {
		return Artifact{}, false, err
	}
	return s.put(ctx, jobID, sourceActionID, "action:"+sourceActionID, mediaType, data)
}

func (s *ArtifactStore) Admit(ctx context.Context, jobID, source, mediaType string, data []byte) (Artifact, bool, error) {
	if source == "" {
		return Artifact{}, false, fmt.Errorf("artifact source is required")
	}
	return s.put(ctx, jobID, "", source, mediaType, data)
}

func (s *ArtifactStore) put(ctx context.Context, jobID, sourceActionID, source, mediaType string, data []byte) (Artifact, bool, error) {
	if err := ctx.Err(); err != nil {
		return Artifact{}, false, err
	}
	if err := validateIdentifier("job id", jobID); err != nil {
		return Artifact{}, false, err
	}
	if sourceActionID != "" {
		if err := validateIdentifier("source action id", sourceActionID); err != nil {
			return Artifact{}, false, err
		}
	}
	if mediaType == "" {
		return Artifact{}, false, fmt.Errorf("artifact media type is required")
	}

	digestBytes := sha256.Sum256(data)
	digest := hex.EncodeToString(digestBytes[:])
	directory := filepath.Join(s.root, jobID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return Artifact{}, false, fmt.Errorf("create job artifact directory: %w", err)
	}
	filePath := filepath.Join(directory, digest)
	created := true
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		if !os.IsExist(err) {
			return Artifact{}, false, fmt.Errorf("create artifact: %w", err)
		}
		created = false
		if err := verifyFile(filePath, digest); err != nil {
			return Artifact{}, false, err
		}
	} else {
		remove := true
		defer func() {
			if remove {
				_ = os.Remove(filePath)
			}
		}()
		if _, err := file.Write(data); err != nil {
			file.Close()
			return Artifact{}, false, fmt.Errorf("write artifact: %w", err)
		}
		if err := file.Sync(); err != nil {
			file.Close()
			return Artifact{}, false, fmt.Errorf("sync artifact: %w", err)
		}
		if err := file.Close(); err != nil {
			return Artifact{}, false, fmt.Errorf("close artifact: %w", err)
		}
		remove = false
	}

	return Artifact{
		ID:             newID("artifact"),
		JobID:          jobID,
		SourceActionID: sourceActionID,
		Source:         source,
		SHA256:         digest,
		MediaType:      mediaType,
		Size:           int64(len(data)),
		RelativePath:   path.Join(jobID, digest),
	}, created, nil
}

func (s *ArtifactStore) Read(ctx context.Context, artifact Artifact) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateIdentifier("job id", artifact.JobID); err != nil {
		return nil, err
	}
	if len(artifact.SHA256) != sha256.Size*2 {
		return nil, fmt.Errorf("invalid artifact digest")
	}
	expected := path.Join(artifact.JobID, artifact.SHA256)
	if artifact.RelativePath != expected {
		return nil, fmt.Errorf("artifact path does not match identity")
	}
	filePath := filepath.Join(s.root, filepath.FromSlash(expected))
	if err := verifyFile(filePath, artifact.SHA256); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read artifact: %w", err)
	}
	return data, nil
}

func verifyFile(path, expectedDigest string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open artifact for verification: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hash artifact: %w", err)
	}
	if hex.EncodeToString(hash.Sum(nil)) != expectedDigest {
		return fmt.Errorf("artifact digest mismatch")
	}
	return nil
}
