package ctf

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const (
	PackageID     = "ctf.challenge"
	SchemaVersion = "ctf.milksu.dev/v1alpha1"

	FactChallengeAdmitted = "challenge.admitted"
	FactLearningRecorded  = "learning.recorded"
	FactAgentCandidate    = "agent.candidate"
	FactJudgeReceipt      = "judge.receipt"
	FactEndpointRequested = "endpoint.requested"
	FactEndpointDecided   = "endpoint.decided"
	maxMaterialBytes      = 256 * 1024 * 1024
	maxTotalMaterialBytes = 512 * 1024 * 1024
	maxExperiments        = 12
	proposalTimeout       = 2 * time.Minute
)

type ChallengeRequest struct {
	Title             string                  `json:"title"`
	Statement         string                  `json:"statement"`
	Category          string                  `json:"category"`
	CollaborationMode string                  `json:"collaborationMode"`
	DeferAgent        bool                    `json:"deferAgent,omitempty"`
	TrackName         string                  `json:"trackName"`
	HumanGoal         string                  `json:"humanGoal"`
	SourceKind        string                  `json:"sourceKind"`
	SourceURI         string                  `json:"sourceUri"`
	SourceTargets     []securitypolicy.Target `json:"sourceTargets,omitempty"`
	ExternalPlatform  string                  `json:"externalPlatform,omitempty"`
	ExternalAttemptID int64                   `json:"externalAttemptId,omitempty"`
	ExpectedFlag      string                  `json:"expectedFlag"`
	KnowledgePoints   []string                `json:"knowledgePoints"`
	Materials         []MaterialRequest       `json:"materials"`
}

type MaterialRequest struct {
	Name        string `json:"name"`
	MediaType   string `json:"mediaType"`
	DataBase64  string `json:"dataBase64,omitempty"`
	Provenance  string `json:"provenance"`
	ImportToken string `json:"importToken,omitempty"`
	Size        int64  `json:"size,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	Data        []byte `json:"-"`
}

type admittedRequest struct {
	title             string
	statement         string
	category          string
	collaborationMode string
	deferAgent        bool
	trackName         string
	humanGoal         string
	source            ChallengeSource
	externalPlatform  string
	externalAttemptID int64
	expectedFlag      string
	knowledgePoints   []string
	materials         []admittedMaterial
}

type admittedMaterial struct {
	name       string
	mediaType  string
	data       []byte
	provenance string
}

type Challenge struct {
	ID                string          `json:"id"`
	Title             string          `json:"title"`
	Statement         string          `json:"statement"`
	Category          string          `json:"category"`
	CollaborationMode string          `json:"collaborationMode"`
	ExternalPlatform  string          `json:"externalPlatform,omitempty"`
	ExternalAttemptID int64           `json:"externalAttemptId,omitempty"`
	TrackName         string          `json:"trackName"`
	HumanGoal         string          `json:"humanGoal"`
	Source            ChallengeSource `json:"source"`
	Materials         []Material      `json:"materials"`
	KnowledgePoints   []string        `json:"knowledgePoints"`
	Judge             JudgeSpec       `json:"judge"`
	AdmittedAt        time.Time       `json:"admittedAt"`
}

type ChallengeSource struct {
	Kind  string                    `json:"kind"`
	URI   string                    `json:"uri,omitempty"`
	Scope securitypolicy.ScopeGrant `json:"scope"`
}

type EndpointProtocol string

const (
	EndpointProtocolHTTP  EndpointProtocol = "http"
	EndpointProtocolHTTPS EndpointProtocol = "https"
	EndpointProtocolTCP   EndpointProtocol = "tcp"
	EndpointProtocolSSH   EndpointProtocol = "ssh"
)

type EndpointRequester string

const (
	EndpointRequesterUser  EndpointRequester = "user"
	EndpointRequesterAgent EndpointRequester = "agent"
	EndpointRequesterPage  EndpointRequester = "page"
)

type EndpointRequestStatus string

const (
	EndpointRequestPending  EndpointRequestStatus = "pending"
	EndpointRequestApproved EndpointRequestStatus = "approved"
	EndpointRequestDenied   EndpointRequestStatus = "denied"
)

type EndpointRequestInput struct {
	Protocol EndpointProtocol `json:"protocol"`
	Endpoint string           `json:"endpoint"`
	Source   string           `json:"source"`
	Purpose  string           `json:"purpose"`
}

type EndpointRequest struct {
	ID          string                     `json:"id"`
	Protocol    EndpointProtocol           `json:"protocol"`
	Host        string                     `json:"host"`
	Port        int                        `json:"port"`
	Target      securitypolicy.Target      `json:"target"`
	Source      string                     `json:"source"`
	Purpose     string                     `json:"purpose"`
	RequestedBy EndpointRequester          `json:"requestedBy"`
	Status      EndpointRequestStatus      `json:"status"`
	RequestedAt time.Time                  `json:"requestedAt"`
	DecidedAt   *time.Time                 `json:"decidedAt,omitempty"`
	Scope       *securitypolicy.ScopeGrant `json:"scope,omitempty"`
}

type Material struct {
	ArtifactID string `json:"artifactId"`
	Name       string `json:"name"`
	MediaType  string `json:"mediaType"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
	Provenance string `json:"provenance"`
}

