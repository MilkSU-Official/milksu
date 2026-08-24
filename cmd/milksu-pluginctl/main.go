package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	pluginruntime "github.com/MilkSU-Official/milksu/internal/plugin"
)

const hostVersion = "26.823.1"

var pluginID = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(arguments []string) error {
	if len(arguments) == 0 {
		return errors.New("usage: milksu-pluginctl <create|keygen|pack|verify|test> [options]")
	}
	switch arguments[0] {
	case "create":
		return createCommand(arguments[1:])
	case "keygen":
		return keygenCommand(arguments[1:])
	case "pack":
		return packCommand(arguments[1:])
	case "verify":
		return verifyCommand(arguments[1:])
	case "test":
		return testCommand(arguments[1:])
	default:
		return fmt.Errorf("unknown plugin author command %q", arguments[0])
	}
}

func keygenCommand(arguments []string) error {
	set := flag.NewFlagSet("keygen", flag.ContinueOnError)
	publisher := set.String("publisher", "", "publisher display name")
	output := set.String("out", "", "private key file")
	if err := set.Parse(arguments); err != nil {
		return err
	}
	if strings.TrimSpace(*output) == "" {
		return errors.New("keygen requires --out; private key bytes are never printed")
	}
	descriptor, err := pluginruntime.GeneratePublisherKey(*publisher, *output)
	if err != nil {
		return err
	}
	return printJSON(descriptor)
}

type repeatedFlag []string

func (value *repeatedFlag) String() string { return strings.Join(*value, ",") }
func (value *repeatedFlag) Set(next string) error {
	*value = append(*value, next)
	return nil
}

func packCommand(arguments []string) error {
	set := flag.NewFlagSet("pack", flag.ContinueOnError)
	source := set.String("source", "", "plugin source directory")
	output := set.String("out", "", "signed .milksu-plugin output")
	var keys repeatedFlag
	set.Var(&keys, "key", "signing key; repeat old then new for rotation")
	if err := set.Parse(arguments); err != nil {
		return err
	}
	inspection, err := pluginruntime.PackPlugin(*source, *output, keys)
	if err != nil {
		return err
	}
	return printJSON(inspection)
}

func verifyCommand(arguments []string) error {
	set := flag.NewFlagSet("verify", flag.ContinueOnError)
	archive := set.String("package", "", "signed .milksu-plugin file")
	host := set.String("host-version", hostVersion, "MilkSU host version")
	if err := set.Parse(arguments); err != nil {
		return err
	}
	inspection, err := pluginruntime.VerifyPluginPackage(*archive, *host)
	if err != nil {
		return err
	}
	return printJSON(inspection)
}

func testCommand(arguments []string) error {
	set := flag.NewFlagSet("test", flag.ContinueOnError)
	source := set.String("source", "", "plugin source directory")
	node := set.String("node", "", "Node.js executable for TypeScript runtime")
	worker := set.String("worker", filepath.FromSlash("sidecar/plugin-runtime/worker.mjs"), "TypeScript worker path")
	host := set.String("host-version", hostVersion, "MilkSU host version")
	if err := set.Parse(arguments); err != nil {
		return err
	}
	inspection, err := pluginruntime.TestPluginSource(*source, pluginruntime.Options{
		HostVersion: *host, NodeExecutable: *node, TypeScriptWorker: *worker,
	})
	if err != nil {
		return err
	}
	return printJSON(inspection)
}

