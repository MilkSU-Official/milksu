package research

import "time"

const (
	RunRunning     = "running"
	RunCompleted   = "completed"
	RunFailed      = "failed"
	RunCancelled   = "cancelled"
	RunInterrupted = "interrupted"
)

const (
	TaskLaunching   = "launching"
	TaskRunning     = "running"
	TaskCompleted   = "completed"
	TaskFailed      = "failed"
	TaskCancelled   = "cancelled"
	TaskInterrupted = "interrupted"
)

const (
	PhaseCollecting            = "collecting"
	PhaseWaiting               = "waiting"
	PhaseSynthesisPending      = "synthesis_pending"
	PhaseSynthesizing          = "synthesizing"
	PhaseGapFillCollecting     = "gap_fill_collecting"
	PhaseGapFillWaiting        = "gap_fill_waiting"
	PhaseFinalSynthesisPending = "final_synthesis_pending"
	PhaseFinalizing            = "finalizing"
)

const (
	CitationSupported   = "supported"
	CitationUnsupported = "unsupported"
)

type Run struct {
	ID                    string    `json:"id"`
	ConversationID        string    `json:"conversationId"`
	Query                 string    `json:"query"`
	Status                string    `json:"status"`
	Phase                 string    `json:"phase"`
	Report                string    `json:"report,omitempty"`
	WorkerStopUnconfirmed bool      `json:"workerStopUnconfirmed,omitempty"`
	TraceID               string    `json:"traceId"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type Task struct {
	ID       string `json:"id"`
	RunID    string `json:"runId"`
	Prompt   string `json:"prompt"`
	Status   string `json:"status"`
	WorkerID string `json:"workerId"`
	Batch    int    `json:"batch"`
	Result   string `json:"result,omitempty"`
}

type Source struct {
	ID          string    `json:"id"`
	RunID       string    `json:"runId"`
	URL         string    `json:"url"`
	Title       string    `json:"title"`
	RetrievedAt time.Time `json:"retrievedAt"`
	ArtifactRef string    `json:"artifactRef"`
}

type Citation struct {
	RunID    string `json:"runId"`
	Claim    string `json:"claim"`
	SourceID string `json:"sourceId"`
	Verdict  string `json:"verdict"`
	Reason   string `json:"reason,omitempty"`
}

type WorkerUpdate struct {
	ID       string `json:"id"`
	Prompt   string `json:"prompt,omitempty"`
	Status   string `json:"status"`
	WorkerID string `json:"workerId,omitempty"`
	Result   string `json:"result,omitempty"`
}

type Snapshot struct {
	Run       Run        `json:"run"`
	Tasks     []Task     `json:"tasks"`
	Sources   []Source   `json:"sources"`
	Citations []Citation `json:"citations"`
}