type JudgeSpec struct {
	Type               string `json:"type"`
	Version            string `json:"version"`
	ExpectedFlagSHA256 string `json:"expectedFlagSha256"`
}

type ChallengeView struct {
	ID                string               `json:"id"`
	Title             string               `json:"title"`
	Statement         string               `json:"statement"`
	Category          string               `json:"category"`
	CollaborationMode string               `json:"collaborationMode"`
	ExternalPlatform  string               `json:"externalPlatform,omitempty"`
	ExternalAttemptID int64                `json:"externalAttemptId,omitempty"`
	TrackName         string               `json:"trackName"`
	HumanGoal         string               `json:"humanGoal"`
	Source            ChallengeSource      `json:"source"`
	Materials         []Material           `json:"materials"`
	KnowledgePoints   []string             `json:"knowledgePoints"`
	AgentPolicy       AgentWorkspacePolicy `json:"agentPolicy"`
	JudgeType         string               `json:"judgeType"`
	JudgeVersion      string               `json:"judgeVersion"`
	AdmittedAt        time.Time            `json:"admittedAt"`
}

type LearningRecord struct {
	ID         string             `json:"id"`
	Kind       string             `json:"kind"`
	Actor      LearningActor      `json:"actor"`
	Assistance LearningAssistance `json:"assistance"`
	Content    string             `json:"content"`
	Concept    string             `json:"concept,omitempty"`
	Level      int                `json:"level,omitempty"`
	CreatedAt  time.Time          `json:"createdAt"`
}

type LearningRecordRequest struct {
	Kind    string `json:"kind"`
	Content string `json:"content"`
	Concept string `json:"concept"`
	Level   int    `json:"level"`
}

type LearningActor string

const (
	LearningActorUser     LearningActor = "user"
	LearningActorAgent    LearningActor = "agent"
	LearningActorShared   LearningActor = "shared"
	LearningActorImported LearningActor = "imported"
)

type LearningAssistance string

const (
	LearningAssistanceNone      LearningAssistance = "none"
	LearningAssistanceHint      LearningAssistance = "hint"
	LearningAssistanceCopilot   LearningAssistance = "copilot"
	LearningAssistanceDelegated LearningAssistance = "delegated"
)

// TrainingContributionView is evidence attribution, not a correctness
// verdict. Judge receipts and Outcome remain the independent source for
// whether an answer was accepted.
type TrainingContributionView struct {
	PrimaryActor         LearningActor      `json:"primaryActor"`
	Assistance           LearningAssistance `json:"assistance"`
	UserRecords          int                `json:"userRecords"`
	AgentRecords         int                `json:"agentRecords"`
	SharedRecords        int                `json:"sharedRecords"`
	ImportedRecords      int                `json:"importedRecords"`
	UserIndependentSteps int                `json:"userIndependentSteps"`
	UserAssistedSteps    int                `json:"userAssistedSteps"`
}

type ExternalJudgeReceiptRequest struct {
	Platform  string `json:"platform"`
	Status    string `json:"status"`
	Correct   *bool  `json:"correct,omitempty"`
	Summary   string `json:"summary"`
	Reference string `json:"reference"`
}

