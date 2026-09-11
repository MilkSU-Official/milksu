package plugin

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	maxBackgroundBytes     = 16 << 20
	maxBackgroundDimension = 8192
)

var safeColorPattern = regexp.MustCompile(`(?i)^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,% /+-]+\))$`)

func readThemeTokens(path string) (compiledTheme, error) {
	file, err := os.Open(path)
	if err != nil {
		return compiledTheme{}, err
	}
	defer file.Close()
	var value compiledTheme
	decoder := json.NewDecoder(io.LimitReader(file, maxEntryBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return compiledTheme{}, fmt.Errorf("decode compiled theme tokens: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return compiledTheme{}, errors.New("compiled theme token map contains trailing JSON data")
	}
	for variant, tokens := range map[string]ThemeTokens{"default": value.Default, "light": value.Light, "dark": value.Dark} {
		if err := validateThemeTokens(tokens); err != nil {
			return compiledTheme{}, fmt.Errorf("%s theme: %w", variant, err)
		}
	}
	return value, nil
}

func validateThemeTokens(value ThemeTokens) error {
	for name, color := range map[string]string{
		"canvas": value.Canvas, "surface": value.Surface, "foreground": value.Foreground,
		"muted_foreground": value.MutedForeground, "accent": value.Accent, "border": value.Border,
	} {
		if color != "" && (len(color) > 64 || !safeColorPattern.MatchString(color)) {
			return fmt.Errorf("compiled theme token %s is not a safe literal color", name)
		}
	}
	if value.BackgroundOpacity < 0 || value.BackgroundOpacity > 0.6 {
		return errors.New("background_opacity must be between 0 and 0.6")
	}
	if value.BackgroundBlur < 0 || value.BackgroundBlur > 24 {
		return errors.New("background_blur must be between 0 and 24")
	}
	if value.SurfaceOpacity != 0 && (value.SurfaceOpacity < 0.55 || value.SurfaceOpacity > 1) {
		return errors.New("surface_opacity must be between 0.55 and 1")
	}
	return nil
}

func (r *Registry) ActiveTheme() (ActiveTheme, error) {
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, fmt.Errorf("refresh plugin state: %w", err)
	}
	ids := make([]string, 0, len(r.items))
	for id, record := range r.items {
		if r.state.Enabled[id] && record.errorText == "" && record.manifest.Theme != nil && hasPermission(record.manifest, PermissionUITheme) && contributesSlot(record.manifest, "app.background") {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		r.mu.Unlock()
		return ActiveTheme{Tokens: ThemeTokens{}, Surfaces: defaultSurfaceStyles()}, nil
	}
	if len(ids) > 1 {
		r.mu.Unlock()
		return ActiveTheme{}, errors.New("multiple plugins are enabled for the exclusive app.background slot")
	}
	id := ids[0]
	record := *r.items[id]
	skin := r.state.Skin[id]
	r.mu.Unlock()
	tokens := record.theme.Default
	active := ActiveTheme{
		PluginID: id, Tokens: tokens, LightTokens: record.theme.Light,
		DarkTokens: record.theme.Dark, Surfaces: defaultSurfaceStyles(),
	}
	if skin.Configured {
		opacity := skin.Opacity
		active.BackgroundOpacity = &opacity
	}
	for _, slot := range SurfaceSlots {
		style, exists := skin.Surfaces[slot]
		if !exists {
			continue
		}
		normalized, err := normalizeSurfaceStyle(slot, style)
		if err != nil {
			return ActiveTheme{}, fmt.Errorf("%s surface: %w", slot, err)
		}
		if normalized.Mode == SurfaceModeImage {
			if err := r.validateManagedSurfaceAsset(id, slot, normalized.AssetID); err != nil {
				return ActiveTheme{}, err
			}
			normalized.AssetURL = "milksu://app/__plugin-assets/" + id + "/" + string(slot) + "/" + normalized.AssetID
		}
		active.Surfaces[slot] = normalized
	}
	return active, nil
}

func (r *Registry) ImportBackground(id, selectedPath string) (ActiveTheme, error) {
	return r.ImportSurfaceAsset(id, SurfaceContentWallpaper, selectedPath)
}

func (r *Registry) ImportSurfaceAsset(id string, slot SurfaceSlot, selectedPath string) (ActiveTheme, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return ActiveTheme{}, err
	}
	if !hasPermission(record.manifest, PermissionUIBackground) || !contributesSlot(record.manifest, "app.background") {
		return ActiveTheme{}, errors.New("plugin is not granted the app.background slot")
	}
	if !validSurfaceSlot(slot) {
		return ActiveTheme{}, fmt.Errorf("unsupported theme surface %q", slot)
	}
	info, err := os.Lstat(selectedPath)
	if err != nil {
		return ActiveTheme{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxBackgroundBytes {
		return ActiveTheme{}, fmt.Errorf("background must be a regular PNG, JPEG or WebP file no larger than %d MiB", maxBackgroundBytes>>20)
	}
	file, err := os.Open(selectedPath)
	if err != nil {
		return ActiveTheme{}, err
	}
	payload, readErr := io.ReadAll(io.LimitReader(file, maxBackgroundBytes+1))
	closeErr := file.Close()
	if readErr != nil {
		return ActiveTheme{}, readErr
	}
	if closeErr != nil {
		return ActiveTheme{}, closeErr
	}
	mime, extension, _, err := inspectBackground(payload)
	if err != nil {
		return ActiveTheme{}, err
	}
	_ = mime
	directory := r.pluginStorageDirectory(record.manifest.ID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return ActiveTheme{}, err
	}
	temporary, err := os.CreateTemp(directory, ".background-*")
	if err != nil {
		return ActiveTheme{}, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return ActiveTheme{}, err
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return ActiveTheme{}, err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return ActiveTheme{}, err
	}
	if err := temporary.Close(); err != nil {
		return ActiveTheme{}, err
	}
	digest := sha256.Sum256(payload)
	destination := filepath.Join(directory, string(slot)+"-"+hex.EncodeToString(digest[:8])+extension)
	createdAsset := false
	if existingInfo, statErr := os.Lstat(destination); statErr == nil {
		if existingInfo.Mode()&os.ModeSymlink != 0 || !existingInfo.Mode().IsRegular() || existingInfo.Size() != int64(len(payload)) {
			return ActiveTheme{}, errors.New("managed background destination is invalid")
		}
		existingPayload, readErr := os.ReadFile(destination)
		if readErr != nil || !bytes.Equal(existingPayload, payload) {
			return ActiveTheme{}, errors.New("managed background digest collision")
		}
		if err := os.Remove(temporaryPath); err != nil {
			return ActiveTheme{}, err
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return ActiveTheme{}, statErr
	} else {
		if err := os.Rename(temporaryPath, destination); err != nil {
			return ActiveTheme{}, err
		}
		createdAsset = true
	}
	if err := os.Chmod(destination, 0o600); err != nil {
		if createdAsset {
			_ = os.Remove(destination)
		}
		return ActiveTheme{}, err
	}
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, err
	}
	nextState, err := clonePersistedState(r.state)
	if err != nil {
		r.mu.Unlock()
		if createdAsset {
			_ = os.Remove(destination)
		}
		return ActiveTheme{}, err
	}
	next := nextState.Skin[record.manifest.ID]
	if next.Surfaces == nil {
		next.Surfaces = map[SurfaceSlot]SurfaceStyle{}
	}
	previous := next.Surfaces[slot].AssetID
	style := next.Surfaces[slot]
	style.Mode = SurfaceModeImage
	style.AssetID = filepath.Base(destination)
	if style.ImageOpacity == 0 {
		style.ImageOpacity = 0.22
	}
	if style.LightMask.Color == "" {
		style.LightMask = SurfaceMask{Color: "#ffffff", Opacity: 0.12}
	}
	if style.DarkMask.Color == "" {
		style.DarkMask = SurfaceMask{Color: "#000000", Opacity: 0.22}
	}
	next.Surfaces[slot] = style
	next.Configured = true
	nextState.Skin[record.manifest.ID] = next
	err = r.commitStateLocked(nextState)
	r.mu.Unlock()
	if err != nil {
		if createdAsset {
			_ = os.Remove(destination)
		}
		return ActiveTheme{}, err
	}
	if previous != "" && previous != filepath.Base(destination) {
		_ = os.Remove(filepath.Join(directory, filepath.Base(previous)))
	}
	return r.ActiveTheme()
}

func (r *Registry) UpdateBackground(id string, opacity, blur float64) (ActiveTheme, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return ActiveTheme{}, err
	}
	if !hasPermission(record.manifest, PermissionUIBackground) || opacity < 0 || opacity > 0.6 || blur < 0 || blur > 24 {
		return ActiveTheme{}, errors.New("background update is outside the granted range")
	}
	r.mu.RLock()
	style := r.state.Skin[id].Surfaces[SurfaceContentWallpaper]
	r.mu.RUnlock()
	if style.Mode == "" || style.Mode == SurfaceModeInherit {
		r.mu.Lock()
		if err := r.refreshStateLocked(); err != nil {
			r.mu.Unlock()
			return ActiveTheme{}, err
		}
		nextState, err := clonePersistedState(r.state)
		if err != nil {
			r.mu.Unlock()
			return ActiveTheme{}, err
		}
		next := nextState.Skin[id]
		next.Opacity, next.Blur, next.Configured = opacity, blur, true
		nextState.Skin[id] = next
		err = r.commitStateLocked(nextState)
		r.mu.Unlock()
		if err != nil {
			return ActiveTheme{}, err
		}
		return r.ActiveTheme()
	}
	style.ImageOpacity = opacity
	style.Blur = blur
	if style.Mode == "" {
		style.Mode = SurfaceModeInherit
	}
	return r.UpdateSurface(id, SurfaceContentWallpaper, style)
}

func (r *Registry) UpdateSurface(id string, slot SurfaceSlot, style SurfaceStyle) (ActiveTheme, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return ActiveTheme{}, err
	}
	if !hasPermission(record.manifest, PermissionUIBackground) || !contributesSlot(record.manifest, "app.background") {
		return ActiveTheme{}, errors.New("plugin is not granted the app.background slot")
	}
	if !validSurfaceSlot(slot) {
		return ActiveTheme{}, fmt.Errorf("unsupported theme surface %q", slot)
	}
	normalized, err := normalizeSurfaceStyle(slot, style)
	if err != nil {
		return ActiveTheme{}, err
	}
	if normalized.Mode == SurfaceModeImage {
		if err := r.validateManagedSurfaceAsset(id, slot, normalized.AssetID); err != nil {
			return ActiveTheme{}, err
		}
	}
	normalized.AssetURL = ""
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, err
	}
	nextState, err := clonePersistedState(r.state)
	if err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, err
	}
	next := nextState.Skin[id]
	if next.Surfaces == nil {
		next.Surfaces = map[SurfaceSlot]SurfaceStyle{}
	}
	previous := next.Surfaces[slot].AssetID
	if normalized.Mode == SurfaceModeInherit {
		delete(next.Surfaces, slot)
	} else {
		next.Surfaces[slot] = normalized
	}
	next.Configured = len(next.Surfaces) > 0
	nextState.Skin[id] = next
	err = r.commitStateLocked(nextState)
	r.mu.Unlock()
	if err != nil {
		return ActiveTheme{}, err
	}
	if previous != "" && previous != normalized.AssetID {
		_ = os.Remove(filepath.Join(r.pluginStorageDirectory(id), filepath.Base(previous)))
	}
	return r.ActiveTheme()
}

