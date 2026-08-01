package evalbench

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type AdmissionClass string

const (
	AdmissionSafeStatic       AdmissionClass = "safe-static"
	AdmissionBlockedExecution AdmissionClass = "blocked-execution"
	AdmissionUnknown          AdmissionClass = "unknown"
)

const (
	maximumStaticPromptBytes = 16 << 10
	maximumAdmissionReason   = 2 << 10
)

type StaticMaterial struct {
	Prompt               string `json:"prompt"`
	PromptSHA256         string `json:"promptSha256"`
	ExpectedAnswerSHA256 string `json:"expectedAnswerSha256"`
}

type Admission struct {
	Split          Split           `json:"split"`
	TaskID         string          `json:"taskId"`
	Classification AdmissionClass  `json:"classification"`
	Reason         string          `json:"reason"`
	ReviewedBy     string          `json:"reviewedBy,omitempty"`
	ReviewedAt     time.Time       `json:"reviewedAt,omitempty"`
	StaticMaterial *StaticMaterial `json:"staticMaterial,omitempty"`
}

type AdmissionManifest struct {
	SchemaVersion       string      `json:"schemaVersion"`
	SourceRevision      string      `json:"sourceRevision"`
	ReviewPolicyVersion string      `json:"reviewPolicyVersion"`
	Tasks               []Admission `json:"tasks"`
}

type AdmissionDecision struct {
	SourceRevision      string          `json:"sourceRevision"`
	ReviewPolicyVersion string          `json:"reviewPolicyVersion,omitempty"`
	Split               Split           `json:"split"`
	TaskID              string          `json:"taskId"`
	Classification      AdmissionClass  `json:"classification"`
	Reason              string          `json:"reason"`
	ReviewedBy          string          `json:"reviewedBy,omitempty"`
	ReviewedAt          time.Time       `json:"reviewedAt,omitempty"`
	StaticMaterial      *StaticMaterial `json:"-"`
}

// LoadAdmissionManifest loads a human-reviewed allowlist. The NYU catalog
// alone never proves a task is safe-static; missing entries always classify as
// unknown and therefore cannot run.
func LoadAdmissionManifest(path string, catalogs []Catalog) (AdmissionManifest, error) {
	data, err := readBoundedFile(path, defaultMaximumAdmissionSize)
	if err != nil {
		return AdmissionManifest{}, fmt.Errorf("read admission manifest: %w", err)
	}
	var manifest AdmissionManifest
	if err := decodeStrictJSON(data, &manifest); err != nil {
		return AdmissionManifest{}, fmt.Errorf("decode admission manifest: %w", err)
	}
	if err := ValidateAdmissionManifest(manifest, catalogs); err != nil {
		return AdmissionManifest{}, err
	}
	return manifest, nil
}

func ValidateAdmissionManifest(manifest AdmissionManifest, catalogs []Catalog) error {
	if manifest.SchemaVersion != AdmissionSchemaVersion {
		return fmt.Errorf("unsupported admission schema %q", manifest.SchemaVersion)
	}
	if manifest.SourceRevision != NYUCTFBenchRevision {
		return fmt.Errorf("admission source revision must be pinned to %s", NYUCTFBenchRevision)
	}
	if manifest.ReviewPolicyVersion != SafeStaticReviewPolicyVersion {
		return fmt.Errorf("unsupported review policy %q", manifest.ReviewPolicyVersion)
	}
	taskIndex, err := catalogTaskIndex(catalogs)
	if err != nil {
		return err
	}
	seen := map[string]struct{}{}
	for index := range manifest.Tasks {
		admission := manifest.Tasks[index]
		key := taskKey(admission.Split, admission.TaskID)
		if _, ok := taskIndex[key]; !ok {
			return fmt.Errorf("admission references unknown benchmark task %s", key)
		}
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("duplicate admission for benchmark task %s", key)
		}
		seen[key] = struct{}{}
		if err := validateAdmission(admission); err != nil {
			return fmt.Errorf("admission %s: %w", key, err)
		}
	}
	return nil
}

func DecideAdmission(manifest AdmissionManifest, task Task) AdmissionDecision {
	for index := range manifest.Tasks {
		admission := manifest.Tasks[index]
		if admission.Split != task.Split || admission.TaskID != task.ID {
			continue
		}
		return AdmissionDecision{
			SourceRevision:      manifest.SourceRevision,
			ReviewPolicyVersion: manifest.ReviewPolicyVersion,
			Split:               task.Split,
			TaskID:              task.ID,
			Classification:      admission.Classification,
			Reason:              admission.Reason,
			ReviewedBy:          admission.ReviewedBy,
			ReviewedAt:          admission.ReviewedAt,
			StaticMaterial:      cloneStaticMaterial(admission.StaticMaterial),
		}
	}
	return AdmissionDecision{
		SourceRevision: NYUCTFBenchRevision,
		Split:          task.Split,
		TaskID:         task.ID,
		Classification: AdmissionUnknown,
		Reason:         "NYU CTF Bench metadata does not establish that this task is safe for non-executing static evaluation",
	}
}

