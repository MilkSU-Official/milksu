package htb

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxDownloadBytes = 32 * 1024 * 1024

type DownloadedMaterial struct {
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	Data      []byte `json:"-"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
}

func (c *Client) FetchDownload(
	ctx context.Context,
	download Download,
) (DownloadedMaterial, error) {
	if download.ChallengeID <= 0 {
		return DownloadedMaterial{}, fmt.Errorf("HTB challenge id must be positive")
	}
	parsed, err := validatePublicHTTPSURL(download.URL)
	if err != nil {
		return DownloadedMaterial{}, fmt.Errorf("validate HTB download URL: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return DownloadedMaterial{}, fmt.Errorf("create HTB download request: %w", err)
	}
	request.Header.Set("Accept", "application/octet-stream, application/zip, */*;q=0.5")
	response, err := c.downloadClient.Do(request)
	if err != nil {
		return DownloadedMaterial{}, fmt.Errorf("download HTB challenge material: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return DownloadedMaterial{}, fmt.Errorf(
			"download HTB challenge material: unexpected HTTP status %d",
			response.StatusCode,
		)
	}
	if response.ContentLength > maxDownloadBytes {
		return DownloadedMaterial{}, fmt.Errorf(
			"HTB challenge material exceeds the 32 MiB automatic import limit",
		)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxDownloadBytes+1))
	if err != nil {
		return DownloadedMaterial{}, fmt.Errorf("read HTB challenge material: %w", err)
	}
	if len(data) == 0 || len(data) > maxDownloadBytes {
		return DownloadedMaterial{}, fmt.Errorf(
			"HTB challenge material must be between 1 byte and 32 MiB",
		)
	}
	name := downloadFilename(response.Header.Get("Content-Disposition"), parsed, download.ChallengeID)
	mediaType := response.Header.Get("Content-Type")
	if parsedType, _, parseErr := mime.ParseMediaType(mediaType); parseErr == nil {
		mediaType = parsedType
	} else {
		mediaType = ""
	}
	if mediaType == "" || mediaType == "application/octet-stream" {
		if inferred := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); inferred != "" {
			mediaType = inferred
		} else {
			mediaType = http.DetectContentType(data)
		}
	}
	digest := sha256.Sum256(data)
	return DownloadedMaterial{
		Name:      name,
		MediaType: mediaType,
		Data:      data,
		SHA256:    hex.EncodeToString(digest[:]),
		Size:      int64(len(data)),
	}, nil
}

func newPublicDownloadClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           publicDialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          8,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   45 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return fmt.Errorf("HTB download redirected too many times")
			}
			if _, err := validatePublicHTTPSURL(request.URL.String()); err != nil {
				return fmt.Errorf("HTB download redirect: %w", err)
			}
			return nil
		},
	}
}

func validatePublicHTTPSURL(raw string) (*url.URL, error) {
	if len(raw) > 4096 || strings.TrimSpace(raw) != raw {
		return nil, fmt.Errorf("download URL is empty or too long")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return nil, fmt.Errorf("download URL must be public HTTPS without credentials")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return nil, fmt.Errorf("download URL host is not public")
	}
	if ip := net.ParseIP(host); ip != nil && !isPublicIP(ip) {
		return nil, fmt.Errorf("download URL host is not public")
	}
	return parsed, nil
}

func publicDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("resolve HTB download address: %w", err)
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve HTB download host: %w", err)
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("HTB download host resolved to no addresses")
	}
	for _, address := range addresses {
		if !isPublicIP(address.IP) {
			return nil, fmt.Errorf("HTB download host resolved to a non-public address")
		}
	}
	dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	var lastErr error
	for _, address := range addresses {
		connection, dialErr := dialer.DialContext(
			ctx,
			network,
			net.JoinHostPort(address.IP.String(), port),
		)
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	return nil, fmt.Errorf("connect to HTB download host: %w", lastErr)
}

func isPublicIP(ip net.IP) bool {
	return ip != nil &&
		!ip.IsLoopback() &&
		!ip.IsPrivate() &&
		!ip.IsLinkLocalUnicast() &&
		!ip.IsLinkLocalMulticast() &&
		!ip.IsUnspecified() &&
		!ip.IsMulticast()
}

func downloadFilename(contentDisposition string, source *url.URL, challengeID int64) string {
	name := ""
	if _, parameters, err := mime.ParseMediaType(contentDisposition); err == nil {
		name = parameters["filename"]
	}
	if name == "" {
		name = path.Base(source.Path)
	}
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == string(filepath.Separator) ||
		!utf8.ValidString(name) ||
		len([]rune(name)) > 160 ||
		strings.IndexFunc(name, unicode.IsControl) >= 0 {
		name = fmt.Sprintf("htb-challenge-%d.bin", challengeID)
	}
	return name
}
