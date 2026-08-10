package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/ctf"
)

const (
	maxLocalCTFMaterialCount = 8
	maxLocalCTFMaterialBytes = 256 * 1024 * 1024
	maxLocalCTFTotalBytes    = 512 * 1024 * 1024
	localCTFMaterialTokenTTL = 2 * time.Hour
)

type localCTFMaterialStore struct {
	mu         sync.Mutex
	selections map[string]localCTFMaterialSelection
	now        func() time.Time
}

type localCTFMaterialSelection struct {
	token      string
	path       string
	name       string
	mediaType  string
	size       int64
	sha256     string
	provenance string
	info       os.FileInfo
	createdAt  time.Time
}

func newLocalCTFMaterialStore() *localCTFMaterialStore {
	return &localCTFMaterialStore{
		selections: make(map[string]localCTFMaterialSelection),
		now:        time.Now,
	}
}

func (s *localCTFMaterialStore) Import(paths []string) ([]ctf.MaterialRequest, error) {
	if len(paths) == 0 {
		return []ctf.MaterialRequest{}, nil
	}
	if len(paths) > maxLocalCTFMaterialCount {
		return nil, fmt.Errorf("一次最多补充 %d 个材料", maxLocalCTFMaterialCount)
	}

	selections := make([]localCTFMaterialSelection, 0, len(paths))
	total := int64(0)
	for _, path := range paths {
		selection, err := scanLocalCTFMaterial(path)
		if err != nil {
			return nil, err
		}
		total += selection.size
		if total > maxLocalCTFTotalBytes {
			return nil, fmt.Errorf("补充材料合计不能超过 512 MiB")
		}
		selections = append(selections, selection)
	}

	now := s.now()
	materials := make([]ctf.MaterialRequest, 0, len(selections))
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	for _, selection := range selections {
		token, err := s.newTokenLocked()
		if err != nil {
			return nil, err
		}
		selection.token = token
		selection.createdAt = now
		s.selections[token] = selection
		materials = append(materials, ctf.MaterialRequest{
			Name:        selection.name,
			MediaType:   selection.mediaType,
			Provenance:  selection.provenance,
			ImportToken: token,
			Size:        selection.size,
			SHA256:      selection.sha256,
		})
	}
	return materials, nil
}

func (s *localCTFMaterialStore) Resolve(request ctf.ChallengeRequest) (ctf.ChallengeRequest, func(), error) {
	if len(request.Materials) == 0 {
		return request, func() {}, nil
	}
	resolved := request
	resolved.Materials = append([]ctf.MaterialRequest(nil), request.Materials...)
	resolvedTokens := make([]string, 0)

	for index, material := range resolved.Materials {
		token := strings.TrimSpace(material.ImportToken)
		if token == "" {
			continue
		}
		if strings.TrimSpace(material.DataBase64) != "" || len(material.Data) > 0 {
			return ctf.ChallengeRequest{}, nil, fmt.Errorf("材料 %q 不能同时使用本地导入令牌和内联内容", material.Name)
		}
		selection, err := s.lookup(token)
		if err != nil {
			return ctf.ChallengeRequest{}, nil, err
		}
		data, err := readLocalCTFMaterialData(selection)
		if err != nil {
			return ctf.ChallengeRequest{}, nil, err
		}
		resolved.Materials[index] = ctf.MaterialRequest{
			Name:       selection.name,
			MediaType:  selection.mediaType,
			Provenance: selection.provenance,
			Data:       data,
			Size:       selection.size,
			SHA256:     selection.sha256,
		}
		resolvedTokens = append(resolvedTokens, token)
	}

	cleanup := func() {
		s.forget(resolvedTokens)
	}
	return resolved, cleanup, nil
}

func (s *localCTFMaterialStore) lookup(token string) (localCTFMaterialSelection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(s.now())
	selection, ok := s.selections[token]
	if !ok {
		return localCTFMaterialSelection{}, fmt.Errorf("本地 CTF 材料令牌已失效，请重新选择附件")
	}
	return selection, nil
}

func (s *localCTFMaterialStore) forget(tokens []string) {
	if len(tokens) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, token := range tokens {
		delete(s.selections, token)
	}
}

func (s *localCTFMaterialStore) pruneLocked(now time.Time) {
	for token, selection := range s.selections {
		if now.Sub(selection.createdAt) > localCTFMaterialTokenTTL {
			delete(s.selections, token)
		}
	}
}

func (s *localCTFMaterialStore) newTokenLocked() (string, error) {
	for attempts := 0; attempts < 8; attempts++ {
		var raw [16]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return "", fmt.Errorf("生成本地 CTF 材料令牌: %w", err)
		}
		token := "ctfmat_" + hex.EncodeToString(raw[:])
		if _, exists := s.selections[token]; !exists {
			return token, nil
		}
	}
	return "", fmt.Errorf("生成本地 CTF 材料令牌失败")
}