func (r *Registry) ResetBackground(id string) (ActiveTheme, error) {
	return r.ResetAllSurfaces(id)
}

func (r *Registry) ResetSurface(id string, slot SurfaceSlot) (ActiveTheme, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return ActiveTheme{}, err
	}
	if !hasPermission(record.manifest, PermissionUIBackground) || !contributesSlot(record.manifest, "app.background") || !validSurfaceSlot(slot) {
		return ActiveTheme{}, errors.New("plugin is not granted this theme surface")
	}
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, err
	}
	nextState, err := clonePersistedState(r.state)
	if err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, err
	}
	next := nextState.Skin[id]
	previous := next.Surfaces[slot].AssetID
	delete(next.Surfaces, slot)
	next.Configured = len(next.Surfaces) > 0
	nextState.Skin[id] = next
	err = r.commitStateLocked(nextState)
	r.mu.Unlock()
	if err != nil {
		return ActiveTheme{}, err
	}
	if previous != "" {
		_ = os.Remove(filepath.Join(r.pluginStorageDirectory(id), filepath.Base(previous)))
	}
	return r.ActiveTheme()
}

func (r *Registry) ResetAllSurfaces(id string) (ActiveTheme, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return ActiveTheme{}, err
	}
	if !hasPermission(record.manifest, PermissionUIBackground) || !contributesSlot(record.manifest, "app.background") {
		return ActiveTheme{}, errors.New("plugin is not granted the app.background slot")
	}
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, err
	}
	nextState, err := clonePersistedState(r.state)
	if err != nil {
		r.mu.Unlock()
		return ActiveTheme{}, err
	}
	previous := make([]string, 0, len(nextState.Skin[id].Surfaces))
	for _, style := range nextState.Skin[id].Surfaces {
		if style.AssetID != "" {
			previous = append(previous, style.AssetID)
		}
	}
	delete(nextState.Skin, id)
	err = r.commitStateLocked(nextState)
	r.mu.Unlock()
	if err != nil {
		return ActiveTheme{}, err
	}
	for _, assetID := range previous {
		_ = os.Remove(filepath.Join(r.pluginStorageDirectory(id), filepath.Base(assetID)))
	}
	return r.ActiveTheme()
}

