package plugin

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const publisherKeySchema = "milksu.publisher-key/v1"

type publisherKeyFile struct {
	Schema     string `json:"schema"`
	Publisher  string `json:"publisher"`
	KeyID      string `json:"keyId"`
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
}

type PublisherKeyDescriptor struct {
	Publisher string `json:"publisher"`
	KeyID     string `json:"key_id"`
	Path      string `json:"path"`
}

type PackageInspection struct {
	Manifest    Manifest `json:"manifest"`
	Digest      string   `json:"digest"`
	Signers     []string `json:"signers"`
	ArchiveSize int64    `json:"archive_size"`
	FileCount   int      `json:"file_count"`
	Compatible  bool     `json:"compatible"`
	HostVersion string   `json:"host_version"`
}

func GeneratePublisherKey(publisher, outputPath string) (PublisherKeyDescriptor, error) {
	publisher = strings.TrimSpace(publisher)
	if publisher == "" || len(publisher) > 96 {
		return PublisherKeyDescriptor{}, errors.New("publisher name must contain 1-96 characters")
	}
	if _, err := os.Lstat(outputPath); err == nil {
		return PublisherKeyDescriptor{}, errors.New("publisher key destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return PublisherKeyDescriptor{}, err
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return PublisherKeyDescriptor{}, err
	}
	fingerprint := sha256.Sum256(publicKey)
	keyID := hex.EncodeToString(fingerprint[:])
	value := publisherKeyFile{
		Schema: publisherKeySchema, Publisher: publisher, KeyID: keyID,
		PublicKey:  base64.StdEncoding.EncodeToString(publicKey),
		PrivateKey: base64.StdEncoding.EncodeToString(privateKey),
	}
	if err := writeExclusiveAuthorJSON(outputPath, value); err != nil {
		return PublisherKeyDescriptor{}, err
	}
	absolute, _ := filepath.Abs(outputPath)
	return PublisherKeyDescriptor{Publisher: publisher, KeyID: keyID, Path: absolute}, nil
}

func readPublisherKey(path string) (publisherKeyFile, ed25519.PrivateKey, error) {
	var value publisherKeyFile
	if err := readStrictJSONFile(path, maxManifestBytes, &value); err != nil {
		return value, nil, err
	}
	if value.Schema != publisherKeySchema || strings.TrimSpace(value.Publisher) == "" {
		return value, nil, errors.New("publisher key file is invalid")
	}
	privateKey, err := base64.StdEncoding.DecodeString(value.PrivateKey)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return value, nil, errors.New("publisher private key is invalid")
	}
	publicKey := ed25519.PrivateKey(privateKey).Public().(ed25519.PublicKey)
	fingerprint := sha256.Sum256(publicKey)
	if value.KeyID != hex.EncodeToString(fingerprint[:]) || value.PublicKey != base64.StdEncoding.EncodeToString(publicKey) {
		return value, nil, errors.New("publisher key file fingerprint is invalid")
	}
	return value, ed25519.PrivateKey(privateKey), nil
}

