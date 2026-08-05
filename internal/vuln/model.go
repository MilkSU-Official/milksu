package vuln

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const (
	PackageID     = "vuln.research"
	SchemaVersion = "vuln.milksu.dev/v1alpha1"

	FactTargetAdmitted            = "target.admitted"
	FactAttackSurfaceRecorded     = "attack_surface.recorded"
	FactHypothesisRecorded        = "hypothesis.recorded"
	FactReproductionRecorded      = "reproduction.recorded"
	FactRootCauseRecorded         = "root_cause.recorded"
	FactLearningRecorded          = "learning.recorded"
	FactAssetVerificationRecorded = "asset_verification.recorded"
)

var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Target struct {
	ID                string                    `json:"id"`
	Name              string                    `json:"name"`
	Version           string                    `json:"version"`
	Component         string                    `json:"component"`
	Fixture           string                    `json:"fixture"`
	CollaborationMode string                    `json:"collaborationMode"`
	Scope             securitypolicy.ScopeGrant `json:"scope"`
	SourceArtifactID  string                    `json:"sourceArtifactId"`
	ReadmeArtifactID  string                    `json:"readmeArtifactId"`
	AdmittedAt        time.Time                 `json:"admittedAt"`
}

type AttackSurface struct {
	ID          string    `json:"id"`
	EntryPoint  string    `json:"entryPoint"`
	Input       string    `json:"input"`
	DataFlow    string    `json:"dataFlow"`
	Sink        string    `json:"sink"`
	SourceLine  int       `json:"sourceLine"`
	Summary     string    `json:"summary"`
	RecordedAt  time.Time `json:"recordedAt"`
	EvidenceIDs []string  `json:"evidenceIds"`
}

type Hypothesis struct {
	ID             string    `json:"id"`
	Statement      string    `json:"statement"`
	Status         string    `json:"status"`
	Rationale      string    `json:"rationale"`
	NextExperiment string    `json:"nextExperiment"`
	RecordedAt     time.Time `json:"recordedAt"`
	EvidenceIDs    []string  `json:"evidenceIds"`
}

type RootCause struct {
	ID              string    `json:"id"`
	Summary         string    `json:"summary"`
	TechnicalDetail string    `json:"technicalDetail"`
	Impact          string    `json:"impact"`
	Exploitability  string    `json:"exploitability"`
	SourceLine      int       `json:"sourceLine"`
	Status          string    `json:"status"`
	RecordedAt      time.Time `json:"recordedAt"`
	EvidenceIDs     []string  `json:"evidenceIds"`
}

type EnvironmentFingerprint struct {
	Compiler     string `json:"compiler"`
	Sanitizer    string `json:"sanitizer"`
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
}

type ReproductionRun struct {
	Number       int       `json:"number"`
	ExitCode     int       `json:"exitCode"`
	SanitizerLog string    `json:"sanitizerLog"`
	ObservedAt   time.Time `json:"observedAt"`
}

type ReproductionRequest struct {
	TriggerSHA256    string                 `json:"triggerSha256"`
	TriggerSize      int                    `json:"triggerSize"`
	Environment      EnvironmentFingerprint `json:"environment"`
	Runs             []ReproductionRun      `json:"runs"`
	CleanRunAttested bool                   `json:"cleanRunAttested"`
	Attestation      string                 `json:"attestation"`
}

type Reproduction struct {
	ID               string                 `json:"id"`
	TriggerSHA256    string                 `json:"triggerSha256"`
	TriggerSize      int                    `json:"triggerSize"`
	Environment      EnvironmentFingerprint `json:"environment"`
	Runs             []ReproductionRun      `json:"runs"`
	StableRuns       int                    `json:"stableRuns"`
	TotalRuns        int                    `json:"totalRuns"`
	Fingerprint      string                 `json:"fingerprint"`
	Summary          string                 `json:"summary"`
	CleanRunAttested bool                   `json:"cleanRunAttested"`
	Attestation      string                 `json:"attestation"`
	RecordedAt       time.Time              `json:"recordedAt"`
	EvidenceIDs      []string               `json:"evidenceIds"`
	ArtifactIDs      []string               `json:"artifactIds"`
}

type LearningRecordRequest struct {
	Kind    string `json:"kind"`
	Content string `json:"content"`
	Concept string `json:"concept"`
}

type AssetVerificationRequest struct {
	Name        string `json:"name"`
	Address     string `json:"address"`
	Environment string `json:"environment"`
	Status      string `json:"status"`
	Summary     string `json:"summary"`
}

type TrackingWorkspaceRequest struct {
	CVEID         string `json:"cveId"`
	Title         string `json:"title"`
	Summary       string `json:"summary"`
	ReferenceHref string `json:"referenceHref"`
}

