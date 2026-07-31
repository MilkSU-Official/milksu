package nssctf

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	maxArenaResponseSize = 2 << 20
	maxArenaTokenLength  = 1024
	maxArenaAnnexSize    = 4 << 20
)

type ArenaClientOptions struct {
	BaseURL    string
	HTTPClient *http.Client
}

type ArenaClient struct {
	baseURL    string
	httpClient *http.Client
}

type ArenaAgent struct {
	ID                 int64   `json:"id"`
	Slug               string  `json:"slug"`
	Name               string  `json:"name"`
	Description        string  `json:"description"`
	RepoURL            string  `json:"repo_url"`
	Framework          string  `json:"framework"`
	Rating             int     `json:"rating"`
	AttemptCount       int     `json:"attempt_count"`
	SolvedCount        int     `json:"solved_count"`
	FailedCount        int     `json:"failed_count"`
	WrongCount         int     `json:"wrong_count"`
	SuccessRate        float64 `json:"success_rate"`
	Status             int     `json:"status"`
	StatusLabel        string  `json:"status_label"`
	QualifiedForRating bool    `json:"qualified_for_rating"`
	QualifiedForRank   bool    `json:"qualified_for_rank"`
	LastUsedAt         int64   `json:"last_used_at"`
	CreateDate         int64   `json:"create_date"`
	ModifyDate         int64   `json:"modify_date"`
}

type ArenaAnnex struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	URL  string `json:"url"`
}

type ArenaAttachment struct {
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Data      []byte `json:"-"`
	Size      int64  `json:"size"`
}

type ArenaContainer struct {
	ID               int64    `json:"id"`
	State            int      `json:"state"`
	URL              []string `json:"url"`
	RemainingSeconds int      `json:"remaining_seconds"`
	CreateDate       int64    `json:"create_date"`
}

type ArenaProblem struct {
	ID               int64           `json:"id"`
	Title            string          `json:"title"`
	Type             int             `json:"type"`
	TypeLabel        string          `json:"type_label"`
	Content          string          `json:"content"`
	Tag              []string        `json:"tag"`
	Hint             json.RawMessage `json:"hint"`
	FlagType         int             `json:"flag_type"`
	ContainerEnabled bool            `json:"container_enabled"`
	Container        *ArenaContainer `json:"container"`
	Rating           int             `json:"rating"`
	Annex            *ArenaAnnex     `json:"annex"`
}

type ArenaAttempt struct {
	ID                  int64        `json:"id"`
	State               int          `json:"state"`
	StateLabel          string       `json:"state_label"`
	WrongCount          int          `json:"wrong_count"`
	MaxWrongCount       int          `json:"max_wrong_count"`
	TTLSeconds          int          `json:"ttl_seconds"`
	RemainingSeconds    int          `json:"remaining_seconds"`
	StartedAt           int64        `json:"started_at"`
	EndedAt             *int64       `json:"ended_at"`
	ExpireAt            int64        `json:"expire_at"`
	AgentRatingBefore   int          `json:"agent_rating_before"`
	AgentRatingAfter    *int         `json:"agent_rating_after"`
	ProblemRatingBefore int          `json:"problem_rating_before"`
	ProblemRatingAfter  *int         `json:"problem_rating_after"`
	RatingDelta         int          `json:"rating_delta"`
	Problem             ArenaProblem `json:"problem"`
}

type ArenaResponse struct {
	Agent                  ArenaAgent    `json:"agent"`
	Attempt                *ArenaAttempt `json:"attempt"`
	Reused                 bool          `json:"reused"`
	Correct                *bool         `json:"correct,omitempty"`
	RemainingWrongAttempts *int          `json:"remaining_wrong_attempts,omitempty"`
}

type arenaEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Msg     string          `json:"msg"`
	Data    json.RawMessage `json:"data"`
}

func NewArenaClient(options ArenaClientOptions) *ArenaClient {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 20 * time.Second,
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= 3 {
					return fmt.Errorf("too many NSSCTF Arena redirects")
				}
				if request.URL.Scheme != "https" || request.URL.Hostname() != "www.nssctf.cn" {
					return fmt.Errorf("NSSCTF Arena redirect left the allowed origin")
				}
				return nil
			},
		}
	}
	return &ArenaClient{baseURL: baseURL, httpClient: httpClient}
}

func (c *ArenaClient) Current(ctx context.Context, token string) (ArenaResponse, error) {
	return c.request(ctx, http.MethodGet, "/skill/agent/arena/current/", token, nil)
}