func PackPlugin(sourceDirectory, outputPath string, keyPaths []string) (PackageInspection, error) {
	if len(keyPaths) == 0 || len(keyPaths) > 2 {
		return PackageInspection{}, errors.New("pack requires one key, or old and new keys for rotation")
	}
	if strings.ToLower(filepath.Ext(outputPath)) != ".milksu-plugin" {
		return PackageInspection{}, errors.New("package output must end in .milksu-plugin")
	}
	if _, err := os.Lstat(outputPath); err == nil {
		return PackageInspection{}, errors.New("package output already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return PackageInspection{}, err
	}
	temporary, err := os.MkdirTemp("", "milksu-plugin-pack-*")
	if err != nil {
		return PackageInspection{}, err
	}
	defer os.RemoveAll(temporary)
	if err := copyPackageTree(sourceDirectory, temporary); err != nil {
		return PackageInspection{}, err
	}
	_ = os.Remove(filepath.Join(temporary, signatureFileName))
	manifest, err := readManifest(temporary)
	if err != nil {
		return PackageInspection{}, err
	}
	if manifest.APIVersion != APIVersion {
		return PackageInspection{}, errors.New("signed third-party packages must use milksu.plugin/v1")
	}
	if err := validateThirdPartyTools(manifest); err != nil {
		return PackageInspection{}, err
	}
	privateKeys := make([]ed25519.PrivateKey, 0, len(keyPaths))
	keyIDs := make(map[string]struct{}, len(keyPaths))
	for _, keyPath := range keyPaths {
		key, privateKey, err := readPublisherKey(keyPath)
		if err != nil {
			return PackageInspection{}, err
		}
		if key.Publisher != manifest.Publisher.Name {
			return PackageInspection{}, errors.New("publisher key name does not match plugin manifest")
		}
		if _, duplicate := keyIDs[key.KeyID]; duplicate {
			return PackageInspection{}, errors.New("publisher key rotation requires two distinct keys")
		}
		keyIDs[key.KeyID] = struct{}{}
		privateKeys = append(privateKeys, privateKey)
	}
	primaryPublic := privateKeys[len(privateKeys)-1].Public().(ed25519.PublicKey)
	primaryFingerprint := sha256.Sum256(primaryPublic)
	if manifest.Publisher.KeyID != hex.EncodeToString(primaryFingerprint[:]) {
		return PackageInspection{}, errors.New("manifest publisher keyId must match the final/new signing key")
	}
	digest, err := packagePayloadDigest(temporary)
	if err != nil {
		return PackageInspection{}, err
	}
	set, err := buildSignatureSet(manifest.Publisher.Name, digest, privateKeys...)
	if err != nil {
		return PackageInspection{}, err
	}
	signature, err := encodeSignatureSet(set)
	if err != nil {
		return PackageInspection{}, err
	}
	if err := os.WriteFile(filepath.Join(temporary, signatureFileName), signature, 0o600); err != nil {
		return PackageInspection{}, err
	}
	if err := deterministicZip(temporary, outputPath); err != nil {
		return PackageInspection{}, err
	}
	inspection, err := VerifyPluginPackage(outputPath, manifest.Host.MinVersion)
	if err != nil {
		_ = os.Remove(outputPath)
		return PackageInspection{}, err
	}
	return inspection, nil
}

func VerifyPluginPackage(archivePath, hostVersion string) (PackageInspection, error) {
	info, err := os.Lstat(archivePath)
	if err != nil {
		return PackageInspection{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxPackageArchiveBytes {
		return PackageInspection{}, errors.New("plugin archive is not a bounded regular file")
	}
	temporary, err := os.MkdirTemp("", "milksu-plugin-verify-*")
	if err != nil {
		return PackageInspection{}, err
	}
	defer os.RemoveAll(temporary)
	if err := extractPluginArchive(archivePath, temporary); err != nil {
		return PackageInspection{}, err
	}
	manifest, err := readManifest(temporary)
	if err != nil {
		return PackageInspection{}, err
	}
	if manifest.APIVersion != APIVersion {
		return PackageInspection{}, errors.New("third-party package must use milksu.plugin/v1")
	}
	if err := validateThirdPartyTools(manifest); err != nil {
		return PackageInspection{}, err
	}
	digest, err := packagePayloadDigest(temporary)
	if err != nil {
		return PackageInspection{}, err
	}
	set, err := readSignatureSet(temporary)
	if err != nil {
		return PackageInspection{}, err
	}
	proofs, err := verifySignatureSet(set, digest)
	if err != nil {
		return PackageInspection{}, err
	}
	if _, ok := proofs[manifest.Publisher.KeyID]; !ok {
		return PackageInspection{}, errors.New("manifest publisher key did not sign the package")
	}
	paths, err := canonicalArchivePaths(temporary)
	if err != nil {
		return PackageInspection{}, err
	}
	signers := make([]string, 0, len(proofs))
	for keyID := range proofs {
		signers = append(signers, keyID)
	}
	sort.Strings(signers)
	compatible := true
	if strings.TrimSpace(hostVersion) != "" {
		comparison, compareErr := compareSemanticVersions(hostVersion, manifest.Host.MinVersion)
		if compareErr != nil {
			return PackageInspection{}, compareErr
		}
		compatible = comparison >= 0
	}
	return PackageInspection{
		Manifest: manifest, Digest: digest, Signers: signers, ArchiveSize: info.Size(),
		FileCount: len(paths), Compatible: compatible, HostVersion: hostVersion,
	}, nil
}

func TestPluginSource(sourceDirectory string, options Options) (PackageInspection, error) {
	manifest, err := readManifest(sourceDirectory)
	if err != nil {
		return PackageInspection{}, err
	}
	if manifest.APIVersion != APIVersion {
		return PackageInspection{}, errors.New("public plugin source must use milksu.plugin/v1")
	}
	if err := validateThirdPartyTools(manifest); err != nil {
		return PackageInspection{}, err
	}
	registry := &Registry{options: options, state: defaultState(), executor: newRuntimeExecutor(options)}
	if err := registry.validateHostCompatibility(manifest); err != nil {
		return PackageInspection{}, err
	}
	digest, err := packageDigest(sourceDirectory)
	if err != nil {
		return PackageInspection{}, err
	}
	record := &packageRecord{manifest: manifest, directory: sourceDirectory, digest: digest, source: SourceDevelopment}
	request := runtimeInvocation{
		ABI: "health_check", Input: json.RawMessage(`{}`), PluginID: manifest.ID,
		PluginVersion: manifest.Version, APIVersion: manifest.APIVersion,
		HostVersion: options.HostVersion, Capabilities: append([]string(nil), HostCapabilities...),
		Permissions: append([]Permission(nil), manifest.Permissions...), Source: SourceDevelopment,
		StorageEnabled: hasPermission(manifest, PermissionStorage), Storage: map[string]json.RawMessage{},
	}
	if _, err := registry.executor.Invoke(context.Background(), record, request); err != nil {
		return PackageInspection{}, err
	}
	paths, err := canonicalArchivePaths(sourceDirectory)
	if err != nil {
		return PackageInspection{}, err
	}
	return PackageInspection{Manifest: manifest, Digest: digest, FileCount: len(paths), Compatible: true, HostVersion: options.HostVersion}, nil
}

func copyPackageTree(source, destination string) error {
	root, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("plugin source contains symlink: %s", path)
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("plugin source contains non-regular file: %s", path)
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeOutputErr := output.Close()
		closeInputErr := input.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeOutputErr != nil {
			return closeOutputErr
		}
		return closeInputErr
	})
}

func writeExclusiveAuthorJSON(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(payload); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	complete = true
	return nil
}