type LearningRecord struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Content   string    `json:"content"`
	Concept   string    `json:"concept,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type AssetVerification struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Address     string    `json:"address"`
	Environment string    `json:"environment"`
	Status      string    `json:"status"`
	Summary     string    `json:"summary,omitempty"`
	RecordedAt  time.Time `json:"recordedAt"`
}

type HumanOutcomeView struct {
	Goal             string `json:"goal"`
	ReflectionCount  int    `json:"reflectionCount"`
	IndependentSteps int    `json:"independentSteps"`
	VariantCount     int    `json:"variantCount"`
	Summary          string `json:"summary"`
}

type ExperimentView struct {
	ID           string                        `json:"id"`
	Number       int                           `json:"number"`
	Name         string                        `json:"name"`
	Description  string                        `json:"description"`
	Status       securityruntime.StepStatus    `json:"status"`
	Action       *securityruntime.Action       `json:"action,omitempty"`
	Observations []securityruntime.Observation `json:"observations"`
	ArtifactIDs  []string                      `json:"artifactIds"`
}

type Projection struct {
	ContractVersion    string                       `json:"contractVersion"`
	Job                securityruntime.Job          `json:"job"`
	Target             Target                       `json:"target"`
	AttackSurface      *AttackSurface               `json:"attackSurface,omitempty"`
	Hypotheses         []Hypothesis                 `json:"hypotheses"`
	Experiments        []ExperimentView             `json:"experiments"`
	Reproduction       *Reproduction                `json:"reproduction,omitempty"`
	RootCause          *RootCause                   `json:"rootCause,omitempty"`
	Artifacts          []securityruntime.Artifact   `json:"artifacts"`
	Evidence           []securityruntime.Evidence   `json:"evidence"`
	Evaluations        []securityruntime.Evaluation `json:"evaluations"`
	Learning           []LearningRecord             `json:"learning"`
	AssetVerifications []AssetVerification          `json:"assetVerifications"`
	HumanOutcome       HumanOutcomeView             `json:"humanOutcome"`
	Outcome            *securityruntime.Outcome     `json:"outcome,omitempty"`
	Events             []securityruntime.Event      `json:"events"`
}

type Summary struct {
	ID                string                    `json:"id"`
	Title             string                    `json:"title"`
	Version           string                    `json:"version"`
	Status            securityruntime.JobStatus `json:"status"`
	HypothesisCount   int                       `json:"hypothesisCount"`
	ReproductionState string                    `json:"reproductionState"`
	Verdict           securityruntime.Verdict   `json:"verdict,omitempty"`
	UpdatedAt         time.Time                 `json:"updatedAt"`
}

func validateReproductionRequest(request ReproductionRequest) error {
	request.TriggerSHA256 = strings.ToLower(strings.TrimSpace(request.TriggerSHA256))
	if !sha256Pattern.MatchString(request.TriggerSHA256) {
		return fmt.Errorf("trigger SHA-256 must be 64 lowercase hexadecimal characters")
	}
	if request.TriggerSize <= 0 || request.TriggerSize > 4096 {
		return fmt.Errorf("trigger size must be between 1 and 4096 bytes")
	}
	if len(request.Runs) != 3 {
		return fmt.Errorf("exactly three reproduction runs are required")
	}
	if strings.TrimSpace(request.Environment.Compiler) == "" ||
		strings.TrimSpace(request.Environment.Sanitizer) == "" ||
		strings.TrimSpace(request.Environment.OS) == "" ||
		strings.TrimSpace(request.Environment.Architecture) == "" {
		return fmt.Errorf("compiler, sanitizer, OS, and architecture are required")
	}
	if len([]rune(request.Environment.Compiler)) > 160 ||
		len([]rune(request.Environment.Sanitizer)) > 80 ||
		len([]rune(request.Environment.OS)) > 160 ||
		len([]rune(request.Environment.Architecture)) > 80 {
		return fmt.Errorf("environment fingerprint is too long")
	}
	for index, run := range request.Runs {
		if run.Number != index+1 {
			return fmt.Errorf("reproduction runs must be numbered 1 through 3")
		}
		if run.ExitCode == 0 {
			return fmt.Errorf("reproduction run %d must record a non-zero sanitizer exit", run.Number)
		}
		if strings.TrimSpace(run.SanitizerLog) == "" || len(run.SanitizerLog) > 64*1024 {
			return fmt.Errorf("reproduction run %d sanitizer log is empty or too large", run.Number)
		}
	}
	request.Attestation = strings.TrimSpace(request.Attestation)
	if !request.CleanRunAttested || len([]rune(request.Attestation)) < 12 || len([]rune(request.Attestation)) > 1000 {
		return fmt.Errorf("a concise clean-process attestation is required")
	}
	return nil
}

func normalizeAssetVerificationRequest(request AssetVerificationRequest) (AssetVerificationRequest, error) {
	normalized := AssetVerificationRequest{
		Name:        strings.TrimSpace(request.Name),
		Address:     strings.TrimSpace(request.Address),
		Environment: strings.TrimSpace(request.Environment),
		Status:      strings.ToLower(strings.TrimSpace(request.Status)),
		Summary:     strings.TrimSpace(request.Summary),
	}
	if normalized.Name == "" && normalized.Address == "" {
		return AssetVerificationRequest{}, fmt.Errorf("asset name or address is required")
	}
	if normalized.Name == "" {
		normalized.Name = normalized.Address
	}
	if normalized.Address == "" {
		normalized.Address = "unspecified"
	}
	if normalized.Environment == "" {
		normalized.Environment = "unspecified"
	}
	if normalized.Status == "" {
		normalized.Status = "needs_review"
	}
	switch normalized.Status {
	case "needs_review", "affected", "not_affected", "mitigated":
	default:
		return AssetVerificationRequest{}, fmt.Errorf("unsupported asset verification status")
	}
	if len([]rune(normalized.Name)) > 240 ||
		len([]rune(normalized.Address)) > 320 ||
		len([]rune(normalized.Environment)) > 160 ||
		len([]rune(normalized.Summary)) > 1200 {
		return AssetVerificationRequest{}, fmt.Errorf("asset verification record exceeds local archive limits")
	}
	return normalized, nil
}

func marshalRoleFact(kind string, value any, artifactIDs, evidenceIDs []string) (securityruntime.RoleFact, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return securityruntime.RoleFact{}, err
	}
	return securityruntime.RoleFact{
		ID:            securityruntime.NewIdentifier("fact"),
		PackageID:     PackageID,
		SchemaVersion: SchemaVersion,
		Kind:          kind,
		ArtifactIDs:   append([]string{}, artifactIDs...),
		EvidenceIDs:   append([]string{}, evidenceIDs...),
		Data:          data,
	}, nil
}
