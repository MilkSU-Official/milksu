package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	pluginruntime "github.com/MilkSU-Official/milksu/internal/plugin"
	embeddedplugins "github.com/MilkSU-Official/milksu/plugins"
)

const developmentPluginHostVersion = "26.823.1"

func newPluginRegistry(dataDirectory string) (*pluginruntime.Registry, error) {
	officialDirectory, err := embeddedplugins.MaterializeOfficial(dataDirectory)
	if err != nil {
		return nil, err
	}
	options := pluginruntime.Options{
		OfficialDirectory:  officialDirectory,
		InstalledDirectory: filepath.Join(dataDirectory, "plugins", "installed"),
		DataDirectory:      dataDirectory,
		DevelopmentMode:    pluginruntime.DevelopmentModeFromEnvironment(),
		HostVersion:        pluginHostVersion(),
	}
	if options.DevelopmentMode {
		if root := findPluginProjectRoot(); root != "" {
			options.DevelopmentDirectory = filepath.Join(root, "plugins", "dev")
			options.TypeScriptWorker = filepath.Join(root, "sidecar", "plugin-runtime", "worker.mjs")
		}
		options.NodeExecutable, _ = exec.LookPath("node")
	}
	if options.NodeExecutable == "" || options.TypeScriptWorker == "" {
		if executable, executableErr := os.Executable(); executableErr == nil {
			sidecar := filepath.Join(filepath.Dir(executable), "milksu-sidecar")
			nodeName := "node"
			if runtime.GOOS == "windows" {
				nodeName = "node.exe"
			}
			node := filepath.Join(sidecar, nodeName)
			worker := filepath.Join(sidecar, "plugin-worker.mjs")
			if regularPluginRuntimeFile(node) && regularPluginRuntimeFile(worker) {
				options.NodeExecutable = node
				options.TypeScriptWorker = worker
			}
		}
	}
	return pluginruntime.New(options)
}

func pluginHostVersion() string {
	if version := strings.TrimSpace(os.Getenv("MILKSU_APP_VERSION")); version != "" {
		return version
	}
	return developmentPluginHostVersion
}

func regularPluginRuntimeFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSymlink == 0 && info.Mode().IsRegular()
}

func findPluginProjectRoot() string {
	candidates := []string{}
	if working, err := os.Getwd(); err == nil {
		candidates = append(candidates, working)
	}
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Dir(executable))
	}
	for _, start := range candidates {
		current, err := filepath.Abs(start)
		if err != nil {
			continue
		}
		for depth := 0; depth < 12; depth++ {
			if regularPluginRuntimeFile(filepath.Join(current, "go.mod")) {
				development := filepath.Join(current, "plugins", "dev")
				if info, statErr := os.Lstat(development); statErr == nil && info.Mode()&os.ModeSymlink == 0 && info.IsDir() {
					return current
				}
			}
			parent := filepath.Dir(current)
			if parent == current {
				break
			}
			current = parent
		}
	}
	return ""
}

func (a *App) ListPlugins() []pluginruntime.Descriptor {
	if a.pluginRegistry == nil {
		return []pluginruntime.Descriptor{}
	}
	return a.pluginRegistry.List()
}

func (a *App) SetPluginEnabled(id string, enabled bool) ([]pluginruntime.Descriptor, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	if err := a.pluginRegistry.SetEnabled(id, enabled); err != nil {
		return nil, err
	}
	plugins := a.pluginRegistry.List()
	a.emitDesktopEvent("plugins-changed", plugins)
	a.emitDesktopEvent("plugin-tools-changed", nil)
	if theme, err := a.pluginRegistry.ActiveTheme(); err == nil {
		a.emitDesktopEvent("plugin-theme-changed", theme)
	}
	return plugins, nil
}

func (a *App) GetPluginSettingsScript(id string) (string, error) {
	if a.pluginRegistry == nil {
		return "", errors.New("plugin registry is unavailable")
	}
	return a.pluginRegistry.SettingsScript(id)
}

func (a *App) GetActivePluginTheme() (pluginruntime.ActiveTheme, error) {
	if a.pluginRegistry == nil {
		return pluginruntime.ActiveTheme{}, errors.New("plugin registry is unavailable")
	}
	return a.pluginRegistry.ActiveTheme()
}

func (a *App) CallPluginUI(id string, request pluginruntime.UIRequest) (any, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	value, err := a.pluginRegistry.CallUI(context.Background(), id, request)
	if err == nil {
		if theme, themeErr := a.pluginRegistry.ActiveTheme(); themeErr == nil {
			a.emitDesktopEvent("plugin-theme-changed", theme)
		}
	}
	return value, err
}

type PluginBackgroundChoice struct {
	Canceled bool                      `json:"canceled"`
	Theme    pluginruntime.ActiveTheme `json:"theme"`
}