func ClassifyCatalogWithoutReview(catalog Catalog) []AdmissionDecision {
	decisions := make([]AdmissionDecision, 0, len(catalog.Tasks))
	for _, task := range catalog.Tasks {
		decisions = append(decisions, AdmissionDecision{
			SourceRevision: NYUCTFBenchRevision,
			Split:          task.Split,
			TaskID:         task.ID,
			Classification: AdmissionUnknown,
			Reason:         "NYU CTF Bench metadata does not establish that this task is safe for non-executing static evaluation",
		})
	}
	sort.Slice(decisions, func(left, right int) bool {
		return taskKey(decisions[left].Split, decisions[left].TaskID) <
			taskKey(decisions[right].Split, decisions[right].TaskID)
	})
	return decisions
}

func validateAdmission(admission Admission) error {
	if err := validateSplit(admission.Split); err != nil {
		return err
	}
	if !taskIDPattern.MatchString(admission.TaskID) || len(admission.TaskID) > 200 {
		return errors.New("task id is invalid")
	}
	if strings.TrimSpace(admission.Reason) == "" ||
		len(admission.Reason) > maximumAdmissionReason ||
		strings.ContainsAny(admission.Reason, "\x00\r") {
		return errors.New("review reason is invalid")
	}
	switch admission.Classification {
	case AdmissionSafeStatic:
		if strings.TrimSpace(admission.ReviewedBy) == "" ||
			len(admission.ReviewedBy) > 200 ||
			strings.ContainsAny(admission.ReviewedBy, "\x00\r\n") {
			return errors.New("safe-static admission requires a valid reviewer")
		}
		if admission.ReviewedAt.IsZero() {
			return errors.New("safe-static admission requires a review timestamp")
		}
		if _, offset := admission.ReviewedAt.Zone(); offset != 0 {
			return errors.New("safe-static review timestamp must use UTC")
		}
		if admission.StaticMaterial == nil {
			return errors.New("safe-static admission requires static material")
		}
		if err := validateStaticMaterial(*admission.StaticMaterial); err != nil {
			return err
		}
	case AdmissionBlockedExecution, AdmissionUnknown:
		if admission.StaticMaterial != nil {
			return errors.New("blocked or unknown admission cannot include static material")
		}
	default:
		return fmt.Errorf("unsupported admission classification %q", admission.Classification)
	}
	return nil
}

func validateStaticMaterial(material StaticMaterial) error {
	if material.Prompt == "" ||
		len(material.Prompt) > maximumStaticPromptBytes ||
		!utf8.ValidString(material.Prompt) ||
		strings.ContainsRune(material.Prompt, '\x00') {
		return errors.New("static prompt is empty, too large, invalid UTF-8, or contains NUL")
	}
	if !sha256Pattern.MatchString(material.PromptSHA256) {
		return errors.New("static prompt digest must be a lowercase SHA-256")
	}
	if !sha256Pattern.MatchString(material.ExpectedAnswerSHA256) {
		return errors.New("expected answer digest must be a lowercase SHA-256")
	}
	if material.ExpectedAnswerSHA256 == ExpectedAnswerSHA256("") {
		return errors.New("expected answer cannot be empty")
	}
	if digestText(material.Prompt) != material.PromptSHA256 {
		return errors.New("static prompt digest does not match prompt")
	}
	return nil
}

func catalogTaskIndex(catalogs []Catalog) (map[string]Task, error) {
	if len(catalogs) == 0 {
		return nil, errors.New("at least one catalog is required")
	}
	result := map[string]Task{}
	for _, catalog := range catalogs {
		if err := validateCatalog(catalog, NYUCTFBenchSource()); err != nil {
			return nil, err
		}
		for _, task := range catalog.Tasks {
			key := taskKey(task.Split, task.ID)
			if _, duplicate := result[key]; duplicate {
				return nil, fmt.Errorf("duplicate benchmark task %s", key)
			}
			result[key] = task
		}
	}
	return result, nil
}

func FindTask(catalog Catalog, taskID string) (Task, error) {
	for _, task := range catalog.Tasks {
		if task.ID == taskID {
			return task, nil
		}
	}
	return Task{}, fmt.Errorf("benchmark task %s/%s was not found", catalog.Split, taskID)
}

func cloneStaticMaterial(value *StaticMaterial) *StaticMaterial {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func digestText(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

// ExpectedAnswerSHA256 returns the digest used by the deterministic static
// judge. It is exported for manifest generation; the plaintext answer is never
// stored in a Run record.
func ExpectedAnswerSHA256(answer string) string {
	return digestText(normalizeStaticAnswer(answer))
}

func normalizeStaticAnswer(answer string) string {
	return strings.TrimSpace(strings.ReplaceAll(answer, "\r\n", "\n"))
}
