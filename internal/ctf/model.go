package ctf

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const (
	PackageID     = "ctf.challenge"
	SchemaVersion = "ctf.milksu.dev/v1alpha1"

	FactChallengeAdmitted = "challenge.admitted"
	FactLearningRecorded  = "learning.recorded"
	maxMaterialBytes      = 4 * 1024 * 1024
	maxTotalMaterialBytes = 12 * 1024 * 1024
	maxExperiments        = 12
	proposalTimeout       = 2 * time.Minute
)

type ChallengeRequest struct {
	Title             string            `json:"title"`
	Statement         string            `json:"statement"`
	Category          string            `json:"category"`
	CollaborationMode string            `json:"collaborationMode"`
	TrackName         string            `json:"trackName"`
	HumanGoal         string            `json:"humanGoal"`
	SourceKind        string            `json:"sourceKind"`
	SourceURI         string            `json:"sourceUri"`
	ExpectedFlag      string            `json:"expectedFlag"`
	KnowledgePoints   []string          `json:"knowledgePoints"`
	Materials         []MaterialRequest `json:"materials"`
}

type MaterialRequest struct {
	Name       string `json:"name"`
	MediaType  string `json:"mediaType"`
	DataBase64 string `json:"dataBase64"`
	Provenance string `json:"provenance"`
}

type admittedRequest struct {
	title             string
	statement         string
	category          string
	collaborationMode string
	trackName         string
	humanGoal         string
	source            ChallengeSource
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
	ID                string          `json:"id"`
	Title             string          `json:"title"`
	Statement         string          `json:"statement"`
	Category          string          `json:"category"`
	CollaborationMode string          `json:"collaborationMode"`
	TrackName         string          `json:"trackName"`
	HumanGoal         string          `json:"humanGoal"`
	Source            ChallengeSource `json:"source"`
	Materials         []Material      `json:"materials"`
	KnowledgePoints   []string        `json:"knowledgePoints"`
	JudgeType         string          `json:"judgeType"`
	JudgeVersion      string          `json:"judgeVersion"`
	AdmittedAt        time.Time       `json:"admittedAt"`
}

type LearningRecord struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Content   string    `json:"content"`
	Concept   string    `json:"concept,omitempty"`
	Level     int       `json:"level,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type LearningRecordRequest struct {
	Kind    string `json:"kind"`
	Content string `json:"content"`
	Concept string `json:"concept"`
	Level   int    `json:"level"`
}

type HumanOutcomeView struct {
	Goal             string   `json:"goal"`
	KnowledgePoints  []string `json:"knowledgePoints"`
	HintCount        int      `json:"hintCount"`
	ReflectionCount  int      `json:"reflectionCount"`
	IndependentSteps int      `json:"independentSteps"`
	Summary          string   `json:"summary"`
}

type ExperimentView struct {
	ID           string                        `json:"id"`
	Number       int                           `json:"number"`
	Status       securityruntime.StepStatus    `json:"status"`
	Action       *securityruntime.Action       `json:"action,omitempty"`
	Observations []securityruntime.Observation `json:"observations"`
	ArtifactIDs  []string                      `json:"artifactIds"`
}

type SubmissionView struct {
	Candidate string                  `json:"candidate"`
	Verdict   securityruntime.Verdict `json:"verdict"`
	Summary   string                  `json:"summary"`
}

type Projection struct {
	ContractVersion string                       `json:"contractVersion"`
	Job             securityruntime.Job          `json:"job"`
	Challenge       ChallengeView                `json:"challenge"`
	Attempts        []securityruntime.Attempt    `json:"attempts"`
	Experiments     []ExperimentView             `json:"experiments"`
	Artifacts       []securityruntime.Artifact   `json:"artifacts"`
	Evidence        []securityruntime.Evidence   `json:"evidence"`
	Evaluations     []securityruntime.Evaluation `json:"evaluations"`
	Submissions     []SubmissionView             `json:"submissions"`
	Learning        []LearningRecord             `json:"learning"`
	HumanOutcome    HumanOutcomeView             `json:"humanOutcome"`
	Outcome         *securityruntime.Outcome     `json:"outcome,omitempty"`
	Events          []securityruntime.Event      `json:"events"`
}

type Summary struct {
	ID              string                    `json:"id"`
	Title           string                    `json:"title"`
	Category        string                    `json:"category"`
	Status          securityruntime.JobStatus `json:"status"`
	ExperimentCount int                       `json:"experimentCount"`
	Verdict         securityruntime.Verdict   `json:"verdict,omitempty"`
	UpdatedAt       time.Time                 `json:"updatedAt"`
}

func validateRequest(request ChallengeRequest) (admittedRequest, error) {
	title := strings.TrimSpace(request.Title)
	statement := strings.TrimSpace(request.Statement)
	category := strings.TrimSpace(request.Category)
	mode := strings.ToLower(strings.TrimSpace(request.CollaborationMode))
	expectedFlag := strings.TrimSpace(request.ExpectedFlag)
	trackName := strings.TrimSpace(request.TrackName)
	humanGoal := strings.TrimSpace(request.HumanGoal)
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
	source, err := validateSource(request.SourceKind, request.SourceURI)
	if err != nil {
		return admittedRequest{}, err
	}

	result := admittedRequest{
		title: title, statement: statement, category: category, collaborationMode: mode,
		trackName: trackName, humanGoal: humanGoal, source: source, expectedFlag: expectedFlag,
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

	total := 0
	for index, material := range request.Materials {
		name := strings.TrimSpace(material.Name)
		if name == "" || len([]rune(name)) > 160 || filepath.Base(name) != name || strings.ContainsAny(name, `/\\`) {
			return admittedRequest{}, fmt.Errorf("material %d has an invalid name", index+1)
		}
		mediaType := strings.TrimSpace(material.MediaType)
		if mediaType == "" || len(mediaType) > 128 {
			return admittedRequest{}, fmt.Errorf("material %q has an invalid media type", name)
		}
		data, err := base64.StdEncoding.DecodeString(material.DataBase64)
		if err != nil {
			return admittedRequest{}, fmt.Errorf("decode material %q: %w", name, err)
		}
		if len(data) == 0 || len(data) > maxMaterialBytes {
			return admittedRequest{}, fmt.Errorf("material %q must be between 1 byte and 4 MiB", name)
		}
		total += len(data)
		if total > maxTotalMaterialBytes {
			return admittedRequest{}, fmt.Errorf("challenge materials exceed the 12 MiB limit")
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

func validateSource(kind, rawURI string) (ChallengeSource, error) {
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
		if kind == "ssh" {
			parsed, err := url.Parse(rawURI)
			if err != nil || parsed.Scheme != "ssh" || parsed.Host == "" || parsed.User == nil || parsed.User.String() == "" || strings.Contains(parsed.User.String(), ":") {
				return ChallengeSource{}, fmt.Errorf("SSH intake requires ssh://user@host:port without a password")
			}
			value = parsed.Host
		}
		target = securitypolicy.Target{Kind: securitypolicy.TargetSocket, Value: value}
	case "local-lab":
		target = securitypolicy.Target{Kind: securitypolicy.TargetLab, Value: rawURI}
	default:
		return ChallengeSource{}, fmt.Errorf("unsupported challenge source %q", kind)
	}
	normalized, err := securitypolicy.NormalizeTarget(target)
	if err != nil {
		return ChallengeSource{}, err
	}
	grant, err := securitypolicy.NewGrant("challenge-intake:"+kind, "ctf learning", []securitypolicy.Target{normalized}, 24*time.Hour)
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
