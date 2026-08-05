package nssctf

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const (
	catalogPageSize        = 20
	maxCatalogResponseSize = 2 << 20
)

var ErrCatalogRateLimited = errors.New("NSSCTF catalog rate limited")

var catalogCategories = []struct {
	Type  int
	Label string
}{
	{Type: 1, Label: "Web"},
	{Type: 2, Label: "Pwn"},
	{Type: 3, Label: "Reverse"},
	{Type: 4, Label: "Crypto"},
	{Type: 5, Label: "Misc"},
	{Type: 6, Label: "Mobile"},
	{Type: 7, Label: "Ethereum"},
	{Type: 8, Label: "IoT"},
	{Type: 9, Label: "AI"},
	{Type: 10, Label: "Practice"},
}

type CatalogProblem struct {
	PlatformID       int      `json:"platformId"`
	SourceURL        string   `json:"sourceUrl"`
	Title            string   `json:"title"`
	Category         string   `json:"category"`
	Points           int      `json:"points"`
	Difficulty       float64  `json:"difficulty"`
	Tags             []string `json:"tags"`
	HasWriteup       bool     `json:"hasWriteup"`
	SolvedCount      int      `json:"solvedCount"`
	WrongAnswerCount int      `json:"wrongAnswerCount"`
	NoAnswerCount    int      `json:"noAnswerCount"`
	Open             bool     `json:"open"`
	SyncedAt         string   `json:"syncedAt"`
}

type CatalogPage struct {
	Problems []CatalogProblem
	Total    int
}

type catalogListResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail"`
	Data    struct {
		Problems []struct {
			ID    int      `json:"id"`
			Title string   `json:"title"`
			Tag   []string `json:"tag"`
			WP    bool     `json:"wp"`
			Point int      `json:"point"`
			Info  struct {
				Solved int `json:"solved"`
				Wrong  int `json:"wrong"`
				No     int `json:"no"`
			} `json:"info"`
			Level float64 `json:"level"`
			Open  bool    `json:"open"`
		} `json:"problems"`
		Total int `json:"total"`
	} `json:"data"`
}

func NormalizeCatalogURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "https://www.nssctf.cn/problem"
	}
	parsed, err := url.Parse(raw)
	if err != nil ||
		parsed.Scheme != "https" ||
		parsed.Hostname() != "www.nssctf.cn" ||
		parsed.Port() != "" ||
		parsed.User != nil ||
		(parsed.EscapedPath() != "/problem" && parsed.EscapedPath() != "/problem/") ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" {
		return "", fmt.Errorf("题库链接必须是 https://www.nssctf.cn/problem")
	}
	return "https://www.nssctf.cn/problem", nil
}

func (c *Client) FetchCatalogPage(
	ctx context.Context,
	categoryType int,
	categoryLabel string,
	page int,
) (CatalogPage, error) {
	if categoryType < 1 || categoryType > len(catalogCategories) || page < 1 {
		return CatalogPage{}, fmt.Errorf("invalid NSSCTF catalog page request")
	}
	payload := map[string]any{
		"category": 0, "contest": "", "year": "", "source": 0,
		"name": "", "username": "", "type": categoryType, "docker": 0,
		"tag": []string{}, "tagType": 0, "point": []int{1, 1000},
		"rate": []int{0, 5}, "date": "", "state": "", "unknownFlag": 0,
		"order": "point", "orderType": 0,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return CatalogPage{}, fmt.Errorf("encode NSSCTF catalog request: %w", err)
	}
	endpoint := fmt.Sprintf("%s/problem/v3/list/%d/%d/", c.baseURL, page, catalogPageSize)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return CatalogPage{}, fmt.Errorf("create NSSCTF catalog request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "MilkSU/0.1 NSSCTF-public-catalog-adapter")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return CatalogPage{}, fmt.Errorf("读取 NSSCTF 题库失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return CatalogPage{}, ErrCatalogRateLimited
	}
	if response.StatusCode != http.StatusOK {
		return CatalogPage{}, fmt.Errorf("NSSCTF 题库返回 HTTP %d", response.StatusCode)
	}
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxCatalogResponseSize+1))
	if err != nil {
		return CatalogPage{}, fmt.Errorf("读取 NSSCTF 题库响应失败: %w", err)
	}
	if len(responseBody) > maxCatalogResponseSize {
		return CatalogPage{}, fmt.Errorf("NSSCTF 题库响应超过 2 MiB 限制")
	}
	var decoded catalogListResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return CatalogPage{}, fmt.Errorf("解析 NSSCTF 题库响应失败: %w", err)
	}
	if decoded.Code == http.StatusTooManyRequests {
		return CatalogPage{}, ErrCatalogRateLimited
	}
	if decoded.Code != http.StatusOK || decoded.Data.Total < 0 {
		return CatalogPage{}, fmt.Errorf("NSSCTF 没有返回有效题库列表")
	}
	problems := make([]CatalogProblem, 0, len(decoded.Data.Problems))
	for _, value := range decoded.Data.Problems {
		title := strings.TrimSpace(value.Title)
		if value.ID <= 0 || title == "" {
			continue
		}
		tags := make([]string, 0, min(8, len(value.Tag)))
		seen := make(map[string]struct{})
		for _, rawTag := range value.Tag {
			tag := strings.TrimSpace(rawTag)
			if tag == "" {
				continue
			}
			if _, exists := seen[tag]; exists {
				continue
			}
			seen[tag] = struct{}{}
			tags = append(tags, tag)
			if len(tags) == 8 {
				break
			}
		}
		problems = append(problems, CatalogProblem{
			PlatformID: value.ID, SourceURL: fmt.Sprintf("https://www.nssctf.cn/problem/%d", value.ID),
			Title: title, Category: categoryLabel, Points: value.Point,
			Difficulty: value.Level, Tags: tags, HasWriteup: value.WP,
			SolvedCount: value.Info.Solved, WrongAnswerCount: value.Info.Wrong,
			NoAnswerCount: value.Info.No, Open: value.Open,
		})
	}
	return CatalogPage{Problems: problems, Total: decoded.Data.Total}, nil
}
