package vuln

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	CISAKEVFeedName        = "CISA KEV"
	CISAKEVFeedURL         = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
	NVDCVEFeedName         = "NVD"
	NVDCVEAPIURL           = "https://services.nvd.nist.gov/rest/json/cves/2.0"
	FIRSTEPSSFeedName      = "FIRST EPSS"
	FIRSTEPSSAPIURL        = "https://api.first.org/data/v1/epss"
	OSVCVEFeedName         = "OSV"
	OSVCVEAPIURL           = "https://api.osv.dev/v1/vulns"
	GitHubAdvisoriesName   = "GitHub Advisory Database"
	GitHubAdvisoriesAPIURL = "https://api.github.com/advisories"
	VulhubPracticeCatalog  = "Vulhub Practice Catalog"
	VulhubRepoAPIURL       = "https://api.github.com/repos/vulhub/vulhub"
	VulhubRepoWebURL       = "https://github.com/vulhub/vulhub"
	vulhubDefaultBranch    = "master"
	maxFeedBytes           = 12 << 20
)

var (
	cveIDPattern   = regexp.MustCompile(`^CVE-\d{4}-\d{4,}$`)
	cvePathPattern = regexp.MustCompile(`(?i)CVE-\d{4}-\d{4,}`)
)

// FeedSnapshotDownload is a read-only vulnerability intelligence payload.
// It carries raw JSON plus source timing so the frontend can parse, cache, and
// attribute records without treating the feed as a Judge or exploit signal.
type FeedSnapshotDownload struct {
	SourceName        string `json:"sourceName"`
	SourceURL         string `json:"sourceUrl"`
	RetrievedAt       string `json:"retrievedAt"`
	LastModified      string `json:"lastModified"`
	HTTPStatus        int    `json:"httpStatus"`
	ContentType       string `json:"contentType"`
	Body              string `json:"body"`
	SnapshotPath      string `json:"snapshotPath,omitempty"`
	SnapshotSHA256    string `json:"snapshotSha256,omitempty"`
	SnapshotSizeBytes int64  `json:"snapshotSizeBytes,omitempty"`
}

func FetchCISAKEVFeed(ctx context.Context, client *http.Client) (FeedSnapshotDownload, error) {
	return FetchFeedSnapshot(ctx, client, CISAKEVFeedName, CISAKEVFeedURL)
}

func FetchNVDCVE(ctx context.Context, client *http.Client, cveID string) (FeedSnapshotDownload, error) {
	return FetchNVDCVEFrom(ctx, client, NVDCVEAPIURL, cveID)
}

func FetchFIRSTEPSS(ctx context.Context, client *http.Client, cveID string) (FeedSnapshotDownload, error) {
	return FetchFIRSTEPSSFrom(ctx, client, FIRSTEPSSAPIURL, cveID)
}

func FetchOSVCVE(ctx context.Context, client *http.Client, cveID string) (FeedSnapshotDownload, error) {
	return FetchOSVCVEFrom(ctx, client, OSVCVEAPIURL, cveID)
}

func FetchGitHubAdvisories(ctx context.Context, client *http.Client, cveID string) (FeedSnapshotDownload, error) {
	return FetchGitHubAdvisoriesFrom(ctx, client, GitHubAdvisoriesAPIURL, cveID)
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

func FetchFIRSTEPSSFrom(
	ctx context.Context,
	client *http.Client,
	apiURL string,
	cveID string,
) (FeedSnapshotDownload, error) {
	normalizedID := strings.ToUpper(strings.TrimSpace(cveID))
	if !cveIDPattern.MatchString(normalizedID) {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch FIRST EPSS: invalid CVE id")
	}
	parsed, err := url.Parse(strings.TrimSpace(apiURL))
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch FIRST EPSS: invalid API URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch FIRST EPSS: unsupported API URL scheme %q", parsed.Scheme)
	}
	query := parsed.Query()
	query.Set("cve", normalizedID)
	parsed.RawQuery = query.Encode()
	return FetchFeedSnapshot(ctx, client, FIRSTEPSSFeedName, parsed.String())
}

