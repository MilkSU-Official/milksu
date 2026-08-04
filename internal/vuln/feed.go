package vuln

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	CISAKEVFeedName       = "CISA KEV"
	CISAKEVFeedURL        = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
	NVDCVEFeedName        = "NVD"
	NVDCVEAPIURL          = "https://services.nvd.nist.gov/rest/json/cves/2.0"
	VulhubPracticeCatalog = "Vulhub Practice Catalog"
	VulhubRepoAPIURL      = "https://api.github.com/repos/vulhub/vulhub"
	VulhubRepoWebURL      = "https://github.com/vulhub/vulhub"
	vulhubDefaultBranch   = "master"
	maxFeedBytes          = 12 << 20
)

var (
	cveIDPattern   = regexp.MustCompile(`^CVE-\d{4}-\d{4,}$`)
	cvePathPattern = regexp.MustCompile(`(?i)CVE-\d{4}-\d{4,}`)
)

// FeedSnapshotDownload is a read-only vulnerability intelligence payload.
// It carries raw JSON plus source timing so the frontend can parse, cache, and
// attribute records without treating the feed as a Judge or exploit signal.
type FeedSnapshotDownload struct {
	SourceName   string `json:"sourceName"`
	SourceURL    string `json:"sourceUrl"`
	RetrievedAt  string `json:"retrievedAt"`
	LastModified string `json:"lastModified"`
	HTTPStatus   int    `json:"httpStatus"`
	ContentType  string `json:"contentType"`
	Body         string `json:"body"`
}

func FetchCISAKEVFeed(ctx context.Context, client *http.Client) (FeedSnapshotDownload, error) {
	return FetchFeedSnapshot(ctx, client, CISAKEVFeedName, CISAKEVFeedURL)
}

func FetchNVDCVE(ctx context.Context, client *http.Client, cveID string) (FeedSnapshotDownload, error) {
	return FetchNVDCVEFrom(ctx, client, NVDCVEAPIURL, cveID)
}

func FetchNVDCVEFrom(
	ctx context.Context,
	client *http.Client,
	apiURL string,
	cveID string,
) (FeedSnapshotDownload, error) {
	normalizedID := strings.ToUpper(strings.TrimSpace(cveID))
	if !cveIDPattern.MatchString(normalizedID) {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch NVD CVE: invalid CVE id")
	}
	parsed, err := url.Parse(strings.TrimSpace(apiURL))
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch NVD CVE: invalid API URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch NVD CVE: unsupported API URL scheme %q", parsed.Scheme)
	}
	query := parsed.Query()
	query.Set("cveId", normalizedID)
	parsed.RawQuery = query.Encode()
	return FetchFeedSnapshot(ctx, client, NVDCVEFeedName, parsed.String())
}

func FetchVulhubPracticeCatalog(ctx context.Context, client *http.Client) (FeedSnapshotDownload, error) {
	return FetchVulhubPracticeCatalogFrom(
		ctx,
		client,
		VulhubRepoAPIURL,
		VulhubRepoWebURL,
		vulhubDefaultBranch,
	)
}

func FetchVulhubPracticeCatalogFrom(
	ctx context.Context,
	client *http.Client,
	repoAPIURL string,
	repoWebURL string,
	branchName string,
) (FeedSnapshotDownload, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	repoAPIURL = strings.TrimRight(repoAPIURL, "/")
	repoWebURL = strings.TrimRight(repoWebURL, "/")
	if branchName == "" {
		branchName = vulhubDefaultBranch
	}

	branchURL := repoAPIURL + "/branches/" + url.PathEscape(branchName)
	branch, branchHeaders, err := fetchGitHubJSON[vulhubBranchResponse](ctx, client, branchURL)
	if err != nil {
		return FeedSnapshotDownload{}, err
	}
	commitSHA := strings.TrimSpace(branch.Commit.SHA)
	if commitSHA == "" {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch Vulhub catalog: GitHub branch response did not include commit sha")
	}

	treeURL := repoAPIURL + "/git/trees/" + url.PathEscape(commitSHA) + "?recursive=1"
	tree, treeHeaders, err := fetchGitHubJSON[vulhubTreeResponse](ctx, client, treeURL)
	if err != nil {
		return FeedSnapshotDownload{}, err
	}
	if tree.Truncated {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch Vulhub catalog: GitHub tree response was truncated")
	}

	retrievedAt := retrievedAtFromHeaders(treeHeaders)
	if retrievedAt == "" {
		retrievedAt = retrievedAtFromHeaders(branchHeaders)
	}
	catalog := buildVulhubPracticeCatalog(tree, commitSHA, branchName, repoWebURL, retrievedAt)
	body, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("encode Vulhub catalog: %w", err)
	}
	return FeedSnapshotDownload{
		SourceName:   VulhubPracticeCatalog,
		SourceURL:    repoWebURL,
		RetrievedAt:  retrievedAt,
		LastModified: treeHeaders.Get("Last-Modified"),
		HTTPStatus:   http.StatusOK,
		ContentType:  "application/json",
		Body:         string(body),
	}, nil
}

