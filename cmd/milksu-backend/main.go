package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

const instanceIDEnv = "MILKSU_INSTANCE_ID"

// The Chromium desktop shell owns windows, rendering and single-instance
// behavior. This executable is the local, typed Go runtime it supervises.
func main() {
	log.SetOutput(os.Stderr)
	if len(os.Args) > 1 && os.Args[1] == "plugin-mcp" {
		if err := runPluginMCP(context.Background()); err != nil {
			log.Fatal(err)
		}
		return
	}
	bootStarted := time.Now()
	host := newDesktopRPC(os.Stdin, os.Stdout)
	appConstructStarted := time.Now()
	application, err := newAppWithDesktopHost(host)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("[startup] go.newApp %dms", time.Since(appConstructStarted).Milliseconds())
	host.attach(application)
	startupStarted := time.Now()
	application.Startup(context.Background())
	log.Printf("[startup] go.Startup %dms", time.Since(startupStarted).Milliseconds())
	host.ready()
	log.Printf("[startup] go.ready emitted total=%dms", time.Since(bootStarted).Milliseconds())
	if err := host.serve(); err != nil {
		log.Printf("desktop RPC stopped: %v", err)
	}
	application.Shutdown(context.Background())
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
