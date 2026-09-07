package plugin

import (
	"archive/zip"
	"bytes"
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
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	signatureFileName       = "signature.json"
	signatureSchema         = "milksu.plugin-signature/v1"
	installedIndexSchema    = "milksu.plugin-installed/v1"
	publisherTrustSchema    = "milksu.plugin-publishers/v1"
	maxPackageArchiveBytes  = 16 << 20
	maxPackageMetadataBytes = 512 << 10
	storageSnapshotSchema   = "milksu.plugin-storage-snapshot/v1"
)

type packageSignatureSet struct {
	Schema     string                  `json:"schema"`
	Digest     string                  `json:"digest"`
	Publisher  string                  `json:"publisher"`
	Signatures []packageSignatureProof `json:"signatures"`
}

type packageSignatureProof struct {
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
}

type trustedPublisher struct {
	Name      string `json:"name"`
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
	TrustedAt string `json:"trustedAt"`
}

type publisherTrustStore struct {
	Schema     string                      `json:"schema"`
	Publishers map[string]trustedPublisher `json:"publishers"`
}

type installedVersion struct {
	ID              string `json:"id"`
	Version         string `json:"version"`
	PublisherKeyID  string `json:"publisherKeyId"`
	Directory       string `json:"directory"`
	Digest          string `json:"digest"`
	StorageSnapshot string `json:"storageSnapshot,omitempty"`
}

type storageSnapshot struct {
	Schema  string         `json:"schema"`
	Version uint           `json:"version"`
	Values  map[string]any `json:"values"`
}

type installedPlugin struct {
	Active   installedVersion  `json:"active"`
	Previous *installedVersion `json:"previous,omitempty"`
}

type installedIndex struct {
	Schema  string                     `json:"schema"`
	Plugins map[string]installedPlugin `json:"plugins"`
}

type StagedPackageReview struct {
	Token                string             `json:"token"`
	ID                   string             `json:"id"`
	Name                 string             `json:"name"`
	Version              string             `json:"version"`
	CurrentVersion       string             `json:"current_version,omitempty"`
	Publisher            PublisherSpec      `json:"publisher"`
	Fingerprint          string             `json:"fingerprint"`
	Permissions          []Permission       `json:"permissions"`
	Surfaces             []string           `json:"surfaces"`
	Tools                []ToolContribution `json:"tools"`
	HostMinVersion       string             `json:"host_min_version"`
	RequiredCapabilities []string           `json:"required_capabilities"`
	Trusted              bool               `json:"trusted"`
	KeyRotation          bool               `json:"key_rotation"`
	Upgrade              bool               `json:"upgrade"`
	PermissionExpansion  bool               `json:"permission_expansion"`
	MajorVersionChange   bool               `json:"major_version_change"`
	StorageMigration     bool               `json:"storage_migration"`
	StorageResetRequired bool               `json:"storage_reset_required"`
	Digest               string             `json:"digest"`
}

type stagedPackage struct {
	directory  string
	manifest   Manifest
	signatures packageSignatureSet
	review     StagedPackageReview
}

type PublisherTrustDescriptor struct {
	Name      string `json:"name"`
	KeyID     string `json:"key_id"`
	TrustedAt string `json:"trusted_at"`
}

func defaultInstalledIndex() installedIndex {
	return installedIndex{Schema: installedIndexSchema, Plugins: map[string]installedPlugin{}}
}

func defaultTrustStore() publisherTrustStore {
	return publisherTrustStore{Schema: publisherTrustSchema, Publishers: map[string]trustedPublisher{}}
}

func (r *Registry) installedIndexPath() string {
	return filepath.Join(r.options.DataDirectory, "plugins", "installed.json")
}

func (r *Registry) trustStorePath() string {
	return filepath.Join(r.options.DataDirectory, "plugins", "publishers.json")
}

func (r *Registry) stagingDirectory() string {
	return filepath.Join(r.options.DataDirectory, "plugins", "staging")
}