func (a *App) ChoosePluginBackground(id string) (PluginBackgroundChoice, error) {
	return a.ChoosePluginSurface(id, pluginruntime.SurfaceContentWallpaper)
}

func (a *App) ChoosePluginSurface(id string, slot pluginruntime.SurfaceSlot) (PluginBackgroundChoice, error) {
	if a.pluginRegistry == nil {
		return PluginBackgroundChoice{}, errors.New("plugin registry is unavailable")
	}
	path, err := a.openFile(desktopDialogOptions{
		Title:   "选择插件表面图片",
		Filters: []desktopFileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "webp"}}},
	})
	if err != nil {
		return PluginBackgroundChoice{}, err
	}
	if strings.TrimSpace(path) == "" {
		return PluginBackgroundChoice{Canceled: true}, nil
	}
	theme, err := a.pluginRegistry.ImportSurfaceAsset(id, slot, path)
	if err != nil {
		return PluginBackgroundChoice{}, err
	}
	a.emitDesktopEvent("plugin-theme-changed", theme)
	return PluginBackgroundChoice{Theme: theme}, nil
}

type PluginAssetResponse struct {
	MIME string `json:"mime"`
	Data []byte `json:"data"`
}

func (a *App) GetPluginSurfaceAsset(id string, slot pluginruntime.SurfaceSlot, assetID string) (PluginAssetResponse, error) {
	if a.pluginRegistry == nil {
		return PluginAssetResponse{}, errors.New("plugin registry is unavailable")
	}
	payload, mime, err := a.pluginRegistry.SurfaceAsset(id, slot, assetID)
	if err != nil {
		return PluginAssetResponse{}, err
	}
	return PluginAssetResponse{MIME: mime, Data: payload}, nil
}

func (a *App) ChoosePluginPackage() (pluginruntime.StagedPackageReview, error) {
	if a.pluginRegistry == nil {
		return pluginruntime.StagedPackageReview{}, errors.New("plugin registry is unavailable")
	}
	path, err := a.openFile(desktopDialogOptions{
		Title:   "安装 MilkSU 插件",
		Filters: []desktopFileFilter{{Name: "MilkSU 插件", Extensions: []string{"milksu-plugin"}}},
	})
	if err != nil {
		return pluginruntime.StagedPackageReview{}, err
	}
	if strings.TrimSpace(path) == "" {
		return pluginruntime.StagedPackageReview{}, nil
	}
	return a.pluginRegistry.StagePackage(path)
}

func (a *App) InstallStagedPlugin(token string, trustPublisher, confirmSensitiveChange, resetStorage bool) ([]pluginruntime.Descriptor, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	plugins, err := a.pluginRegistry.InstallStagedPackage(token, trustPublisher, confirmSensitiveChange, resetStorage)
	if err == nil {
		a.emitDesktopEvent("plugins-changed", plugins)
		a.emitDesktopEvent("plugin-tools-changed", nil)
	}
	return plugins, err
}

func (a *App) DiscardStagedPlugin(token string) error {
	if a.pluginRegistry == nil {
		return errors.New("plugin registry is unavailable")
	}
	a.pluginRegistry.DiscardStagedPackage(token)
	return nil
}

func (a *App) RollbackPlugin(id string) ([]pluginruntime.Descriptor, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	plugins, err := a.pluginRegistry.RollbackPlugin(id)
	if err == nil {
		a.emitDesktopEvent("plugins-changed", plugins)
		a.emitDesktopEvent("plugin-tools-changed", nil)
	}
	return plugins, err
}

func (a *App) UninstallPlugin(id string, deleteData bool) ([]pluginruntime.Descriptor, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	plugins, err := a.pluginRegistry.UninstallPlugin(id, deleteData)
	if err == nil {
		a.emitDesktopEvent("plugins-changed", plugins)
		a.emitDesktopEvent("plugin-tools-changed", nil)
	}
	return plugins, err
}

func (a *App) SetPluginExternalEnabled(id string, enabled bool) ([]pluginruntime.Descriptor, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	if err := a.pluginRegistry.SetExternalEnabled(id, enabled); err != nil {
		return nil, err
	}
	plugins := a.pluginRegistry.List()
	a.emitDesktopEvent("plugins-changed", plugins)
	a.emitDesktopEvent("plugin-tools-changed", nil)
	return plugins, nil
}

func (a *App) ListPluginPublishers() ([]pluginruntime.PublisherTrustDescriptor, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	return a.pluginRegistry.TrustedPublishers()
}

func (a *App) RevokePluginPublisher(keyID string) ([]pluginruntime.Descriptor, error) {
	if a.pluginRegistry == nil {
		return nil, errors.New("plugin registry is unavailable")
	}
	plugins, err := a.pluginRegistry.RevokePublisher(keyID)
	if err == nil {
		a.emitDesktopEvent("plugins-changed", plugins)
		a.emitDesktopEvent("plugin-tools-changed", nil)
	}
	return plugins, err
}
