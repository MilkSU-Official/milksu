package main

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

const instanceIDEnv = "MILKSU_INSTANCE_ID"

// Desktop 拉 TypeScript Runtime，Runtime 再拉本进程当原生助手。
func main() {
	log.SetOutput(os.Stderr)
	if len(os.Args) > 1 && os.Args[1] == "plugin-mcp" {
		if err := runPluginMCP(context.Background()); err != nil {
			log.Fatal(err)
		}
		return
	}
	host := newDesktopRPC(os.Stdin, os.Stdout)
	application := newNativeHelper(host)
	host.attachHelper(application)
	host.ready()
	if err := host.serve(); err != nil {
		log.Printf("desktop RPC stopped: %v", err)
	}
	application.helperShutdown()
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