type ExternalJudgeReceipt struct {
	ID         string    `json:"id"`
	Platform   string    `json:"platform"`
	Status     string    `json:"status"`
	Correct    *bool     `json:"correct,omitempty"`
	Summary    string    `json:"summary"`
	Reference  string    `json:"reference"`
	RecordedAt time.Time `json:"recordedAt"`
}

type HumanOutcomeView struct {
	Goal             string                   `json:"goal"`
	KnowledgePoints  []string                 `json:"knowledgePoints"`
	HintCount        int                      `json:"hintCount"`
	ReflectionCount  int                      `json:"reflectionCount"`
	IndependentSteps int                      `json:"independentSteps"`
	Contribution     TrainingContributionView `json:"contribution"`
	Summary          string                   `json:"summary"`
}

type ExperimentView struct {
	ID           string                        `json:"id"`
	AttemptID    string                        `json:"attemptId"`
	Number       int                           `json:"number"`
	Status       securityruntime.StepStatus    `json:"status"`
	StartedAt    time.Time                     `json:"startedAt"`
	FinishedAt   *time.Time                    `json:"finishedAt,omitempty"`
	Action       *securityruntime.Action       `json:"action,omitempty"`
	Observations []securityruntime.Observation `json:"observations"`
	ArtifactIDs  []string                      `json:"artifactIds"`
}

type SubmissionView struct {
	Candidate                string                  `json:"candidate"`
	ExternalWrongCountBefore *int                    `json:"externalWrongCountBefore,omitempty"`
	Verdict                  securityruntime.Verdict `json:"verdict"`
	Summary                  string                  `json:"summary"`
}

type AgentCandidate struct {
	ID          string              `json:"id"`
	SessionID   string              `json:"sessionId"`
	Candidate   string              `json:"candidate"`
	Explanation string              `json:"explanation"`
	ArtifactID  string              `json:"artifactId"`
	Assessment  CandidateAssessment `json:"assessment"`
	CreatedAt   time.Time           `json:"createdAt"`
}

type CandidateAssessment struct {
	Status   string   `json:"status"`
	Warnings []string `json:"warnings"`
}

type AgentRunView struct {
	AttemptID            string          `json:"attemptId"`
	SessionID            string          `json:"sessionId"`
	Model                string          `json:"model"`
	Summary              string          `json:"summary"`
	Metrics              AgentRunMetrics `json:"metrics"`
	TrajectoryArtifactID string          `json:"trajectoryArtifactId,omitempty"`
	StartedAt            time.Time       `json:"startedAt"`
	FinishedAt           *time.Time      `json:"finishedAt,omitempty"`
}

type DebriefCandidate struct {
	Candidate string                  `json:"candidate"`
	Verdict   securityruntime.Verdict `json:"verdict"`
	Summary   string                  `json:"summary"`
}

type DebriefView struct {
	Status                string             `json:"status"`
	Summary               string             `json:"summary"`
	KeyObservations       []string           `json:"keyObservations"`
	FailureBranches       []string           `json:"failureBranches"`
	Candidates            []DebriefCandidate `json:"candidates"`
	KnowledgePoints       []string           `json:"knowledgePoints"`
	HintCount             int                `json:"hintCount"`
	ReflectionCount       int                `json:"reflectionCount"`
	IndependentSteps      int                `json:"independentSteps"`
	EvidenceCount         int                `json:"evidenceCount"`
	ArtifactCount         int                `json:"artifactCount"`
	NeedsReflection       bool               `json:"needsReflection"`
	RecommendedNextAction string             `json:"recommendedNextAction"`
}

type ArtifactPreview struct {
	Artifact    securityruntime.Artifact `json:"artifact"`
	Previewable bool                     `json:"previewable"`
	Truncated   bool                     `json:"truncated"`
	Content     string                   `json:"content,omitempty"`
	Reason      string                   `json:"reason,omitempty"`
}

