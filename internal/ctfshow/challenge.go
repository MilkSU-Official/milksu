package ctfshow

import "time"

type ChallengeMaterial struct {
	Name       string `json:"name"`
	MediaType  string `json:"mediaType"`
	DataBase64 string `json:"dataBase64"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
	Provenance string `json:"provenance"`
}

type ChallengeCapture struct {
	CommandID   string              `json:"commandId"`
	PlatformID  int                 `json:"platformId"`
	SourceURL   string              `json:"sourceUrl"`
	Title       string              `json:"title"`
	Category    string              `json:"category"`
	Statement   string              `json:"statement"`
	Points      int                 `json:"points"`
	SolvedCount int                 `json:"solvedCount"`
	Tags        []string            `json:"tags"`
	Materials   []ChallengeMaterial `json:"materials"`
	Warnings    []string            `json:"warnings"`
	ReceivedAt  time.Time           `json:"receivedAt"`
}

type JudgeReceipt struct {
	CommandID  string    `json:"commandId"`
	ProblemID  int       `json:"problemId"`
	Status     string    `json:"status"`
	Correct    *bool     `json:"correct,omitempty"`
	Message    string    `json:"message"`
	URL        string    `json:"url"`
	ReceivedAt time.Time `json:"receivedAt"`
}