func defaultSurfaceStyles() map[SurfaceSlot]SurfaceStyle {
	result := make(map[SurfaceSlot]SurfaceStyle, len(SurfaceSlots))
	for _, slot := range SurfaceSlots {
		result[slot] = SurfaceStyle{Mode: SurfaceModeInherit}
	}
	return result
}

func validSurfaceSlot(slot SurfaceSlot) bool {
	for _, candidate := range SurfaceSlots {
		if candidate == slot {
			return true
		}
	}
	return false
}

func normalizeSurfaceStyle(_ SurfaceSlot, value SurfaceStyle) (SurfaceStyle, error) {
	if value.Mode == "" {
		value.Mode = SurfaceModeInherit
	}
	if value.ImageOpacity < 0 || value.ImageOpacity > 0.6 || value.Blur < 0 || value.Blur > 24 {
		return SurfaceStyle{}, errors.New("image opacity must be 0..0.6 and blur must be 0..24")
	}
	for name, mask := range map[string]SurfaceMask{"light": value.LightMask, "dark": value.DarkMask} {
		if mask.Opacity < 0 || mask.Opacity > 1 || (mask.Color != "" && !hexColorPattern.MatchString(mask.Color)) {
			return SurfaceStyle{}, fmt.Errorf("%s mask must use a literal hex color and opacity 0..1", name)
		}
	}
	switch value.Mode {
	case SurfaceModeInherit:
		return SurfaceStyle{Mode: SurfaceModeInherit}, nil
	case SurfaceModeSolid:
		allowed := map[SurfaceSolid]string{
			SurfaceSolidOriginal: "", SurfaceSolidPaper: "#f4f1e8", SurfaceSolidGraphite: "#252525",
			SurfaceSolidBlack: "#000000", SurfaceSolidCyan: "#008ccf", SurfaceSolidGold: "#f5c842",
			SurfaceSolidGray: "#6b7280", SurfaceSolidCustom: value.CustomColor,
		}
		color, ok := allowed[value.Solid]
		if !ok {
			return SurfaceStyle{}, errors.New("solid surface preset is invalid")
		}
		if value.Solid == SurfaceSolidOriginal {
			return SurfaceStyle{Mode: SurfaceModeInherit}, nil
		}
		if !hexColorPattern.MatchString(color) {
			return SurfaceStyle{}, errors.New("custom surface color must be a literal #RRGGBB color")
		}
		foreground, ratio, err := contrastingForeground(color)
		if err != nil || ratio < 4.5 {
			return SurfaceStyle{}, errors.New("surface color cannot provide 4.5:1 text contrast")
		}
		value.CustomColor = color
		value.Foreground = foreground
		value.AssetID = ""
		value.AssetURL = ""
		return value, nil
	case SurfaceModeImage:
		if value.AssetID == "" || filepath.Base(value.AssetID) != value.AssetID {
			return SurfaceStyle{}, errors.New("image surface requires a managed asset handle")
		}
		if value.LightMask.Color == "" {
			value.LightMask = SurfaceMask{Color: "#ffffff", Opacity: 0.12}
		}
		if value.DarkMask.Color == "" {
			value.DarkMask = SurfaceMask{Color: "#000000", Opacity: 0.22}
		}
		return value, nil
	default:
		return SurfaceStyle{}, fmt.Errorf("unsupported surface mode %q", value.Mode)
	}
}