type Projection struct {
	ContractVersion  string                       `json:"contractVersion"`
	Job              securityruntime.Job          `json:"job"`
	Challenge        ChallengeView                `json:"challenge"`
	Attempts         []securityruntime.Attempt    `json:"attempts"`
	Experiments      []ExperimentView             `json:"experiments"`
	Artifacts        []securityruntime.Artifact   `json:"artifacts"`
	Evidence         []securityruntime.Evidence   `json:"evidence"`
	Evaluations      []securityruntime.Evaluation `json:"evaluations"`
	AgentRuns        []AgentRunView               `json:"agentRuns"`
	AgentCandidates  []AgentCandidate             `json:"agentCandidates"`
	Submissions      []SubmissionView             `json:"submissions"`
	JudgeReceipts    []ExternalJudgeReceipt       `json:"judgeReceipts"`
	EndpointRequests []EndpointRequest            `json:"endpointRequests"`
	NetworkScopes    []securitypolicy.ScopeGrant  `json:"networkScopes"`
	Learning         []LearningRecord             `json:"learning"`
	HumanOutcome     HumanOutcomeView             `json:"humanOutcome"`
	Debrief          DebriefView                  `json:"debrief"`
	Outcome          *securityruntime.Outcome     `json:"outcome,omitempty"`
	Events           []securityruntime.Event      `json:"events"`
}

type Summary struct {
	ID                string                    `json:"id"`
	Title             string                    `json:"title"`
	Category          string                    `json:"category"`
	ExternalPlatform  string                    `json:"externalPlatform,omitempty"`
	ExternalAttemptID int64                     `json:"externalAttemptId,omitempty"`
	Status            securityruntime.JobStatus `json:"status"`
	ExperimentCount   int                       `json:"experimentCount"`
	Verdict           securityruntime.Verdict   `json:"verdict,omitempty"`
	PendingSubmission bool                      `json:"pendingSubmission"`
	PendingJudge      bool                      `json:"pendingJudge"`
	UpdatedAt         time.Time                 `json:"updatedAt"`
}

