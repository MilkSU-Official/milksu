package main

import (
	"embed"
	"log"
	"os"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:app/dist
var assets embed.FS

const instanceIDEnv = "MILKSU_INSTANCE_ID"

func main() {
	application, err := NewApp()
	if err != nil {
		log.Fatal(err)
	}

	err = wails.Run(&options.App{
		Title:     "MilkSU",
		Width:     1440,
		Height:    900,
		MinWidth:  1080,
		MinHeight: 680,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 247, G: 247, B: 245, A: 1},
		OnStartup:        application.Startup,
		OnShutdown:       application.Shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: singleInstanceUniqueID(),
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				application.showPrimaryWindow()
			},
		},
		Bind: []interface{}{
			application,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func singleInstanceUniqueID() string {
	suffix := strings.TrimSpace(os.Getenv(instanceIDEnv))
	if !validInstanceSuffix(suffix) {
		return appdata.BundleIdentifier
	}
	return appdata.BundleIdentifier + "." + suffix
}

func validInstanceSuffix(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '-' ||
			character == '_' ||
			character == '.' {
			continue
		}
		return false
	}
	return true
}