func createCommand(arguments []string) error {
	set := flag.NewFlagSet("create", flag.ContinueOnError)
	runtimeKind := set.String("runtime", "lua", "lua skin or typescript tool")
	id := set.String("id", "", "stable plugin id")
	name := set.String("name", "", "plugin display name")
	publisher := set.String("publisher", "", "publisher display name")
	keyID := set.String("key-id", "", "Ed25519 public-key SHA-256 fingerprint")
	output := set.String("out", "", "template output directory")
	if err := set.Parse(arguments); err != nil {
		return err
	}
	if !pluginID.MatchString(*id) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*keyID) {
		return errors.New("create requires a valid --id and 64-character lowercase --key-id")
	}
	if strings.TrimSpace(*name) == "" || strings.TrimSpace(*publisher) == "" {
		return errors.New("create requires --name and --publisher")
	}
	if *output == "" {
		*output = filepath.Join("plugins", "dev", *id)
	}
	if _, err := os.Lstat(*output); err == nil {
		return errors.New("template output already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(*output), 0o700); err != nil {
		return err
	}
	// Claim the template root exclusively. This makes the cleanup below safe
	// even if another process creates the requested path after the Lstat check.
	if err := os.Mkdir(*output, 0o700); err != nil {
		return err
	}
	failed := true
	defer func() {
		if failed {
			_ = os.RemoveAll(*output)
		}
	}()
	var files map[string]string
	switch *runtimeKind {
	case "lua":
		files = luaSkinTemplate(*id, *name, *publisher, *keyID)
	case "typescript", "ts":
		files = typeScriptToolTemplate(*id, *name, *publisher, *keyID)
	default:
		return errors.New("--runtime must be lua or typescript")
	}
	for relative, contents := range files {
		path := filepath.Join(*output, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
			return err
		}
	}
	failed = false
	absolute, _ := filepath.Abs(*output)
	return printJSON(map[string]any{"id": *id, "runtime": *runtimeKind, "path": absolute})
}

func luaSkinTemplate(id, name, publisher, keyID string) map[string]string {
	manifest := map[string]any{
		"id": id, "name": name, "version": "1.0.0", "apiVersion": pluginruntime.APIVersion,
		"publisher":      map[string]any{"name": publisher, "keyId": keyID},
		"host":           map[string]any{"minVersion": hostVersion, "requiredCapabilities": []string{"runtime.lua.v1", "theme.surfaces.v1", "theme.assets.v1"}},
		"storageVersion": 1, "runtime": map[string]any{"kind": "lua", "entry": "main.lua"},
		"theme":       map[string]any{"source": "theme.json"},
		"permissions": []string{"ui.background", "ui.theme"},
		"contributes": map[string]any{"slots": []string{"app.background"}},
	}
	return map[string]string{
		"plugin.json": prettyJSON(manifest),
		"main.lua":    "plugin = {}\nfunction plugin.initialize(_context) return \"null\" end\nfunction plugin.dispose() return \"null\" end\n",
		"theme.json":  "{\n  \"default\": {},\n  \"light\": {},\n  \"dark\": {}\n}\n",
	}
}

func typeScriptToolTemplate(id, name, publisher, keyID string) map[string]string {
	empty := map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}
	manifest := map[string]any{
		"id": id, "name": name, "version": "1.0.0", "apiVersion": pluginruntime.APIVersion,
		"publisher":      map[string]any{"name": publisher, "keyId": keyID},
		"host":           map[string]any{"minVersion": hostVersion, "requiredCapabilities": []string{"runtime.typescript.v1", "agent.read-tools.v1"}},
		"storageVersion": 1, "runtime": map[string]any{"kind": "typescript", "entry": "main.mjs"},
		"permissions": []string{"agent.tools"},
		"contributes": map[string]any{"tools": []any{map[string]any{
			"name": "inspect", "description": "Return a bounded local inspection result.",
			"inputSchema": empty, "outputSchema": empty, "effect": "read", "external": "none",
		}}},
	}
	return map[string]string{
		"plugin.json": prettyJSON(manifest),
		"main.mjs":    "export default {\n  initialize(context) { if (context.apiVersion !== 'milksu.plugin/v1') throw new Error('unsupported API') },\n  async call_tool(name) { if (name !== 'inspect') throw new Error('unknown tool'); return {} },\n  dispose() {},\n}\n",
	}
}

func prettyJSON(value any) string {
	payload, _ := json.MarshalIndent(value, "", "  ")
	return string(payload) + "\n"
}

func printJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