func FetchFeedSnapshot(
	ctx context.Context,
	client *http.Client,
	sourceName string,
	sourceURL string,
) (FeedSnapshotDownload, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("create vulnerability feed request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "MilkSU-CVE-Learning/0.1")

	response, err := client.Do(request)
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch vulnerability feed: %w", err)
	}
	defer response.Body.Close()

	contentType := response.Header.Get("Content-Type")
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch vulnerability feed: unexpected HTTP %d", response.StatusCode)
	}
	if mediaType, _, err := mime.ParseMediaType(contentType); err == nil {
		if !strings.Contains(strings.ToLower(mediaType), "json") {
			return FeedSnapshotDownload{}, fmt.Errorf("fetch vulnerability feed: unexpected content type %q", contentType)
		}
	}

	limited := io.LimitReader(response.Body, maxFeedBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("read vulnerability feed: %w", err)
	}
	if len(body) > maxFeedBytes {
		return FeedSnapshotDownload{}, fmt.Errorf("read vulnerability feed: payload exceeds %d bytes", maxFeedBytes)
	}
	return FeedSnapshotDownload{
		SourceName:   sourceName,
		SourceURL:    sourceURL,
		RetrievedAt:  retrievedAtFromHeaders(response.Header),
		LastModified: response.Header.Get("Last-Modified"),
		HTTPStatus:   response.StatusCode,
		ContentType:  contentType,
		Body:         string(body),
	}, nil
}

type vulhubBranchResponse struct {
	Commit struct {
		SHA string `json:"sha"`
	} `json:"commit"`
}

type vulhubTreeResponse struct {
	SHA       string `json:"sha"`
	Truncated bool   `json:"truncated"`
	Tree      []struct {
		Path string `json:"path"`
		Type string `json:"type"`
	} `json:"tree"`
}

type vulhubPracticeCatalogPayload struct {
	SourceName  string                  `json:"sourceName"`
	SourceURL   string                  `json:"sourceUrl"`
	RetrievedAt string                  `json:"retrievedAt"`
	Revision    string                  `json:"revision"`
	Commit      string                  `json:"commit"`
	ItemCount   int                     `json:"itemCount"`
	Items       []vulhubPracticeCatalog `json:"items"`
}

type vulhubPracticeCatalog struct {
	CVEID       string   `json:"cveId"`
	Title       string   `json:"title"`
	Directory   string   `json:"directory"`
	SourceLabel string   `json:"sourceLabel"`
	SourceHref  string   `json:"sourceHref"`
	Revision    string   `json:"revision"`
	Ports       []string `json:"ports"`
	Resources   string   `json:"resources"`
	Network     string   `json:"network"`
	Cleanup     string   `json:"cleanup"`
	Safety      []string `json:"safety"`
	MatchReason string   `json:"matchReason"`
	Environment string   `json:"environmentId"`
}