func FetchOSVCVEFrom(
	ctx context.Context,
	client *http.Client,
	apiURL string,
	cveID string,
) (FeedSnapshotDownload, error) {
	normalizedID := strings.ToUpper(strings.TrimSpace(cveID))
	if !cveIDPattern.MatchString(normalizedID) {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch OSV CVE: invalid CVE id")
	}
	parsed, err := url.Parse(strings.TrimSpace(apiURL))
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch OSV CVE: invalid API URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch OSV CVE: unsupported API URL scheme %q", parsed.Scheme)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + url.PathEscape(normalizedID)
	return FetchFeedSnapshot(ctx, client, OSVCVEFeedName, parsed.String())
}

func FetchGitHubAdvisoriesFrom(
	ctx context.Context,
	client *http.Client,
	apiURL string,
	cveID string,
) (FeedSnapshotDownload, error) {
	normalizedID := strings.ToUpper(strings.TrimSpace(cveID))
	if !cveIDPattern.MatchString(normalizedID) {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch GitHub advisories: invalid CVE id")
	}
	parsed, err := url.Parse(strings.TrimSpace(apiURL))
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch GitHub advisories: invalid API URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch GitHub advisories: unsupported API URL scheme %q", parsed.Scheme)
	}
	query := parsed.Query()
	query.Set("cve_id", normalizedID)
	query.Set("per_page", "10")
	parsed.RawQuery = query.Encode()
	return FetchFeedSnapshot(ctx, client, GitHubAdvisoriesName, parsed.String())
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
	parsedURL, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("create vulnerability feed request: invalid URL: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return FeedSnapshotDownload{}, fmt.Errorf("create vulnerability feed request: unsupported URL scheme %q", parsedURL.Scheme)
	}
	if parsedURL.Host == "" {
		return FeedSnapshotDownload{}, fmt.Errorf("create vulnerability feed request: URL host is required")
	}
	sourceURL = parsedURL.String()
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

// PersistFeedSnapshot stores the exact public JSON payload under MilkSU's app
// data directory and annotates the download with an auditable path, SHA-256 and
// byte size. Feed bodies are public vulnerability intelligence; Provider
// credentials and user session data must never be passed through this path.
func PersistFeedSnapshot(root string, download FeedSnapshotDownload) (FeedSnapshotDownload, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return FeedSnapshotDownload{}, fmt.Errorf("persist vulnerability feed snapshot: data directory is required")
	}
	body := []byte(download.Body)
	if len(body) == 0 {
		return FeedSnapshotDownload{}, fmt.Errorf("persist vulnerability feed snapshot: body is empty")
	}
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	sourceSlug := feedSnapshotSourceSlug(download.SourceName)
	timestamp := feedSnapshotTimestamp(download.RetrievedAt, download.LastModified)
	directory := filepath.Join(root, "vuln", "feed-snapshots", sourceSlug)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("create vulnerability feed snapshot directory: %w", err)
	}
	path := filepath.Join(directory, fmt.Sprintf("%s-%s.json", timestamp, digest[:16]))
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, body, 0o600); err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("write vulnerability feed snapshot: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return FeedSnapshotDownload{}, fmt.Errorf("commit vulnerability feed snapshot: %w", err)
	}
	download.SnapshotPath = path
	download.SnapshotSHA256 = digest
	download.SnapshotSizeBytes = int64(len(body))
	return download, nil
}

func feedSnapshotSourceSlug(sourceName string) string {
	slug := strings.ToLower(strings.TrimSpace(sourceName))
	slug = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "feed"
	}
	return slug
}

func feedSnapshotTimestamp(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if parsed, err := time.Parse(time.RFC3339, value); err == nil {
			return parsed.UTC().Format("20060102T150405Z")
		}
		if parsed, err := http.ParseTime(value); err == nil {
			return parsed.UTC().Format("20060102T150405Z")
		}
		safe := regexp.MustCompile(`[^0-9A-Za-z]+`).ReplaceAllString(value, "-")
		safe = strings.Trim(safe, "-")
		if safe != "" {
			if len(safe) > 32 {
				return safe[:32]
			}
			return safe
		}
	}
	return time.Now().UTC().Format("20060102T150405Z")
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
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	parsedURL, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return zero, nil, fmt.Errorf("create GitHub request: invalid http(s) URL")
	}
	sourceURL = parsedURL.String()
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
	contentType := response.Header.Get("Content-Type")
	if mediaType, _, parseErr := mime.ParseMediaType(contentType); parseErr == nil &&
		!strings.Contains(strings.ToLower(mediaType), "json") {
		return zero, response.Header, fmt.Errorf("fetch GitHub JSON: unexpected content type %q", contentType)
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