var hexColorPattern = regexp.MustCompile(`(?i)^#[0-9a-f]{6}$`)

func contrastingForeground(color string) (string, float64, error) {
	value, err := strconv.ParseUint(strings.TrimPrefix(color, "#"), 16, 32)
	if err != nil {
		return "", 0, err
	}
	component := func(shift uint) float64 {
		channel := float64((value>>shift)&0xff) / 255
		if channel <= 0.04045 {
			return channel / 12.92
		}
		return mathPow((channel+0.055)/1.055, 2.4)
	}
	luminance := 0.2126*component(16) + 0.7152*component(8) + 0.0722*component(0)
	black := (luminance + 0.05) / 0.05
	white := 1.05 / (luminance + 0.05)
	if white >= black {
		return "#ffffff", white, nil
	}
	return "#000000", black, nil
}

func mathPow(base, exponent float64) float64 {
	return math.Pow(base, exponent)
}

func (r *Registry) validateManagedSurfaceAsset(id string, slot SurfaceSlot, assetID string) error {
	legacyBackground := slot == SurfaceContentWallpaper && strings.HasPrefix(assetID, "background-")
	if assetID == "" || filepath.Base(assetID) != assetID || (!strings.HasPrefix(assetID, string(slot)+"-") && !legacyBackground) {
		return errors.New("managed plugin surface asset handle is invalid")
	}
	path := filepath.Join(r.pluginStorageDirectory(id), assetID)
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxBackgroundBytes {
		return errors.New("managed plugin surface asset is unavailable")
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	_, _, _, err = inspectBackground(payload)
	return err
}

func (r *Registry) SurfaceAsset(id string, slot SurfaceSlot, assetID string) ([]byte, string, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return nil, "", err
	}
	if !hasPermission(record.manifest, PermissionUIBackground) || !validSurfaceSlot(slot) {
		return nil, "", errors.New("plugin surface asset is not available")
	}
	r.mu.RLock()
	configured := r.state.Skin[id].Surfaces[slot].AssetID == assetID
	r.mu.RUnlock()
	if !configured {
		return nil, "", errors.New("plugin surface asset handle is not active")
	}
	if err := r.validateManagedSurfaceAsset(id, slot, assetID); err != nil {
		return nil, "", err
	}
	payload, err := os.ReadFile(filepath.Join(r.pluginStorageDirectory(id), assetID))
	if err != nil {
		return nil, "", err
	}
	mime, _, _, err := inspectBackground(payload)
	return payload, mime, err
}