func scanLocalCTFMaterial(path string) (localCTFMaterialSelection, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return localCTFMaterialSelection{}, fmt.Errorf("材料路径为空")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return localCTFMaterialSelection{}, fmt.Errorf("解析材料路径失败")
	}
	absolute = filepath.Clean(absolute)
	info, err := os.Lstat(absolute)
	if err != nil {
		return localCTFMaterialSelection{}, fmt.Errorf("读取材料 %q 信息失败", filepath.Base(absolute))
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return localCTFMaterialSelection{}, fmt.Errorf("材料 %q 必须是普通文件，不能是链接或目录", filepath.Base(absolute))
	}
	name := filepath.Base(absolute)
	if err := validateLocalCTFMaterialName(name); err != nil {
		return localCTFMaterialSelection{}, err
	}
	if info.Size() <= 0 || info.Size() > maxLocalCTFMaterialBytes {
		return localCTFMaterialSelection{}, fmt.Errorf("材料 %q 必须在 1 字节到 256 MiB 之间", name)
	}

	file, err := os.Open(absolute)
	if err != nil {
		return localCTFMaterialSelection{}, fmt.Errorf("打开材料 %q 失败", name)
	}
	openedInfo, statErr := file.Stat()
	if statErr != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) || openedInfo.Size() != info.Size() {
		_ = file.Close()
		return localCTFMaterialSelection{}, fmt.Errorf("材料 %q 在读取前发生变化", name)
	}
	digest, sample, bytesRead, readErr := fingerprintLocalCTFMaterial(file)
	closeErr := file.Close()
	if readErr != nil {
		return localCTFMaterialSelection{}, fmt.Errorf("读取材料 %q 失败", name)
	}
	if closeErr != nil {
		return localCTFMaterialSelection{}, fmt.Errorf("关闭材料 %q 失败", name)
	}
	if bytesRead != info.Size() {
		return localCTFMaterialSelection{}, fmt.Errorf("材料 %q 在读取时发生变化", name)
	}
	return localCTFMaterialSelection{
		path:       absolute,
		name:       name,
		mediaType:  detectLocalCTFMaterialMediaType(name, sample),
		size:       info.Size(),
		sha256:     digest,
		provenance: fmt.Sprintf("local-file-picker:%s:sha256:%s", name, digest),
		info:       info,
	}, nil
}

func validateLocalCTFMaterialName(name string) error {
	if name == "" || name == "." || name == string(filepath.Separator) ||
		filepath.Base(name) != name || strings.ContainsAny(name, `/\`) ||
		len([]rune(name)) > 160 || !utf8.ValidString(name) ||
		strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return fmt.Errorf("材料文件名无效")
	}
	return nil
}

func fingerprintLocalCTFMaterial(file *os.File) (string, []byte, int64, error) {
	hasher := sha256.New()
	buffer := make([]byte, 64*1024)
	sample := make([]byte, 0, 512)
	bytesRead := int64(0)
	for {
		n, err := file.Read(buffer)
		if n > 0 {
			chunk := buffer[:n]
			bytesRead += int64(n)
			if bytesRead > maxLocalCTFMaterialBytes {
				return "", nil, bytesRead, fmt.Errorf("材料超过 256 MiB")
			}
			if _, writeErr := hasher.Write(chunk); writeErr != nil {
				return "", nil, bytesRead, writeErr
			}
			if len(sample) < 512 {
				remaining := 512 - len(sample)
				if len(chunk) < remaining {
					remaining = len(chunk)
				}
				sample = append(sample, chunk[:remaining]...)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", nil, bytesRead, err
		}
	}
	if bytesRead == 0 {
		return "", nil, 0, fmt.Errorf("材料为空")
	}
	return hex.EncodeToString(hasher.Sum(nil)), sample, bytesRead, nil
}

func detectLocalCTFMaterialMediaType(name string, sample []byte) string {
	mediaType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	if mediaType == "" {
		mediaType = http.DetectContentType(sample)
	}
	if separator := strings.IndexByte(mediaType, ';'); separator >= 0 {
		mediaType = mediaType[:separator]
	}
	return mediaType
}

func readLocalCTFMaterialData(selection localCTFMaterialSelection) ([]byte, error) {
	info, err := os.Lstat(selection.path)
	if err != nil {
		return nil, fmt.Errorf("读取材料 %q 信息失败", selection.name)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() ||
		!os.SameFile(selection.info, info) || info.Size() != selection.size {
		return nil, fmt.Errorf("材料 %q 在创建题目前发生变化，请重新选择附件", selection.name)
	}
	file, err := os.Open(selection.path)
	if err != nil {
		return nil, fmt.Errorf("打开材料 %q 失败", selection.name)
	}
	openedInfo, statErr := file.Stat()
	if statErr != nil || !openedInfo.Mode().IsRegular() ||
		!os.SameFile(selection.info, openedInfo) || openedInfo.Size() != selection.size {
		_ = file.Close()
		return nil, fmt.Errorf("材料 %q 在读取前发生变化，请重新选择附件", selection.name)
	}
	data, readErr := io.ReadAll(io.LimitReader(file, maxLocalCTFMaterialBytes+1))
	closeErr := file.Close()
	if readErr != nil {
		return nil, fmt.Errorf("读取材料 %q 失败", selection.name)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("关闭材料 %q 失败", selection.name)
	}
	if len(data) == 0 || int64(len(data)) != selection.size || len(data) > maxLocalCTFMaterialBytes {
		return nil, fmt.Errorf("材料 %q 在读取时发生变化，请重新选择附件", selection.name)
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != selection.sha256 {
		return nil, fmt.Errorf("材料 %q 内容已变化，请重新选择附件", selection.name)
	}
	return data, nil
}
