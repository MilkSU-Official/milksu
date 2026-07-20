package ctf

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const (
	PackageID     = "ctf.challenge"
	SchemaVersion = "ctf.milksu.dev/v1alpha1"

	FactChallengeAdmitted = "challenge.admitted"
	maxMaterialBytes      = 512 * 1024
	maxTotalMaterialBytes = 2 * 1024 * 1024
	maxExperiments        = 8
	proposalTimeout       = 2 * time.Minute
)

type ChallengeRequest struct {
	Title             string            `json:"title"`
	Statement         string            `json:"statement"`
	Category          string            `json:"category"`
	CollaborationMode string            `json:"collaborationMode"`
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
	ID                string     `json:"id"`
	Title             string     `json:"title"`
	Statement         string     `json:"statement"`
	Category          string     `json:"category"`
	CollaborationMode string     `json:"collaborationMode"`
	Materials         []Material `json:"materials"`
	KnowledgePoints   []string   `json:"knowledgePoints"`
	Judge             JudgeSpec  `json:"judge"`
	AdmittedAt        time.Time  `json:"admittedAt"`
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
	ID                string     `json:"id"`
	Title             string     `json:"title"`
	Statement         string     `json:"statement"`
	Category          string     `json:"category"`
	CollaborationMode string     `json:"collaborationMode"`
	Materials         []Material `json:"materials"`
	KnowledgePoints   []string   `json:"knowledgePoints"`
	JudgeType         string     `json:"judgeType"`
	JudgeVersion      string     `json:"judgeVersion"`
	AdmittedAt        time.Time  `json:"admittedAt"`
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
	if mode != "delegate" {
		return admittedRequest{}, fmt.Errorf("M2-A currently supports delegate mode only")
	}
	if expectedFlag == "" || len([]rune(expectedFlag)) > 512 {
		return admittedRequest{}, fmt.Errorf("a local expected flag is required and must be at most 512 characters")
	}
	if len(request.Materials) > 8 {
		return admittedRequest{}, fmt.Errorf("at most 8 challenge materials are supported")
	}

	result := admittedRequest{
		title: title, statement: statement, category: category, collaborationMode: mode,
		expectedFlag: expectedFlag,
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
			return admittedRequest{}, fmt.Errorf("material %q must be between 1 byte and 512 KiB", name)
		}
		total += len(data)
		if total > maxTotalMaterialBytes {
			return admittedRequest{}, fmt.Errorf("challenge materials exceed the 2 MiB M2-A limit")
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

func decodeChallengeFact(fact securityruntime.RoleFact) (Challenge, error) {
	if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion || fact.Kind != FactChallengeAdmitted {
		return Challenge{}, fmt.Errorf("unsupported CTF role fact")
	}
	var challenge Challenge
	if err := json.Unmarshal(fact.Data, &challenge); err != nil {
		return Challenge{}, fmt.Errorf("decode challenge fact: %w", err)
	}
	if challenge.ID == "" || challenge.Judge.Type != "flag.sha256" || challenge.Judge.Version == "" || len(challenge.Judge.ExpectedFlagSHA256) != 64 {
		return Challenge{}, fmt.Errorf("invalid admitted challenge")
	}
	return challenge, nil
}