func (r *Registry) pluginStorageDirectory(id string) string {
	return filepath.Join(r.options.DataDirectory, "plugins", pluginStorageDir, id)
}

func contributesSlot(manifest Manifest, slot string) bool {
	for _, candidate := range manifest.Contributes.Slots {
		if candidate == slot {
			return true
		}
	}
	return false
}

func inspectBackground(payload []byte) (mime, extension string, dimensions image.Point, err error) {
	if len(payload) > maxBackgroundBytes {
		return "", "", image.Point{}, errors.New("background image is too large")
	}
	if bytes.HasPrefix(payload, []byte("\x89PNG\r\n\x1a\n")) || bytes.HasPrefix(payload, []byte("\xff\xd8\xff")) {
		config, format, decodeErr := image.DecodeConfig(bufio.NewReader(bytes.NewReader(payload)))
		if decodeErr != nil {
			return "", "", image.Point{}, errors.New("background image header is invalid")
		}
		dimensions = image.Pt(config.Width, config.Height)
		if format == "png" {
			mime, extension = "image/png", ".png"
		} else if format == "jpeg" {
			mime, extension = "image/jpeg", ".jpg"
		} else {
			return "", "", image.Point{}, errors.New("background must be PNG, JPEG or WebP")
		}
	} else {
		width, height, webpErr := webPDimensions(payload)
		if webpErr != nil {
			return "", "", image.Point{}, errors.New("background must be PNG, JPEG or WebP")
		}
		mime, extension, dimensions = "image/webp", ".webp", image.Pt(width, height)
	}
	if dimensions.X < 1 || dimensions.Y < 1 || dimensions.X > maxBackgroundDimension || dimensions.Y > maxBackgroundDimension {
		return "", "", image.Point{}, fmt.Errorf("background dimensions must be between 1 and %d pixels", maxBackgroundDimension)
	}
	return mime, extension, dimensions, nil
}

