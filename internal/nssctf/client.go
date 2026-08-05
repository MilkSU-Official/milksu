package nssctf

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL  = "https://www.nssctf.cn/api"
	maxResponseSize = 1 << 20
)

var (
	problemPathPattern = regexp.MustCompile(`^/problem/([1-9][0-9]*)/?$`)
	htmlTagPattern     = regexp.MustCompile(`<[^>]*>`)
	spacePattern       = regexp.MustCompile(`[ \t\f\v]+`)
	newlinePattern     = regexp.MustCompile(`\n{3,}`)
)

type ClientOptions struct {
	BaseURL    string
	HTTPClient *http.Client
}

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type Challenge struct {
	Platform         string   `json:"platform"`
	PlatformID       int      `json:"platformId"`
	SourceURL        string   `json:"sourceUrl"`
	Title            string   `json:"title"`
	Statement        string   `json:"statement"`
	Category         string   `json:"category"`
	Points           int      `json:"points"`
	Difficulty       float64  `json:"difficulty"`
	Tags             []string `json:"tags"`
	HasEnvironment   bool     `json:"hasEnvironment"`
	HasAttachment    bool     `json:"hasAttachment"`
	SolvedCount      int      `json:"solvedCount"`
	WrongAnswerCount int      `json:"wrongAnswerCount"`
	WriteupCount     int      `json:"writeupCount"`
	ImportedAt       string   `json:"importedAt"`
}

type apiResponse struct {
	Code int `json:"code"`
	Data struct {
		PID    int     `json:"pid"`
		Title  string  `json:"title"`
		Desc   string  `json:"desc"`
		Point  int     `json:"point"`
		Type   int     `json:"type"`
		Level  float64 `json:"level"`
		Docker bool    `json:"docker"`
		Annex  bool    `json:"annex"`
		Tag    [][]any `json:"tag"`
		Info   struct {
			Solved  int `json:"solved"`
			WA      int `json:"wa"`
			Writeup int `json:"wp"`
		} `json:"info"`
	} `json:"data"`
}

func NewClient(options ClientOptions) *Client {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout:   12 * time.Second,
			Transport: defaultTransport(),
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= 3 {
					return fmt.Errorf("too many NSSCTF redirects")
				}
				if request.URL.Scheme != "https" || request.URL.Hostname() != "www.nssctf.cn" {
					return fmt.Errorf("NSSCTF redirect left the allowed origin")
				}
				return nil
			},
		}
	}
	return &Client{baseURL: baseURL, httpClient: httpClient}
}

func NormalizeProblemURL(raw string) (string, int, error) {
	raw = strings.TrimSpace(raw)
	if problemPathPattern.MatchString("/problem/" + raw) {
		id, err := strconv.Atoi(raw)
		if err == nil && id > 0 {
			return fmt.Sprintf("https://www.nssctf.cn/problem/%d", id), id, nil
		}
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "www.nssctf.cn" || parsed.Port() != "" || parsed.User != nil {
		return "", 0, fmt.Errorf("请输入 NSSCTF 题目 ID，或 https://www.nssctf.cn/problem/{id} 形式的链接")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", 0, fmt.Errorf("NSSCTF 题目链接不能包含查询参数或片段")
	}
	match := problemPathPattern.FindStringSubmatch(parsed.EscapedPath())
	if len(match) != 2 {
		return "", 0, fmt.Errorf("链接必须指向一个 NSSCTF 题目详情页")
	}
	id, err := strconv.Atoi(match[1])
	if err != nil || id <= 0 {
		return "", 0, fmt.Errorf("NSSCTF 题号无效")
	}
	return fmt.Sprintf("https://www.nssctf.cn/problem/%d", id), id, nil
}

func (c *Client) ImportChallenge(ctx context.Context, rawURL string) (Challenge, error) {
	sourceURL, id, err := NormalizeProblemURL(rawURL)
	if err != nil {
		return Challenge{}, err
	}
	endpoint := fmt.Sprintf("%s/problem/v2/%d/", c.baseURL, id)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Challenge{}, fmt.Errorf("create NSSCTF metadata request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "MilkSU/0.1 NSSCTF-public-metadata-adapter")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return Challenge{}, fmt.Errorf("读取 NSSCTF 公开题目失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Challenge{}, fmt.Errorf("NSSCTF 返回 HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize+1))
	if err != nil {
		return Challenge{}, fmt.Errorf("读取 NSSCTF 响应失败: %w", err)
	}
	if len(body) > maxResponseSize {
		return Challenge{}, fmt.Errorf("NSSCTF 题目元数据超过 1 MiB 限制")
	}
	var payload apiResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return Challenge{}, fmt.Errorf("解析 NSSCTF 题目元数据失败: %w", err)
	}
	if payload.Code != http.StatusOK || payload.Data.PID != id || strings.TrimSpace(payload.Data.Title) == "" {
		return Challenge{}, fmt.Errorf("NSSCTF 没有返回有效题目")
	}

	tags := make([]string, 0, min(8, len(payload.Data.Tag)))
	seen := make(map[string]struct{})
	for _, item := range payload.Data.Tag {
		if len(item) == 0 {
			continue
		}
		tag, ok := item[0].(string)
		tag = strings.TrimSpace(tag)
		if !ok || tag == "" {
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
	statement := plainText(payload.Data.Desc)
	if statement == "" {
		statement = "NSSCTF 公开题面未提供文字描述；请在平台查看环境、附件与题目要求。"
	}
	return Challenge{
		Platform: "NSSCTF", PlatformID: id, SourceURL: sourceURL,
		Title: strings.TrimSpace(payload.Data.Title), Statement: statement,
		Category: categoryName(payload.Data.Type), Points: payload.Data.Point,
		Difficulty: payload.Data.Level, Tags: tags,
		HasEnvironment: payload.Data.Docker, HasAttachment: payload.Data.Annex,
		SolvedCount: payload.Data.Info.Solved, WrongAnswerCount: payload.Data.Info.WA,
		WriteupCount: payload.Data.Info.Writeup, ImportedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func categoryName(value int) string {
	switch value {
	case 1:
		return "Web"
	case 2:
		return "Pwn"
	case 3:
		return "Reverse"
	case 4:
		return "Crypto"
	case 5:
		return "Misc"
	default:
		return "Misc"
	}
}

func CategoryName(value int) string {
	return categoryName(value)
}

func plainText(value string) string {
	value = strings.ReplaceAll(value, "<br>", "\n")
	value = strings.ReplaceAll(value, "<br/>", "\n")
	value = strings.ReplaceAll(value, "<br />", "\n")
	value = strings.ReplaceAll(value, "</p>", "\n")
	value = strings.ReplaceAll(value, "</li>", "\n")
	value = htmlTagPattern.ReplaceAllString(value, "")
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	lines := strings.Split(value, "\n")
	for index, line := range lines {
		lines[index] = strings.TrimSpace(spacePattern.ReplaceAllString(line, " "))
	}
	value = strings.TrimSpace(strings.Join(lines, "\n"))
	return newlinePattern.ReplaceAllString(value, "\n\n")
}

func NormalizeStatement(value string) string {
	return plainText(value)
}