func (c *ArenaClient) Next(ctx context.Context, token string) (ArenaResponse, error) {
	return c.request(ctx, http.MethodPost, "/skill/agent/arena/next/", token, struct{}{})
}

func (c *ArenaClient) Attempt(ctx context.Context, token string, attemptID int64) (ArenaResponse, error) {
	if attemptID <= 0 {
		return ArenaResponse{}, fmt.Errorf("NSSCTF Arena attempt id is invalid")
	}
	path := "/skill/agent/arena/attempt/" + strconv.FormatInt(attemptID, 10) + "/"
	return c.request(ctx, http.MethodGet, path, token, nil)
}

func (c *ArenaClient) Submit(ctx context.Context, token string, attemptID int64, flag string) (ArenaResponse, error) {
	if attemptID <= 0 {
		return ArenaResponse{}, fmt.Errorf("NSSCTF Arena attempt id is invalid")
	}
	flag = strings.TrimSpace(flag)
	if flag == "" || len([]rune(flag)) > 512 {
		return ArenaResponse{}, fmt.Errorf("candidate Flag is required and must be at most 512 characters")
	}
	path := "/skill/agent/arena/attempt/" + strconv.FormatInt(attemptID, 10) + "/submit/"
	return c.request(ctx, http.MethodPost, path, token, struct {
		Flag string `json:"flag"`
	}{Flag: flag})
}

func (c *ArenaClient) Abandon(ctx context.Context, token string, attemptID int64) (ArenaResponse, error) {
	if attemptID <= 0 {
		return ArenaResponse{}, fmt.Errorf("NSSCTF Arena attempt id is invalid")
	}
	path := "/skill/agent/arena/attempt/" + strconv.FormatInt(attemptID, 10) + "/abandon/"
	return c.request(ctx, http.MethodPost, path, token, struct{}{})
}

func (c *ArenaClient) DownloadAnnex(
	ctx context.Context,
	token string,
	annex ArenaAnnex,
) (ArenaAttachment, error) {
	token, err := validateArenaToken(token)
	if err != nil {
		return ArenaAttachment{}, err
	}
	name := strings.TrimSpace(annex.Name)
	if name == "" || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return ArenaAttachment{}, fmt.Errorf("NSSCTF Agent Arena attachment has an invalid name")
	}
	if annex.Size < 0 || annex.Size > maxArenaAnnexSize {
		return ArenaAttachment{}, fmt.Errorf("NSSCTF Agent Arena attachment exceeds the 4 MiB M3 limit")
	}
	base, err := url.Parse(c.baseURL)
	if err != nil {
		return ArenaAttachment{}, fmt.Errorf("invalid NSSCTF Agent Arena base URL")
	}
	rawURL := strings.TrimSpace(annex.URL)
	reference, err := url.Parse(rawURL)
	if err != nil || rawURL == "" || reference.User != nil || reference.Fragment != "" {
		return ArenaAttachment{}, fmt.Errorf("NSSCTF Agent Arena attachment URL is invalid")
	}
	resolved := base.ResolveReference(reference)
	if resolved.Scheme != base.Scheme || resolved.Host != base.Host ||
		(resolved.Scheme != "https" && resolved.Scheme != "http") {
		return ArenaAttachment{}, fmt.Errorf("NSSCTF Agent Arena attachment left the allowed origin")
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, resolved.String(), nil)
	if err != nil {
		return ArenaAttachment{}, fmt.Errorf("create NSSCTF Agent Arena attachment request: %w", err)
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("User-Agent", "MilkSU/0.1 NSSCTF-Agent-Arena-adapter")
	client := *c.httpClient
	previousRedirect := client.CheckRedirect
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("too many NSSCTF attachment redirects")
		}
		if request.URL.Scheme != base.Scheme || request.URL.Host != base.Host || request.URL.User != nil {
			return fmt.Errorf("NSSCTF attachment redirect left the allowed origin")
		}
		if previousRedirect != nil {
			return previousRedirect(request, via)
		}
		return nil
	}
	response, err := client.Do(request)
	if err != nil {
		return ArenaAttachment{}, fmt.Errorf("download NSSCTF Agent Arena attachment: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ArenaAttachment{}, fmt.Errorf("NSSCTF Agent Arena attachment returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxArenaAnnexSize+1))
	if err != nil {
		return ArenaAttachment{}, fmt.Errorf("read NSSCTF Agent Arena attachment: %w", err)
	}
	if len(data) == 0 || len(data) > maxArenaAnnexSize {
		return ArenaAttachment{}, fmt.Errorf("NSSCTF Agent Arena attachment must be between 1 byte and 4 MiB")
	}
	if annex.Size > 0 && int64(len(data)) != annex.Size {
		return ArenaAttachment{}, fmt.Errorf(
			"NSSCTF Agent Arena attachment size mismatch: expected %d, received %d",
			annex.Size,
			len(data),
		)
	}
	mediaType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if mediaType == "" || mediaType == "application/octet-stream" {
		mediaType = http.DetectContentType(data)
	}
	return ArenaAttachment{
		Name: name, MediaType: mediaType, Data: data, Size: int64(len(data)),
	}, nil
}