func webPDimensions(payload []byte) (int, int, error) {
	if len(payload) < 30 || string(payload[:4]) != "RIFF" || string(payload[8:12]) != "WEBP" {
		return 0, 0, errors.New("not WebP")
	}
	switch string(payload[12:16]) {
	case "VP8X":
		width := 1 + int(payload[24]) + int(payload[25])<<8 + int(payload[26])<<16
		height := 1 + int(payload[27]) + int(payload[28])<<8 + int(payload[29])<<16
		return width, height, nil
	case "VP8L":
		if payload[20] != 0x2f {
			return 0, 0, errors.New("invalid lossless WebP")
		}
		width := 1 + int(payload[21]) + (int(payload[22]&0x3f) << 8)
		height := 1 + int(payload[22]>>6) + (int(payload[23]) << 2) + (int(payload[24]&0x0f) << 10)
		return width, height, nil
	case "VP8 ":
		if payload[23] != 0x9d || payload[24] != 0x01 || payload[25] != 0x2a {
			return 0, 0, errors.New("invalid lossy WebP")
		}
		width := int(binary.LittleEndian.Uint16(payload[26:28]) & 0x3fff)
		height := int(binary.LittleEndian.Uint16(payload[28:30]) & 0x3fff)
		return width, height, nil
	default:
		return 0, 0, errors.New("unsupported WebP chunk")
	}
}

func canonicalJSONMap(value map[string]any) map[string]json.RawMessage {
	result := make(map[string]json.RawMessage, len(value))
	for key, item := range value {
		encoded, err := json.Marshal(item)
		if err == nil {
			result[key] = encoded
		}
	}
	return result
}

func dataURLMIME(value string) string {
	if !strings.HasPrefix(value, "data:") {
		return ""
	}
	if index := strings.IndexByte(value, ';'); index > 5 {
		return value[5:index]
	}
	return ""
}
