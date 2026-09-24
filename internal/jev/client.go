// Package jev calls the hosted Decision API. It returns discrete answers only.
// The companion model still writes the words the user sees.
package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const DefaultEndpoint = "https://openrouter.ai/api/alpha/decisions"
const DefaultModel = "typesafe/jev-1.13"

type Client struct {
	Endpoint string
	Key      string
	HTTP     *http.Client
}

type noulQuestion struct {
	Type         string `json:"type"`
	Instructions string `json:"instructions"`
}

type decideRequest struct {
	Model     string                  `json:"model"`
	State     any                     `json:"state"`
	Questions map[string]noulQuestion `json:"questions"`
}

type noulAnswer struct {
	Type string  `json:"type"`
	Noul float64 `json:"noul"`
}

type decideResponse struct {
	Answers map[string]noulAnswer `json:"answers"`
	Error   string                `json:"error"`
}

// Noul asks one yes/no question. The result is the calibrated probability that
// the answer is yes. The key stays on this client and is not written into state.
func (c *Client) Noul(ctx context.Context, state any, instructions string) (float64, error) {
	if c == nil || strings.TrimSpace(c.Key) == "" {
		return 0, fmt.Errorf("jev key is not configured")
	}
	instructions = strings.TrimSpace(instructions)
	if instructions == "" {
		return 0, fmt.Errorf("jev question is required")
	}
	payload, err := json.Marshal(decideRequest{
		Model: DefaultModel,
		State: state,
		Questions: map[string]noulQuestion{
			"gate": {Type: "noul", Instructions: instructions},
		},
	})
	if err != nil {
		return 0, err
	}
	endpoint := strings.TrimSpace(c.Endpoint)
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(c.Key))
	req.Header.Set("Content-Type", "application/json")
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, err
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("jev decide returned %d", resp.StatusCode)
	}
	var decoded decideResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return 0, err
	}
	answer, ok := decoded.Answers["gate"]
	if !ok || answer.Type != "noul" {
		return 0, fmt.Errorf("jev decide returned no noul answer")
	}
	return answer.Noul, nil
}

type choiceQuestion struct {
	Type    string   `json:"type"`
	Options []string `json:"options"`
}

type choiceRequest struct {
	Model     string                    `json:"model"`
	State     any                       `json:"state"`
	Questions map[string]choiceQuestion `json:"questions"`
}

type choiceAnswer struct {
	Type   string `json:"type"`
	Choice string `json:"choice"`
}

type choiceResponse struct {
	Answers map[string]choiceAnswer `json:"answers"`
}

// Choice asks one three-way question. The result is the selected option.
func (c *Client) Choice(ctx context.Context, state any, options []string) (string, error) {
	if c == nil || strings.TrimSpace(c.Key) == "" {
		return "", fmt.Errorf("jev key is not configured")
	}
	if len(options) < 2 {
		return "", fmt.Errorf("jev choice needs options")
	}
	payload, err := json.Marshal(choiceRequest{
		Model: DefaultModel,
		State: state,
		Questions: map[string]choiceQuestion{
			"route": {Type: "choice", Options: options},
		},
	})
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimSpace(c.Endpoint)
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(c.Key))
	req.Header.Set("Content-Type", "application/json")
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("jev decide returned %d", resp.StatusCode)
	}
	var decoded choiceResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return "", err
	}
	answer, ok := decoded.Answers["route"]
	if !ok || strings.TrimSpace(answer.Choice) == "" {
		return "", fmt.Errorf("jev decide returned no choice")
	}
	return answer.Choice, nil
}