func validateRequest(request ChallengeRequest) (admittedRequest, error) {
	title := strings.TrimSpace(request.Title)
	statement := strings.TrimSpace(request.Statement)
	category := strings.TrimSpace(request.Category)
	mode := strings.ToLower(strings.TrimSpace(request.CollaborationMode))
	expectedFlag := strings.TrimSpace(request.ExpectedFlag)
	trackName := strings.TrimSpace(request.TrackName)
	humanGoal := strings.TrimSpace(request.HumanGoal)
	externalPlatform := strings.ToLower(strings.TrimSpace(request.ExternalPlatform))
	if title == "" || len([]rune(title)) > 120 {
		return admittedRequest{}, fmt.Errorf("challenge title is required and must be at most 120 characters")
	}
	if statement == "" || len([]rune(statement)) > 12_000 {
		return admittedRequest{}, fmt.Errorf("challenge statement is required and must be at most 12000 characters")
	}
	if category == "" {
		category = "misc"
	}
	if mode == "" {
		mode = "delegate"
	}
	if mode != "coach" && mode != "copilot" && mode != "delegate" {
		return admittedRequest{}, fmt.Errorf("collaboration mode must be coach, copilot, or delegate")
	}
	if len([]rune(expectedFlag)) > 512 {
		return admittedRequest{}, fmt.Errorf("expected flag must be at most 512 characters")
	}
	if len(request.Materials) > 32 {
		return admittedRequest{}, fmt.Errorf("at most 32 challenge materials are supported")
	}
	if len([]rune(trackName)) > 120 || len([]rune(humanGoal)) > 1000 {
		return admittedRequest{}, fmt.Errorf("track name or human learning goal is too long")
	}
	if externalPlatform != "" &&
		externalPlatform != "nssctf-agent-arena" &&
		externalPlatform != "nssctf-web" &&
		externalPlatform != "ctfshow-web" {
		return admittedRequest{}, fmt.Errorf("unsupported external CTF platform %q", externalPlatform)
	}
	if (externalPlatform == "") != (request.ExternalAttemptID == 0) || request.ExternalAttemptID < 0 {
		return admittedRequest{}, fmt.Errorf("external platform and attempt id must be supplied together")
	}
	source, err := validateSource(request.SourceKind, request.SourceURI, request.SourceTargets)
	if err != nil {
		return admittedRequest{}, err
	}

	result := admittedRequest{
		title: title, statement: statement, category: category, collaborationMode: mode,
		deferAgent: request.DeferAgent, trackName: trackName, humanGoal: humanGoal, source: source,
		externalPlatform: externalPlatform, externalAttemptID: request.ExternalAttemptID, expectedFlag: expectedFlag,
	}
	seenKnowledge := make(map[string]struct{})
	for _, point := range request.KnowledgePoints {
		point = strings.TrimSpace(point)
		if point == "" || len([]rune(point)) > 120 {
			continue
		}
		if _, exists := seenKnowledge[point]; exists {
			continue
		}
		seenKnowledge[point] = struct{}{}
		result.knowledgePoints = append(result.knowledgePoints, point)
	}

	total := int64(0)
	for index, material := range request.Materials {
		name := strings.TrimSpace(material.Name)
		if name == "" || len([]rune(name)) > 160 || filepath.Base(name) != name || strings.ContainsAny(name, `/\\`) {
			return admittedRequest{}, fmt.Errorf("material %d has an invalid name", index+1)
		}
		mediaType := strings.TrimSpace(material.MediaType)
		if mediaType == "" || len(mediaType) > 128 {
			return admittedRequest{}, fmt.Errorf("material %q has an invalid media type", name)
		}
		inlineData := strings.TrimSpace(material.DataBase64)
		var data []byte
		switch {
		case len(material.Data) > 0 && inlineData != "":
			return admittedRequest{}, fmt.Errorf("material %q must not mix inline and local data", name)
		case len(material.Data) > 0:
			data = append([]byte(nil), material.Data...)
		case inlineData != "":
			decoded, err := base64.StdEncoding.DecodeString(inlineData)
			if err != nil {
				return admittedRequest{}, fmt.Errorf("decode material %q: %w", name, err)
			}
			data = decoded
		case strings.TrimSpace(material.ImportToken) != "":
			return admittedRequest{}, fmt.Errorf("material %q has an unresolved local import token", name)
		default:
			return admittedRequest{}, fmt.Errorf("material %q has no content", name)
		}
		if len(data) == 0 || len(data) > maxMaterialBytes {
			return admittedRequest{}, fmt.Errorf("material %q must be between 1 byte and 256 MiB", name)
		}
		if material.Size != 0 && material.Size != int64(len(data)) {
			return admittedRequest{}, fmt.Errorf("material %q size metadata does not match content", name)
		}
		if material.SHA256 != "" {
			digest := sha256.Sum256(data)
			if !strings.EqualFold(material.SHA256, hex.EncodeToString(digest[:])) {
				return admittedRequest{}, fmt.Errorf("material %q sha256 metadata does not match content", name)
			}
		}
		total += int64(len(data))
		if total > maxTotalMaterialBytes {
			return admittedRequest{}, fmt.Errorf("challenge materials exceed the 512 MiB limit")
		}
		provenance := strings.TrimSpace(material.Provenance)
		if provenance == "" {
			provenance = "user:desktop-intake"
		}
		if len(provenance) > 240 || !utf8.ValidString(provenance) {
			return admittedRequest{}, fmt.Errorf("material %q has invalid provenance", name)
		}
		result.materials = append(result.materials, admittedMaterial{
			name: name, mediaType: mediaType, data: data, provenance: provenance,
		})
	}
	return result, nil
}

func validateCandidateText(candidate string) error {
	if candidate == "" || len([]rune(candidate)) > 512 || !utf8.ValidString(candidate) {
		return fmt.Errorf("flag candidate is empty, invalid UTF-8, or too long")
	}
	for _, character := range candidate {
		if unicode.IsControl(character) {
			return fmt.Errorf("flag candidate contains control characters")
		}
	}
	return nil
}

func assessCandidate(candidate, externalPlatform string) CandidateAssessment {
	warnings := make([]string, 0, 3)
	if strings.ContainsFunc(candidate, unicode.IsSpace) {
		warnings = append(warnings, "候选中包含空白字符，请对照题目 Flag 格式复核。")
	}
	if !strings.Contains(candidate, "{") || !strings.HasSuffix(candidate, "}") {
		warnings = append(warnings, "候选不像常见的 PREFIX{...} 格式；仍可由用户确认后提交。")
	}
	if strings.HasPrefix(externalPlatform, "nssctf") &&
		!strings.HasPrefix(strings.ToUpper(candidate), "NSSCTF{") {
		warnings = append(warnings, "候选不是常见 NSSCTF{...} 前缀，请确认题目是否使用自定义格式。")
	}
	status := "plausible"
	if len(warnings) > 0 {
		status = "unusual"
	}
	return CandidateAssessment{Status: status, Warnings: warnings}
}

