package companion

const (
	SessionID = "companion"

	DefaultProvider = "tokenflux"
	DefaultModel    = "deepseek/deepseek-flash"

	TeachingAskMe  = "ask_me"
	TeachingHints  = "hints"
	TeachingReview = "review"

	RelayPrefix = "看板娘转达 / Companion relay:\n"
)

type ConversationRef struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Kind      string `json:"kind,omitempty"`
	Workspace string `json:"workspacePath,omitempty"`
	Kernel    string `json:"kernel,omitempty"`
	Status    string `json:"status,omitempty"`
	Archived  bool   `json:"archived,omitempty"`
}

type SessionState struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Kind      string `json:"kind,omitempty"`
	Status    string `json:"status"`
	LastError string `json:"lastError,omitempty"`
	Archived  bool   `json:"archived,omitempty"`
}

type Todo struct {
	ID                   string   `json:"id"`
	Title                string   `json:"title"`
	TargetConversationID string   `json:"targetConversationId,omitempty"`
	DependsOn            []string `json:"dependsOn,omitempty"`
	Note                 string   `json:"note,omitempty"`
	Reason               string   `json:"reason,omitempty"`
	Status               string   `json:"status"`
	UpdatedAt            int64    `json:"updatedAt,omitempty"`
}

type BoardSnapshot struct {
	Sessions []SessionState `json:"sessions"`
	Todos    []Todo         `json:"todos"`
}

type DispatchResult struct {
	Accepted          bool   `json:"accepted"`
	Delivered         bool   `json:"delivered"`
	TargetTitle       string `json:"targetTitle,omitempty"`
	EntryID           string `json:"entryId,omitempty"`
	Error             string `json:"error,omitempty"`
	NeedsConfirmation bool   `json:"needsConfirmation,omitempty"`
	IdempotentReplay  bool   `json:"idempotentReplay,omitempty"`
}

type PendingConfirm struct {
	Action         string `json:"action,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	Text           string `json:"text,omitempty"`
	IdempotencyKey string `json:"idempotencyKey,omitempty"`
	Mode           string `json:"mode,omitempty"`
	HostRequestID  string `json:"hostRequestId,omitempty"`
	TargetTitle    string `json:"targetTitle,omitempty"`
}

type Status struct {
	Ready          bool            `json:"ready"`
	Provider       string          `json:"provider"`
	Model          string          `json:"model"`
	Error          string          `json:"error,omitempty"`
	PendingConfirm *PendingConfirm `json:"pendingConfirm,omitempty"`
}

type MemoryProposal struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Markdown         string   `json:"markdown"`
	SourceSessionIDs []string `json:"sourceSessionIds,omitempty"`
	Pending          bool     `json:"pending"`
}

type ApprovedMemory struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Markdown         string   `json:"markdown"`
	Evidence         string   `json:"evidence,omitempty"`
	SourceSessionIDs []string `json:"sourceSessionIds,omitempty"`
	At               string   `json:"at,omitempty"`
}

type Catalog interface {
	Lookup(id string) (ConversationRef, error)
	ListActive() ([]ConversationRef, error)
	ListArchived() ([]ConversationRef, error)
	Create(ref ConversationRef) (ConversationRef, error)
}

type Speaker interface {
	DeliverSpeak(conversationID, text string) (entryID string, produced bool, err error)
	DeliverSteer(conversationID, text string) (entryID string, produced bool, err error)
}

type SessionControl interface {
	Abort(conversationID string) error
	Steer(conversationID, text string) error
}

type SessionSearcher interface {
	Search(query string, limit int, scope string) ([]MemoryHit, error)
}

type MemoryHit struct {
	SessionID string `json:"sessionId"`
	Snippet   string `json:"snippet"`
	Title     string `json:"title,omitempty"`
}