func (r *Registry) resolveStorageSnapshot(relative string) (string, error) {
	if !fs.ValidPath(relative) || strings.Contains(relative, `\`) {
		return "", errors.New("plugin storage snapshot path is invalid")
	}
	root, err := filepath.Abs(filepath.Join(r.options.DataDirectory, "plugins", "rollback"))
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, filepath.FromSlash(relative))
	check, err := filepath.Rel(root, path)
	if err != nil || check == ".." || strings.HasPrefix(check, ".."+string(filepath.Separator)) {
		return "", errors.New("plugin storage snapshot escapes its managed directory")
	}
	return path, nil
}

func (r *Registry) writeStorageSnapshot(id string, version installedVersion, state persistedState) (string, error) {
	values := state.Storage[id]
	if values == nil {
		values = map[string]any{}
	}
	encoded, err := json.Marshal(values)
	if err != nil || len(values) > 64 || len(encoded) > maxPluginStorageBytes {
		return "", errors.New("plugin storage cannot be snapshotted within its quota")
	}
	storageVersion := state.StorageVersions[id]
	if storageVersion == 0 {
		if directory, pathErr := r.resolveInstalledDirectory(version.Directory); pathErr == nil {
			if manifest, manifestErr := readManifest(directory); manifestErr == nil {
				storageVersion = manifest.StorageVersion
			}
		}
		if storageVersion == 0 {
			storageVersion = 1
		}
	}
	relative := filepath.ToSlash(filepath.Join(id, version.Version+"-"+version.Digest[:16]+".json"))
	path, err := r.resolveStorageSnapshot(relative)
	if err != nil {
		return "", err
	}
	if err := atomicWriteJSON(path, storageSnapshot{Schema: storageSnapshotSchema, Version: storageVersion, Values: values}); err != nil {
		return "", err
	}
	return relative, nil
}

func (r *Registry) readStorageSnapshot(relative string) (storageSnapshot, error) {
	path, err := r.resolveStorageSnapshot(relative)
	if err != nil {
		return storageSnapshot{}, err
	}
	var value storageSnapshot
	if err := readStrictJSONFile(path, maxPackageMetadataBytes, &value); err != nil {
		return storageSnapshot{}, err
	}
	if value.Schema != storageSnapshotSchema || value.Version == 0 {
		return storageSnapshot{}, errors.New("plugin storage snapshot is invalid")
	}
	if _, err := mergeStorageWrites(value.Values, nil); err != nil {
		return storageSnapshot{}, err
	}
	return value, nil
}

func readInstalledIndex(path string) (installedIndex, error) {
	value := defaultInstalledIndex()
	if err := readStrictJSONFile(path, maxPackageMetadataBytes, &value); errors.Is(err, os.ErrNotExist) {
		return value, nil
	} else if err != nil {
		return value, fmt.Errorf("read installed plugin index: %w", err)
	}
	if value.Schema != installedIndexSchema {
		return defaultInstalledIndex(), fmt.Errorf("unsupported installed plugin index schema %q", value.Schema)
	}
	if value.Plugins == nil {
		value.Plugins = map[string]installedPlugin{}
	}
	return value, nil
}

func readTrustStore(path string) (publisherTrustStore, error) {
	value := defaultTrustStore()
	if err := readStrictJSONFile(path, maxPackageMetadataBytes, &value); errors.Is(err, os.ErrNotExist) {
		return value, nil
	} else if err != nil {
		return value, fmt.Errorf("read publisher trust store: %w", err)
	}
	if value.Schema != publisherTrustSchema {
		return defaultTrustStore(), fmt.Errorf("unsupported publisher trust schema %q", value.Schema)
	}
	if value.Publishers == nil {
		value.Publishers = map[string]trustedPublisher{}
	}
	return value, nil
}

func readStrictJSONFile(path string, limit int64, target any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > limit {
		return errors.New("metadata must be a bounded regular, non-symlink file")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, limit+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("metadata contains trailing JSON data")
	}
	return nil
}

func atomicWriteJSON(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if len(payload) > maxPackageMetadataBytes {
		return errors.New("plugin metadata is too large")
	}
	payload = append(payload, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".plugin-metadata-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	return nil
}

func (r *Registry) loadInstalledLocked() {
	index, err := readInstalledIndex(r.installedIndexPath())
	if err != nil {
		r.addIssueLocked("installed", SourceInstalled, err.Error())
		return
	}
	trust, err := readTrustStore(r.trustStorePath())
	if err != nil {
		r.addIssueLocked("installed", SourceInstalled, err.Error())
		return
	}
	ids := make([]string, 0, len(index.Plugins))
	for id := range index.Plugins {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		installed := index.Plugins[id]
		entry := installed.Active
		if _, occupied := r.items[id]; occupied {
			r.addIssueLocked(id, SourceInstalled, "installed plugin cannot shadow an official plugin")
			continue
		}
		directory, pathErr := r.resolveInstalledDirectory(entry.Directory)
		if pathErr != nil {
			r.addIssueLocked(id, SourceInstalled, pathErr.Error())
			continue
		}
		manifest, digest, _, verifyErr := verifyInstalledDirectory(directory, trust)
		if verifyErr != nil {
			r.addIssueLocked(id, SourceInstalled, verifyErr.Error())
			continue
		}
		if manifest.APIVersion != APIVersion || manifest.ID != id || manifest.Version != entry.Version || manifest.Publisher.KeyID != entry.PublisherKeyID || !strings.EqualFold(digest, entry.Digest) {
			r.addIssueLocked(id, SourceInstalled, "installed plugin metadata does not match its signed package")
			continue
		}
		r.addPackageLocked(directory, manifest, digest, SourceInstalled)
		r.items[id].canRollback = installed.Previous != nil
	}
}

func (r *Registry) resolveInstalledDirectory(relative string) (string, error) {
	if !fs.ValidPath(relative) || strings.Contains(relative, `\`) {
		return "", errors.New("installed plugin path is invalid")
	}
	root, err := filepath.Abs(r.options.InstalledDirectory)
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, filepath.FromSlash(relative))
	relativeCheck, err := filepath.Rel(root, path)
	if err != nil || relativeCheck == ".." || strings.HasPrefix(relativeCheck, ".."+string(filepath.Separator)) {
		return "", errors.New("installed plugin path escapes its managed directory")
	}
	return path, nil
}

func readSignatureSet(directory string) (packageSignatureSet, error) {
	path, err := securePackageFile(directory, signatureFileName, maxManifestBytes)
	if err != nil {
		return packageSignatureSet{}, fmt.Errorf("package signature: %w", err)
	}
	var set packageSignatureSet
	if err := readStrictJSONFile(path, maxManifestBytes, &set); err != nil {
		return set, fmt.Errorf("package signature: %w", err)
	}
	if set.Schema != signatureSchema || !validDigest(set.Digest) || strings.TrimSpace(set.Publisher) == "" || len(set.Signatures) == 0 || len(set.Signatures) > 2 {
		return set, errors.New("package signature metadata is invalid")
	}
	return set, nil
}

func verifySignatureSet(set packageSignatureSet, digest string) (map[string]packageSignatureProof, error) {
	if !strings.EqualFold(set.Digest, digest) {
		return nil, errors.New("signed package digest does not match its contents")
	}
	message := []byte("milksu.plugin-package/v1\n" + strings.ToLower(digest))
	valid := make(map[string]packageSignatureProof, len(set.Signatures))
	for _, proof := range set.Signatures {
		publicKey, err := base64.StdEncoding.DecodeString(proof.PublicKey)
		if err != nil || len(publicKey) != ed25519.PublicKeySize {
			return nil, errors.New("publisher public key is invalid")
		}
		fingerprint := sha256.Sum256(publicKey)
		keyID := hex.EncodeToString(fingerprint[:])
		if proof.KeyID != keyID {
			return nil, errors.New("publisher key fingerprint does not match its public key")
		}
		signature, err := base64.StdEncoding.DecodeString(proof.Signature)
		if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), message, signature) {
			return nil, errors.New("plugin package signature is invalid")
		}
		if _, duplicate := valid[keyID]; duplicate {
			return nil, errors.New("plugin package contains a duplicate signature")
		}
		valid[keyID] = proof
	}
	return valid, nil
}

func verifyInstalledDirectory(directory string, trust publisherTrustStore) (Manifest, string, packageSignatureSet, error) {
	manifest, err := readManifest(directory)
	if err != nil {
		return Manifest{}, "", packageSignatureSet{}, err
	}
	if manifest.APIVersion != APIVersion {
		return Manifest{}, "", packageSignatureSet{}, errors.New("third-party packages must use milksu.plugin/v1")
	}
	if err := validateThirdPartyTools(manifest); err != nil {
		return Manifest{}, "", packageSignatureSet{}, err
	}
	digest, err := packagePayloadDigest(directory)
	if err != nil {
		return Manifest{}, "", packageSignatureSet{}, err
	}
	set, err := readSignatureSet(directory)
	if err != nil {
		return Manifest{}, "", set, err
	}
	if set.Publisher != manifest.Publisher.Name {
		return Manifest{}, "", set, errors.New("signature publisher does not match the manifest")
	}
	proofs, err := verifySignatureSet(set, digest)
	if err != nil {
		return Manifest{}, "", set, err
	}
	primary, ok := proofs[manifest.Publisher.KeyID]
	if !ok || manifest.Publisher.KeyID == "" {
		return Manifest{}, "", set, errors.New("manifest publisher key is not a valid package signer")
	}
	trusted, ok := trust.Publishers[manifest.Publisher.KeyID]
	if !ok || trusted.PublicKey != primary.PublicKey || trusted.Name != manifest.Publisher.Name {
		return Manifest{}, "", set, errors.New("plugin publisher is not trusted")
	}
	return manifest, digest, set, nil
}

func (r *Registry) StagePackage(selectedPath string) (StagedPackageReview, error) {
	r.packageMu.Lock()
	defer r.packageMu.Unlock()
	info, err := os.Lstat(selectedPath)
	if err != nil {
		return StagedPackageReview{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxPackageArchiveBytes {
		return StagedPackageReview{}, fmt.Errorf("plugin package must be a regular .milksu-plugin file no larger than %d MiB", maxPackageArchiveBytes>>20)
	}
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return StagedPackageReview{}, err
	}
	token := hex.EncodeToString(tokenBytes)
	directory := filepath.Join(r.stagingDirectory(), token)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return StagedPackageReview{}, err
	}
	failed := true
	defer func() {
		if failed {
			_ = os.RemoveAll(directory)
		}
	}()
	if err := extractPluginArchive(selectedPath, directory); err != nil {
		return StagedPackageReview{}, err
	}
	manifest, err := readManifest(directory)
	if err != nil {
		return StagedPackageReview{}, err
	}
	if manifest.APIVersion != APIVersion {
		return StagedPackageReview{}, errors.New("third-party installation accepts only milksu.plugin/v1 packages")
	}
	if err := validateThirdPartyTools(manifest); err != nil {
		return StagedPackageReview{}, err
	}
	if err := r.validateHostCompatibility(manifest); err != nil {
		return StagedPackageReview{}, err
	}
	digest, err := packagePayloadDigest(directory)
	if err != nil {
		return StagedPackageReview{}, err
	}
	signatures, err := readSignatureSet(directory)
	if err != nil {
		return StagedPackageReview{}, err
	}
	if signatures.Publisher != manifest.Publisher.Name {
		return StagedPackageReview{}, errors.New("signature publisher does not match the manifest")
	}
	proofs, err := verifySignatureSet(signatures, digest)
	if err != nil {
		return StagedPackageReview{}, err
	}
	primary, ok := proofs[manifest.Publisher.KeyID]
	if !ok || manifest.Publisher.KeyID == "" {
		return StagedPackageReview{}, errors.New("manifest publisher key is not a valid package signer")
	}
	trust, err := readTrustStore(r.trustStorePath())
	if err != nil {
		return StagedPackageReview{}, err
	}
	primaryTrusted := trustedProof(trust, manifest.Publisher.Name, primary)
	rotationTrusted := false
	for keyID, proof := range proofs {
		if keyID != manifest.Publisher.KeyID && trustedProof(trust, manifest.Publisher.Name, proof) {
			rotationTrusted = true
		}
	}
	index, err := readInstalledIndex(r.installedIndexPath())
	if err != nil {
		return StagedPackageReview{}, err
	}
	review := StagedPackageReview{
		Token: token, ID: manifest.ID, Name: manifest.Name, Version: manifest.Version,
		Publisher: manifest.Publisher, Fingerprint: manifest.Publisher.KeyID,
		Permissions:          append([]Permission(nil), manifest.Permissions...),
		Surfaces:             append([]string(nil), manifest.Contributes.Slots...),
		Tools:                append([]ToolContribution(nil), manifest.Contributes.Tools...),
		HostMinVersion:       manifest.Host.MinVersion,
		RequiredCapabilities: append([]string(nil), manifest.Host.RequiredCapabilities...),
		Trusted:              primaryTrusted || rotationTrusted, KeyRotation: !primaryTrusted && rotationTrusted,
		Digest: digest,
	}
	if current, exists := index.Plugins[manifest.ID]; exists {
		review.Upgrade = true
		review.CurrentVersion = current.Active.Version
		comparison, compareErr := compareSemanticVersions(manifest.Version, current.Active.Version)
		if compareErr != nil || comparison <= 0 {
			return StagedPackageReview{}, errors.New("plugin upgrade version must increase strictly")
		}
		if current.Active.PublisherKeyID != manifest.Publisher.KeyID {
			if _, oldSigned := proofs[current.Active.PublisherKeyID]; !oldSigned || !rotationTrusted {
				return StagedPackageReview{}, errors.New("publisher key change requires valid signatures from both the old and new keys")
			}
			review.KeyRotation = true
		}
		currentDirectory, pathErr := r.resolveInstalledDirectory(current.Active.Directory)
		if pathErr != nil {
			return StagedPackageReview{}, pathErr
		}
		currentManifest, currentDigest, _, verifyErr := verifyInstalledDirectory(currentDirectory, trust)
		if verifyErr != nil || currentManifest.ID != manifest.ID || currentManifest.Version != current.Active.Version || !strings.EqualFold(currentDigest, current.Active.Digest) {
			return StagedPackageReview{}, errors.New("current plugin version failed signature or integrity verification")
		}
		review.PermissionExpansion = permissionsExpanded(currentManifest.Permissions, manifest.Permissions)
		currentStorageVersion := currentManifest.StorageVersion
		r.mu.Lock()
		if err := r.refreshStateLocked(); err != nil {
			r.mu.Unlock()
			return StagedPackageReview{}, err
		}
		if persisted := r.state.StorageVersions[manifest.ID]; persisted != 0 {
			currentStorageVersion = persisted
		}
		hasStoredData := len(r.state.Storage[manifest.ID]) > 0
		r.mu.Unlock()
		if manifest.StorageVersion < currentStorageVersion {
			return StagedPackageReview{}, errors.New("plugin upgrade cannot decrease storageVersion")
		}
		if manifest.StorageVersion > currentStorageVersion && hasStoredData {
			review.StorageMigration = hasStorageMigration(manifest, currentStorageVersion, manifest.StorageVersion)
			review.StorageResetRequired = !review.StorageMigration
		}
		currentSemver, _ := parseSemanticVersion(currentManifest.Version)
		nextSemver, _ := parseSemanticVersion(manifest.Version)
		review.MajorVersionChange = currentSemver.major != nextSemver.major
		if !review.MajorVersionChange {
			if err := validateSameMajorCompatibility(currentManifest, manifest); err != nil {
				return StagedPackageReview{}, err
			}
		}
	} else {
		r.mu.RLock()
		existing := r.items[manifest.ID]
		r.mu.RUnlock()
		if existing != nil && existing.source == SourceOfficial {
			return StagedPackageReview{}, errors.New("third-party package cannot replace an official plugin")
		}
	}
	probe := &packageRecord{manifest: manifest, directory: directory, digest: digest, source: SourceInstalled}
	healthRequest := r.runtimeInvocation(probe, "health_check", "", json.RawMessage(`{}`))
	healthRequest.Storage = map[string]json.RawMessage{}
	if _, err := r.executor.Invoke(context.Background(), probe, healthRequest); err != nil {
		return StagedPackageReview{}, fmt.Errorf("plugin runtime health check failed: %w", err)
	}
	r.mu.Lock()
	r.staged[token] = &stagedPackage{directory: directory, manifest: manifest, signatures: signatures, review: review}
	r.mu.Unlock()
	failed = false
	return review, nil
}

func validateThirdPartyTools(manifest Manifest) error {
	for _, tool := range manifest.Contributes.Tools {
		if tool.Effect != ToolEffectRead {
			return fmt.Errorf("third-party v1 tool %q must be read-only", tool.Name)
		}
	}
	return nil
}

func hasStorageMigration(manifest Manifest, from, to uint) bool {
	for _, migration := range manifest.StorageMigrations {
		if migration.From == from && migration.To == to {
			return true
		}
	}
	return false
}

func trustedProof(store publisherTrustStore, publisher string, proof packageSignatureProof) bool {
	trusted, ok := store.Publishers[proof.KeyID]
	return ok && trusted.Name == publisher && trusted.PublicKey == proof.PublicKey
}

func permissionsExpanded(current, next []Permission) bool {
	seen := make(map[Permission]struct{}, len(current))
	for _, permission := range current {
		seen[permission] = struct{}{}
	}
	for _, permission := range next {
		if _, exists := seen[permission]; !exists {
			return true
		}
	}
	return false
}

// DiscardStagedPackage releases a reviewed package that the user canceled.
// It is intentionally idempotent so frame teardown can call it defensively.
func (r *Registry) DiscardStagedPackage(token string) {
	r.packageMu.Lock()
	defer r.packageMu.Unlock()
	token = strings.TrimSpace(token)
	r.mu.Lock()
	staged := r.staged[token]
	if staged != nil {
		delete(r.staged, token)
	}
	r.mu.Unlock()
	if staged != nil {
		_ = os.RemoveAll(staged.directory)
	}
}

func (r *Registry) InstallStagedPackage(token string, trustPublisher, confirmSensitiveChange, resetStorage bool) ([]Descriptor, error) {
	r.packageMu.Lock()
	defer r.packageMu.Unlock()
	token = strings.TrimSpace(token)
	r.mu.Lock()
	staged := r.staged[token]
	r.mu.Unlock()
	if staged == nil {
		return nil, errors.New("staged plugin review expired or does not exist")
	}
	digest, err := packagePayloadDigest(staged.directory)
	if err != nil || digest != staged.review.Digest {
		r.mu.Lock()
		if r.staged[token] == staged {
			delete(r.staged, token)
		}
		r.mu.Unlock()
		_ = os.RemoveAll(staged.directory)
		return nil, errors.New("staged plugin changed after review")
	}
	proofs, err := verifySignatureSet(staged.signatures, digest)
	if err != nil {
		return nil, err
	}
	primary := proofs[staged.manifest.Publisher.KeyID]
	trust, err := readTrustStore(r.trustStorePath())
	if err != nil {
		return nil, err
	}
	trusted := trustedProof(trust, staged.manifest.Publisher.Name, primary)
	if !trusted && !staged.review.KeyRotation && !trustPublisher {
		return nil, errors.New("publisher trust confirmation is required")
	}
	if (staged.review.PermissionExpansion || staged.review.MajorVersionChange) && !confirmSensitiveChange {
		return nil, errors.New("permission expansion or major-version change requires explicit confirmation")
	}
	if staged.review.StorageResetRequired && !resetStorage {
		return nil, errors.New("upgrade has no storage migration; reset plugin data or cancel the upgrade")
	}
	// Keep the reviewed package available while the UI is collecting explicit
	// confirmations. Consume it exactly once only after every required consent
	// has been supplied.
	r.mu.Lock()
	if r.staged[token] != staged {
		r.mu.Unlock()
		return nil, errors.New("staged plugin review expired or was already consumed")
	}
	delete(r.staged, token)
	r.mu.Unlock()
	keepStaging := false
	defer func() {
		if !keepStaging {
			_ = os.RemoveAll(staged.directory)
		}
	}()
	trustChanged := !trusted
	if trustChanged {
		trust.Publishers[primary.KeyID] = trustedPublisher{
			Name: staged.manifest.Publisher.Name, KeyID: primary.KeyID, PublicKey: primary.PublicKey,
			TrustedAt: time.Now().UTC().Format(time.RFC3339),
		}
	}
	index, err := readInstalledIndex(r.installedIndexPath())
	if err != nil {
		return nil, err
	}
	versionDirectory := staged.manifest.Version + "-" + digest[:16]
	relative := filepath.ToSlash(filepath.Join(staged.manifest.ID, versionDirectory))
	destination, err := r.resolveInstalledDirectory(relative)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(destination); err == nil {
		return nil, errors.New("this signed plugin version is already installed")
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return nil, err
	}
	previousPlugin, upgrading := index.Plugins[staged.manifest.ID]
	nextState, previousState, err := r.prepareStagedStorageState(staged, resetStorage)
	if err != nil {
		return nil, err
	}
	if err := os.Rename(staged.directory, destination); err != nil {
		return nil, err
	}
	keepStaging = true
	entry := installedVersion{
		ID: staged.manifest.ID, Version: staged.manifest.Version,
		PublisherKeyID: staged.manifest.Publisher.KeyID, Directory: relative, Digest: digest,
	}
	previousIndex, err := cloneInstalledIndex(index)
	if err != nil {
		_ = os.Rename(destination, staged.directory)
		keepStaging = false
		return nil, err
	}
	next := installedPlugin{Active: entry}
	snapshotPath := ""
	if upgrading {
		old := previousPlugin.Active
		snapshotPath, err = r.writeStorageSnapshot(staged.manifest.ID, old, previousState)
		if err != nil {
			_ = os.Rename(destination, staged.directory)
			keepStaging = false
			return nil, err
		}
		old.StorageSnapshot = snapshotPath
		next.Previous = &old
	}
	index.Plugins[staged.manifest.ID] = next
	if err := atomicWriteJSON(r.installedIndexPath(), index); err != nil {
		if snapshotPath != "" {
			if snapshot, pathErr := r.resolveStorageSnapshot(snapshotPath); pathErr == nil {
				_ = os.Remove(snapshot)
			}
		}
		_ = os.Rename(destination, staged.directory)
		keepStaging = false
		return nil, err
	}
	if err := writeState(r.statePath(), nextState); err != nil {
		_ = atomicWriteJSON(r.installedIndexPath(), previousIndex)
		_ = writeState(r.statePath(), previousState)
		_ = os.Rename(destination, staged.directory)
		if snapshotPath != "" {
			if snapshot, pathErr := r.resolveStorageSnapshot(snapshotPath); pathErr == nil {
				_ = os.Remove(snapshot)
			}
		}
		keepStaging = false
		return nil, err
	}
	if trustChanged {
		if err := atomicWriteJSON(r.trustStorePath(), trust); err != nil {
			_ = atomicWriteJSON(r.installedIndexPath(), previousIndex)
			_ = writeState(r.statePath(), previousState)
			_ = os.Rename(destination, staged.directory)
			if snapshotPath != "" {
				if snapshot, pathErr := r.resolveStorageSnapshot(snapshotPath); pathErr == nil {
					_ = os.Remove(snapshot)
				}
			}
			keepStaging = false
			return nil, err
		}
	}
	if upgrading && previousPlugin.Previous != nil {
		if oldDirectory, pathErr := r.resolveInstalledDirectory(previousPlugin.Previous.Directory); pathErr == nil {
			_ = os.RemoveAll(oldDirectory)
		}
		if previousPlugin.Previous.StorageSnapshot != "" {
			if snapshot, pathErr := r.resolveStorageSnapshot(previousPlugin.Previous.StorageSnapshot); pathErr == nil {
				_ = os.Remove(snapshot)
			}
		}
	}
	r.mu.Lock()
	r.reloadLocked()
	r.mu.Unlock()
	return r.List(), nil
}

func cloneInstalledIndex(value installedIndex) (installedIndex, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return installedIndex{}, err
	}
	var clone installedIndex
	err = json.Unmarshal(payload, &clone)
	return clone, err
}

func clonePersistedState(value persistedState) (persistedState, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return persistedState{}, err
	}
	var clone persistedState
	if err := json.Unmarshal(payload, &clone); err != nil {
		return persistedState{}, err
	}
	if clone.Enabled == nil {
		clone.Enabled = map[string]bool{}
	}
	if clone.External == nil {
		clone.External = map[string]bool{}
	}
	if clone.Skin == nil {
		clone.Skin = map[string]skinState{}
	}
	if clone.Storage == nil {
		clone.Storage = map[string]map[string]any{}
	}
	if clone.StorageVersions == nil {
		clone.StorageVersions = map[string]uint{}
	}
	return clone, nil
}

func (r *Registry) prepareStagedStorageState(staged *stagedPackage, resetStorage bool) (persistedState, persistedState, error) {
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return persistedState{}, persistedState{}, err
	}
	previous, err := clonePersistedState(r.state)
	if err != nil {
		r.mu.Unlock()
		return persistedState{}, persistedState{}, err
	}
	next, err := clonePersistedState(r.state)
	r.mu.Unlock()
	if err != nil {
		return persistedState{}, persistedState{}, err
	}
	id := staged.manifest.ID
	if resetStorage {
		delete(next.Storage, id)
	} else if staged.review.StorageMigration {
		from := previous.StorageVersions[id]
		if from == 0 {
			index, indexErr := readInstalledIndex(r.installedIndexPath())
			if indexErr != nil {
				return persistedState{}, persistedState{}, indexErr
			}
			currentDirectory, pathErr := r.resolveInstalledDirectory(index.Plugins[id].Active.Directory)
			if pathErr != nil {
				return persistedState{}, persistedState{}, pathErr
			}
			currentManifest, manifestErr := readManifest(currentDirectory)
			if manifestErr != nil {
				return persistedState{}, persistedState{}, manifestErr
			}
			from = currentManifest.StorageVersion
		}
		input, _ := json.Marshal(map[string]uint{"from": from, "to": staged.manifest.StorageVersion})
		record := &packageRecord{manifest: staged.manifest, directory: staged.directory, digest: staged.review.Digest, source: SourceInstalled}
		result, invokeErr := r.executor.Invoke(context.Background(), record, r.runtimeInvocation(record, "migrate_storage", "", input))
		if invokeErr != nil {
			return persistedState{}, persistedState{}, fmt.Errorf("plugin storage migration failed: %w", invokeErr)
		}
		values, writeErr := mergeStorageWrites(next.Storage[id], result.StorageWrites)
		if writeErr != nil {
			return persistedState{}, persistedState{}, writeErr
		}
		next.Storage[id] = values
	}
	next.StorageVersions[id] = staged.manifest.StorageVersion
	if !hasPermission(staged.manifest, PermissionMCPExternalRead) {
		next.External[id] = false
	}
	return next, previous, nil
}

func mergeStorageWrites(current map[string]any, writes map[string]json.RawMessage) (map[string]any, error) {
	values := make(map[string]any, len(current)+len(writes))
	for key, value := range current {
		values[key] = value
	}
	for key, raw := range writes {
		if string(raw) == "null" {
			delete(values, key)
			continue
		}
		var value any
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		values[key] = value
	}
	if len(values) > 64 {
		return nil, errors.New("plugin storage exceeds its 64-key quota")
	}
	encoded, err := json.Marshal(values)
	if err != nil || len(encoded) > maxPluginStorageBytes {
		return nil, errors.New("plugin storage exceeds its 256 KiB quota")
	}
	return values, nil
}

func (r *Registry) RollbackPlugin(id string) ([]Descriptor, error) {
	r.packageMu.Lock()
	defer r.packageMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	index, err := readInstalledIndex(r.installedIndexPath())
	if err != nil {
		return nil, err
	}
	entry, ok := index.Plugins[id]
	if !ok || entry.Previous == nil {
		return nil, errors.New("plugin has no retained version to roll back to")
	}
	trust, err := readTrustStore(r.trustStorePath())
	if err != nil {
		return nil, err
	}
	previousDirectory, err := r.resolveInstalledDirectory(entry.Previous.Directory)
	if err != nil {
		return nil, err
	}
	if _, digest, _, err := verifyInstalledDirectory(previousDirectory, trust); err != nil || digest != entry.Previous.Digest {
		return nil, errors.New("retained plugin version failed signature or integrity verification")
	}
	if err := r.refreshStateLocked(); err != nil {
		return nil, err
	}
	previousState, err := clonePersistedState(r.state)
	if err != nil {
		return nil, err
	}
	nextState, err := clonePersistedState(r.state)
	if err != nil {
		return nil, err
	}
	currentSnapshot, err := r.writeStorageSnapshot(id, entry.Active, r.state)
	if err != nil {
		return nil, err
	}
	keepCurrentSnapshot := false
	defer func() {
		if keepCurrentSnapshot {
			return
		}
		if snapshot, pathErr := r.resolveStorageSnapshot(currentSnapshot); pathErr == nil {
			_ = os.Remove(snapshot)
		}
	}()
	target := *entry.Previous
	targetSnapshotPath := target.StorageSnapshot
	if targetSnapshotPath != "" {
		snapshot, snapshotErr := r.readStorageSnapshot(targetSnapshotPath)
		if snapshotErr != nil {
			return nil, fmt.Errorf("read rollback storage snapshot: %w", snapshotErr)
		}
		nextState.Storage[id] = snapshot.Values
		nextState.StorageVersions[id] = snapshot.Version
	}
	active := entry.Active
	active.StorageSnapshot = currentSnapshot
	target.StorageSnapshot = ""
	entry.Active = target
	entry.Previous = &active
	previousIndex, err := cloneInstalledIndex(index)
	if err != nil {
		return nil, err
	}
	index.Plugins[id] = entry
	if err := atomicWriteJSON(r.installedIndexPath(), index); err != nil {
		return nil, err
	}
	if err := r.commitStateLocked(nextState); err != nil {
		_ = atomicWriteJSON(r.installedIndexPath(), previousIndex)
		_ = writeState(r.statePath(), previousState)
		return nil, err
	}
	if targetSnapshotPath != "" {
		if snapshot, pathErr := r.resolveStorageSnapshot(targetSnapshotPath); pathErr == nil {
			_ = os.Remove(snapshot)
		}
	}
	keepCurrentSnapshot = true
	r.reloadLocked()
	result := make([]Descriptor, 0, len(r.items)+len(r.issues))
	for _, record := range r.items {
		result = append(result, r.descriptorLocked(record))
	}
	result = append(result, r.issues...)
	return result, nil
}

func (r *Registry) UninstallPlugin(id string, deleteData bool) ([]Descriptor, error) {
	r.packageMu.Lock()
	defer r.packageMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	index, err := readInstalledIndex(r.installedIndexPath())
	if err != nil {
		return nil, err
	}
	entry, ok := index.Plugins[id]
	if !ok {
		return nil, errors.New("third-party plugin is not installed")
	}
	if err := r.refreshStateLocked(); err != nil {
		return nil, err
	}
	previousIndex, err := cloneInstalledIndex(index)
	if err != nil {
		return nil, err
	}
	nextState, err := clonePersistedState(r.state)
	if err != nil {
		return nil, err
	}
	delete(index.Plugins, id)
	nextState.Enabled[id] = false
	nextState.External[id] = false
	if deleteData {
		delete(nextState.Storage, id)
		delete(nextState.StorageVersions, id)
		delete(nextState.Skin, id)
	}
	if err := atomicWriteJSON(r.installedIndexPath(), index); err != nil {
		return nil, err
	}
	if err := r.commitStateLocked(nextState); err != nil {
		_ = atomicWriteJSON(r.installedIndexPath(), previousIndex)
		return nil, err
	}
	if activeDirectory, pathErr := r.resolveInstalledDirectory(entry.Active.Directory); pathErr == nil {
		_ = os.RemoveAll(activeDirectory)
	}
	if entry.Previous != nil {
		if previousDirectory, pathErr := r.resolveInstalledDirectory(entry.Previous.Directory); pathErr == nil {
			_ = os.RemoveAll(previousDirectory)
		}
	}
	for _, version := range []*installedVersion{&entry.Active, entry.Previous} {
		if version != nil && version.StorageSnapshot != "" {
			if snapshot, pathErr := r.resolveStorageSnapshot(version.StorageSnapshot); pathErr == nil {
				_ = os.Remove(snapshot)
			}
		}
	}
	if deleteData {
		_ = os.RemoveAll(r.pluginStorageDirectory(id))
	}
	r.reloadLocked()
	result := make([]Descriptor, 0, len(r.items)+len(r.issues))
	for _, record := range r.items {
		result = append(result, r.descriptorLocked(record))
	}
	result = append(result, r.issues...)
	return result, nil
}

func (r *Registry) SetExternalEnabled(id string, enabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.refreshStateLocked(); err != nil {
		return err
	}
	record := r.items[id]
	if record == nil || record.errorText != "" {
		return errors.New("plugin is unavailable")
	}
	if enabled && (!r.state.Enabled[id] || !hasPermission(record.manifest, PermissionMCPExternalRead)) {
		return errors.New("plugin must be enabled and granted mcp.external.read before external exposure")
	}
	next, err := clonePersistedState(r.state)
	if err != nil {
		return err
	}
	next.External[id] = enabled
	return r.commitStateLocked(next)
}

func (r *Registry) TrustedPublishers() ([]PublisherTrustDescriptor, error) {
	trust, err := readTrustStore(r.trustStorePath())
	if err != nil {
		return nil, err
	}
	result := make([]PublisherTrustDescriptor, 0, len(trust.Publishers))
	for _, publisher := range trust.Publishers {
		result = append(result, PublisherTrustDescriptor{Name: publisher.Name, KeyID: publisher.KeyID, TrustedAt: publisher.TrustedAt})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].KeyID < result[j].KeyID })
	return result, nil
}

func (r *Registry) RevokePublisher(keyID string) ([]Descriptor, error) {
	r.packageMu.Lock()
	defer r.packageMu.Unlock()
	keyID = strings.TrimSpace(keyID)
	trust, err := readTrustStore(r.trustStorePath())
	if err != nil {
		return nil, err
	}
	if _, exists := trust.Publishers[keyID]; !exists {
		return r.List(), nil
	}
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return nil, err
	}
	previousState, err := clonePersistedState(r.state)
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	nextState, err := clonePersistedState(r.state)
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	for id, record := range r.items {
		if record.source == SourceInstalled && record.manifest.Publisher.KeyID == keyID {
			nextState.Enabled[id] = false
			nextState.External[id] = false
		}
	}
	if err := r.commitStateLocked(nextState); err != nil {
		r.mu.Unlock()
		return nil, err
	}
	delete(trust.Publishers, keyID)
	if err := atomicWriteJSON(r.trustStorePath(), trust); err != nil {
		if rollbackErr := r.commitStateLocked(previousState); rollbackErr != nil {
			r.mu.Unlock()
			return nil, fmt.Errorf("revoke publisher trust: %v (restore plugin state: %w)", err, rollbackErr)
		}
		r.mu.Unlock()
		return nil, err
	}
	r.reloadLocked()
	r.mu.Unlock()
	return r.List(), nil
}

func extractPluginArchive(archivePath, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open plugin package: %w", err)
	}
	defer reader.Close()
	if len(reader.File) == 0 || len(reader.File) > maxPackageFiles {
		return fmt.Errorf("plugin package must contain between 1 and %d files", maxPackageFiles)
	}
	caseFolded := make(map[string]string, len(reader.File))
	var total uint64
	for _, entry := range reader.File {
		name := strings.TrimSuffix(entry.Name, "/")
		if name == "" || !fs.ValidPath(name) || strings.Contains(entry.Name, `\`) {
			return fmt.Errorf("plugin archive path %q is invalid", entry.Name)
		}
		folded := strings.ToLower(name)
		if previous, collision := caseFolded[folded]; collision && previous != name {
			return fmt.Errorf("plugin archive paths collide across filesystems: %s and %s", previous, name)
		}
		if previous, duplicate := caseFolded[folded]; duplicate && previous == name {
			return fmt.Errorf("plugin archive contains duplicate path %q", name)
		}
		caseFolded[folded] = name
		mode := entry.Mode()
		if mode&os.ModeSymlink != 0 || (!mode.IsRegular() && !mode.IsDir()) {
			return fmt.Errorf("plugin archive entry %q is not a regular file or directory", name)
		}
		if entry.Method != zip.Store && entry.Method != zip.Deflate {
			return fmt.Errorf("plugin archive entry %q uses an unsupported compression method", name)
		}
		if mode.IsDir() {
			continue
		}
		total += entry.UncompressedSize64
		if entry.UncompressedSize64 > maxPackageBytes || total > maxPackageBytes {
			return fmt.Errorf("plugin package expands beyond %d MiB", maxPackageBytes>>20)
		}
		if entry.CompressedSize64 > 0 && entry.UncompressedSize64 > entry.CompressedSize64*1000 {
			return fmt.Errorf("plugin archive entry %q has a suspicious compression ratio", name)
		}
		path := filepath.Join(destination, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			input.Close()
			return err
		}
		written, copyErr := io.Copy(output, io.LimitReader(input, int64(entry.UncompressedSize64)+1))
		closeOutputErr := output.Close()
		closeInputErr := input.Close()
		if copyErr != nil || closeOutputErr != nil || closeInputErr != nil || written != int64(entry.UncompressedSize64) {
			return fmt.Errorf("extract plugin archive entry %q failed", name)
		}
	}
	return nil
}

func buildSignatureSet(publisher string, digest string, privateKeys ...ed25519.PrivateKey) (packageSignatureSet, error) {
	set := packageSignatureSet{Schema: signatureSchema, Digest: digest, Publisher: publisher}
	message := []byte("milksu.plugin-package/v1\n" + strings.ToLower(digest))
	for _, privateKey := range privateKeys {
		if len(privateKey) != ed25519.PrivateKeySize {
			return packageSignatureSet{}, errors.New("Ed25519 private key is invalid")
		}
		publicKey := privateKey.Public().(ed25519.PublicKey)
		fingerprint := sha256.Sum256(publicKey)
		set.Signatures = append(set.Signatures, packageSignatureProof{
			KeyID: hex.EncodeToString(fingerprint[:]), PublicKey: base64.StdEncoding.EncodeToString(publicKey),
			Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, message)),
		})
	}
	return set, nil
}

func encodeSignatureSet(set packageSignatureSet) ([]byte, error) {
	payload, err := json.MarshalIndent(set, "", "  ")
	return append(payload, '\n'), err
}

func canonicalArchivePaths(directory string) ([]string, error) {
	paths := []string{}
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == directory || entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(directory, path)
		if err != nil {
			return err
		}
		paths = append(paths, filepath.ToSlash(relative))
		return nil
	})
	sort.Strings(paths)
	return paths, err
}

func deterministicZip(directory, outputPath string) error {
	paths, err := canonicalArchivePaths(directory)
	if err != nil {
		return err
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, relative := range paths {
		payload, err := os.ReadFile(filepath.Join(directory, filepath.FromSlash(relative)))
		if err != nil {
			writer.Close()
			return err
		}
		header := &zip.FileHeader{Name: relative, Method: zip.Deflate}
		header.SetMode(0o600)
		header.SetModTime(time.Unix(0, 0).UTC())
		entry, err := writer.CreateHeader(header)
		if err != nil {
			writer.Close()
			return err
		}
		if _, err := entry.Write(payload); err != nil {
			writer.Close()
			return err
		}
	}
	if err := writer.Close(); err != nil {
		return err
	}
	if buffer.Len() > maxPackageArchiveBytes {
		return errors.New("signed plugin archive is too large")
	}
	output, err := os.OpenFile(outputPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.Remove(outputPath)
		}
	}()
	if _, err := output.Write(buffer.Bytes()); err != nil {
		output.Close()
		return err
	}
	if err := output.Sync(); err != nil {
		output.Close()
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	complete = true
	return nil
}