func validateSource(
	kind, rawURI string,
	additionalTargets []securitypolicy.Target,
) (ChallengeSource, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	rawURI = strings.TrimSpace(rawURI)
	if kind == "" {
		kind = "text"
	}
	var target securitypolicy.Target
	switch kind {
	case "text", "file", "image":
		target = securitypolicy.Target{Kind: securitypolicy.TargetLab, Value: "offline-intake"}
	case "directory":
		target = securitypolicy.Target{Kind: securitypolicy.TargetDirectory, Value: rawURI}
	case "url", "managed-browser", "user-browser":
		parsed, err := url.Parse(rawURI)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
			return ChallengeSource{}, fmt.Errorf("browser/URL intake requires an http(s) URL without credentials")
		}
		target = securitypolicy.Target{Kind: securitypolicy.TargetOrigin, Value: parsed.String()}
	case "socket", "ssh":
		value := rawURI
		targetKind := securitypolicy.TargetSocket
		if kind == "ssh" {
			parsed, err := url.Parse(rawURI)
			if err != nil || parsed.Scheme != "ssh" || parsed.Host == "" || parsed.User == nil || parsed.User.String() == "" || strings.Contains(parsed.User.String(), ":") {
				return ChallengeSource{}, fmt.Errorf("SSH intake requires ssh://user@host:port without a password")
			}
			value = parsed.Host
			targetKind = securitypolicy.TargetSSH
		}
		target = securitypolicy.Target{Kind: targetKind, Value: value}
	default:
		return ChallengeSource{}, fmt.Errorf("unsupported challenge source %q", kind)
	}
	normalized, err := securitypolicy.NormalizeTarget(target)
	if err != nil {
		return ChallengeSource{}, err
	}
	targets := []securitypolicy.Target{normalized}
	seen := map[string]struct{}{
		string(normalized.Kind) + "\x00" + normalized.Value: {},
	}
	for _, candidate := range additionalTargets {
		normalizedCandidate, err := securitypolicy.NormalizeTarget(candidate)
		if err != nil {
			return ChallengeSource{}, fmt.Errorf("additional source target: %w", err)
		}
		key := string(normalizedCandidate.Kind) + "\x00" + normalizedCandidate.Value
		if _, exists := seen[key]; exists {
			continue
		}
		if len(targets) >= 16 {
			return ChallengeSource{}, fmt.Errorf("challenge source may contain at most 16 exact targets")
		}
		seen[key] = struct{}{}
		targets = append(targets, normalizedCandidate)
	}
	grant, err := securitypolicy.NewGrant(
		"challenge-intake:"+kind,
		"ctf learning",
		targets,
		24*time.Hour,
	)
	if err != nil {
		return ChallengeSource{}, err
	}
	return ChallengeSource{Kind: kind, URI: rawURI, Scope: grant}, nil
}

func decodeChallengeFact(fact securityruntime.RoleFact) (Challenge, error) {
	if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion || fact.Kind != FactChallengeAdmitted {
		return Challenge{}, fmt.Errorf("unsupported CTF role fact")
	}
	var challenge Challenge
	if err := json.Unmarshal(fact.Data, &challenge); err != nil {
		return Challenge{}, fmt.Errorf("decode challenge fact: %w", err)
	}
	if challenge.Source.Scope.ID == "" {
		created := challenge.AdmittedAt
		if created.IsZero() {
			created = time.Unix(0, 0).UTC()
		}
		challenge.Source = ChallengeSource{Kind: "text", Scope: securitypolicy.ScopeGrant{
			ID: "scope_legacy_" + challenge.ID, Source: "legacy-offline-intake", Purpose: "ctf learning",
			Targets:   []securitypolicy.Target{{Kind: securitypolicy.TargetLab, Value: "offline-intake"}},
			GrantedBy: "local-user", CreatedAt: created, ExpiresAt: created.Add(30 * 24 * time.Hour), Revocable: true,
		}}
	}
	validJudge := challenge.Judge.Type == "external.manual" || (challenge.Judge.Type == "flag.sha256" && len(challenge.Judge.ExpectedFlagSHA256) == 64)
	if challenge.ID == "" || !validJudge || challenge.Judge.Version == "" || challenge.Source.Scope.ID == "" {
		return Challenge{}, fmt.Errorf("invalid admitted challenge")
	}
	return challenge, nil
}