func (c *ArenaClient) request(ctx context.Context, method, path, token string, payload any) (ArenaResponse, error) {
	token, err := validateArenaToken(token)
	if err != nil {
		return ArenaResponse{}, err
	}
	var body io.Reader
	if payload != nil {
		encoded, encodeErr := json.Marshal(payload)
		if encodeErr != nil {
			return ArenaResponse{}, fmt.Errorf("encode NSSCTF Arena request: %w", encodeErr)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return ArenaResponse{}, fmt.Errorf("create NSSCTF Arena request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("User-Agent", "MilkSU/0.1 NSSCTF-Agent-Arena-adapter")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return ArenaResponse{}, fmt.Errorf("NSSCTF Agent Arena request failed: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxArenaResponseSize+1))
	if err != nil {
		return ArenaResponse{}, fmt.Errorf("read NSSCTF Agent Arena response: %w", err)
	}
	if len(data) > maxArenaResponseSize {
		return ArenaResponse{}, fmt.Errorf("NSSCTF Agent Arena response exceeds 2 MiB")
	}
	if response.StatusCode != http.StatusOK {
		return ArenaResponse{}, fmt.Errorf("NSSCTF Agent Arena returned HTTP %d", response.StatusCode)
	}
	var envelope arenaEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return ArenaResponse{}, fmt.Errorf("decode NSSCTF Agent Arena response: %w", err)
	}
	if envelope.Code != http.StatusOK {
		message := strings.TrimSpace(envelope.Message)
		if message == "" {
			message = strings.TrimSpace(envelope.Msg)
		}
		message = strings.ReplaceAll(message, token, "[redacted]")
		if message == "" {
			message = "request rejected"
		}
		return ArenaResponse{}, fmt.Errorf("NSSCTF Agent Arena: %s", message)
	}
	var result ArenaResponse
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return result, nil
	}
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		return ArenaResponse{}, fmt.Errorf("decode NSSCTF Agent Arena data: %w", err)
	}
	return result, nil
}

func validateArenaToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", fmt.Errorf("请先在设置中配置 NSSCTF Agent Token")
	}
	if len(token) > maxArenaTokenLength || strings.ContainsAny(token, "\x00\r\n") || !strings.HasPrefix(token, "nss_agent_") {
		return "", fmt.Errorf("NSSCTF Agent Token 格式无效")
	}
	return token, nil
}

func ReconcilePendingSubmission(
	response ArenaResponse,
	attemptID int64,
	wrongCountBefore int,
) (ArenaResponse, bool, error) {
	if attemptID <= 0 || wrongCountBefore < 0 {
		return ArenaResponse{}, false, fmt.Errorf("NSSCTF Arena reconciliation input is invalid")
	}
	if response.Attempt == nil {
		return response, false, nil
	}
	if response.Attempt.ID != attemptID {
		return ArenaResponse{}, false, fmt.Errorf("NSSCTF Arena returned a different attempt")
	}

	state := strings.ToLower(strings.TrimSpace(response.Attempt.StateLabel))
	resolved := false
	correct := false
	switch {
	case state == "solved":
		resolved = true
		correct = true
	case response.Attempt.WrongCount > wrongCountBefore:
		resolved = true
	case state != "" && state != "active":
		resolved = true
	}
	if !resolved {
		return response, false, nil
	}
	response.Correct = &correct
	remaining := response.Attempt.MaxWrongCount - response.Attempt.WrongCount
	if remaining < 0 {
		remaining = 0
	}
	response.RemainingWrongAttempts = &remaining
	return response, true, nil
}