func fetchGitHubJSON[T any](
	ctx context.Context,
	client *http.Client,
	sourceURL string,
) (T, http.Header, error) {
	var zero T
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return zero, nil, fmt.Errorf("create GitHub request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "MilkSU-CVE-Learning/0.1")

	response, err := client.Do(request)
	if err != nil {
		return zero, nil, fmt.Errorf("fetch GitHub JSON: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return zero, response.Header, fmt.Errorf("fetch GitHub JSON: unexpected HTTP %d", response.StatusCode)
	}
	limited := io.LimitReader(response.Body, maxFeedBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return zero, response.Header, fmt.Errorf("read GitHub JSON: %w", err)
	}
	if len(body) > maxFeedBytes {
		return zero, response.Header, fmt.Errorf("read GitHub JSON: payload exceeds %d bytes", maxFeedBytes)
	}
	var decoded T
	if err := json.Unmarshal(body, &decoded); err != nil {
		return zero, response.Header, fmt.Errorf("decode GitHub JSON: %w", err)
	}
	return decoded, response.Header, nil
}

func buildVulhubPracticeCatalog(
	tree vulhubTreeResponse,
	commitSHA string,
	branchName string,
	repoWebURL string,
	retrievedAt string,
) vulhubPracticeCatalogPayload {
	composeDirs := map[string]bool{}
	for _, entry := range tree.Tree {
		if entry.Type != "blob" {
			continue
		}
		if !isComposePath(entry.Path) {
			continue
		}
		if directory := pathDirectory(entry.Path); directory != "" {
			composeDirs[directory] = true
		}
	}

	type recordKey struct {
		CVEID     string
		Directory string
	}
	var keys []recordKey
	for directory := range composeDirs {
		for _, match := range cvePathPattern.FindAllString(directory, -1) {
			keys = append(keys, recordKey{
				CVEID:     strings.ToUpper(match),
				Directory: directory,
			})
		}
	}
	sort.Slice(keys, func(left, right int) bool {
		if keys[left].CVEID == keys[right].CVEID {
			return keys[left].Directory < keys[right].Directory
		}
		return keys[left].CVEID < keys[right].CVEID
	})

	shortSHA := commitSHA
	if len(shortSHA) > 12 {
		shortSHA = shortSHA[:12]
	}
	revision := fmt.Sprintf("vulhub/vulhub %s %s · GitHub tree %s · %s", branchName, shortSHA, tree.SHA, retrievedAt)
	items := make([]vulhubPracticeCatalog, 0, len(keys))
	for _, key := range keys {
		component := strings.Split(key.Directory, "/")[0]
		if component == "" {
			component = "Vulhub"
		}
		items = append(items, vulhubPracticeCatalog{
			CVEID:       key.CVEID,
			Title:       fmt.Sprintf("Vulhub · %s · %s Docker Compose", component, key.CVEID),
			Directory:   key.Directory,
			SourceLabel: "vulhub/" + key.Directory,
			SourceHref:  repoWebURL + "/tree/" + url.PathEscape(commitSHA) + "/" + escapeGitHubPath(key.Directory),
			Revision:    revision,
			Ports:       []string{"待确认端口（需读取 docker-compose.yml）"},
			Resources:   "待确认镜像缓存、CPU、内存和磁盘占用；启动前由用户确认。",
			Network:     "默认仅允许本机 loopback；不继承平台 Cookie、Token、浏览器会话或 Provider Credential。",
			Cleanup:     "停止 compose project，清理临时容器/卷；保留用户笔记和学习证据。",
			Safety: []string{
				"只读 GitHub catalog 同步只绑定目录，不拉取镜像、不启动容器。",
				"开放端口、运行触发输入或访问外部目标都需要用户逐次确认。",
				"练习成功只代表本地学习完成，不证明任何真实资产可被利用。",
			},
			MatchReason: fmt.Sprintf("GitHub 只读目录树发现 %s 含 Docker Compose 与 %s；仅作为本地隔离练习候选。", key.Directory, key.CVEID),
			Environment: "vulhub-" + strings.ToLower(strings.ReplaceAll(key.CVEID, "_", "-")),
		})
	}
	return vulhubPracticeCatalogPayload{
		SourceName:  VulhubPracticeCatalog,
		SourceURL:   repoWebURL,
		RetrievedAt: retrievedAt,
		Revision:    revision,
		Commit:      commitSHA,
		ItemCount:   len(items),
		Items:       items,
	}
}

func isComposePath(path string) bool {
	return strings.HasSuffix(path, "/docker-compose.yml") ||
		strings.HasSuffix(path, "/docker-compose.yaml") ||
		strings.HasSuffix(path, "/compose.yml") ||
		strings.HasSuffix(path, "/compose.yaml")
}

func pathDirectory(path string) string {
	if before, _, found := strings.Cut(path, "/docker-compose."); found {
		return before
	}
	if before, _, found := strings.Cut(path, "/compose."); found {
		return before
	}
	return ""
}

func escapeGitHubPath(path string) string {
	parts := strings.Split(path, "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func retrievedAtFromHeaders(header http.Header) string {
	for _, key := range []string{"Last-Modified", "Date"} {
		value := header.Get(key)
		if value == "" {
			continue
		}
		parsed, err := http.ParseTime(value)
		if err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
	}
	return time.Now().UTC().Format(time.RFC3339)
}
