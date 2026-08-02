import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REVIEWED_LSP_SERVER_NAMES = [
  "milksu-go",
  "milksu-vue",
  "milksu-typescript",
];

const sidecarDirectory = dirname(fileURLToPath(import.meta.url));
const installedLspRuntime = existsSync(
  join(sidecarDirectory, "lsp-runtime", "node_modules"),
)
  ? join(sidecarDirectory, "lsp-runtime")
  : sidecarDirectory;
const packagedVueLanguageServer = join(
  installedLspRuntime,
  "node_modules",
  "@vue",
  "language-server",
  "bin",
  "vue-language-server.js",
);
const packagedTypeScriptLanguageServer = join(
  installedLspRuntime,
  "node_modules",
  "typescript-language-server",
  "lib",
  "cli.mjs",
);

const PASSTHROUGH_ENVIRONMENT_NAMES = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
];

function sanitizedEnvironmentArguments(environment) {
  return PASSTHROUGH_ENVIRONMENT_NAMES.flatMap((name) => {
    const value = environment[name];
    if (typeof value !== "string" || value.length === 0) return [];
    return [`${name}=${value.replaceAll("\0", "")}`];
  });
}

export function reviewedLspConfig(
  environment = process.env,
  platform = process.platform,
) {
  if (platform !== "darwin" && platform !== "linux") {
    return JSON.stringify({ timeout: 20000, servers: {} });
  }

  // pi-lsp merges the Sidecar environment into each language-server process.
  // Launching through the operating system's trusted `env -i` binary gives the
  // actual server only the small non-secret environment below. The project
  // cannot replace this command through .pi/pi-lsp.json.
  const commandPrefix = [
    "/usr/bin/env",
    "-i",
    ...sanitizedEnvironmentArguments(environment),
  ];

  return JSON.stringify({
    timeout: 20000,
    servers: {
      "milksu-go": {
        command: [...commandPrefix, "gopls"],
        extensions: [".go"],
      },
      "milksu-vue": {
        command: [
          ...commandPrefix,
          process.execPath,
          packagedVueLanguageServer,
          "--stdio",
        ],
        extensions: [".vue"],
      },
      "milksu-typescript": {
        command: [
          ...commandPrefix,
          process.execPath,
          packagedTypeScriptLanguageServer,
          "--stdio",
        ],
        extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
      },
    },
  });
}

export function applyCodingResourcePolicy(
  environment = process.env,
  platform = process.platform,
) {
  environment.PI_LSP_CONFIG = reviewedLspConfig(environment, platform);
  // MilkSU intentionally exposes only pi-mcp-adapter's single proxy tool so
  // every external call passes through one approval and activity boundary.
  environment.MCP_DIRECT_TOOLS = "__none__";

  for (const name of REVIEWED_LSP_SERVER_NAMES) {
    const override = `PI_${name.replaceAll("-", "_").toUpperCase()}_LSP_COMMAND`;
    delete environment[override];
  }
}

export function describeLoadedExtensions(resourceLoader) {
  const result = resourceLoader.getExtensions();
  const names = result.extensions.flatMap((extension) => {
    const tools = extension.tools;
    if (tools.has("milksu_progress")) return ["milksu-workflow"];
    if (tools.has("lsp_diagnostics") && tools.has("lsp_fix")) return ["pi-lsp"];
    if (tools.has("goal_complete") && tools.has("goal_blocked")) return ["pi-goal"];
    if (tools.has("bg_task") && tools.has("bg_status")) {
      return ["pi-background-tasks"];
    }
    if (tools.has("mcp")) return ["pi-mcp-adapter"];
    return [];
  });
  return {
    names: [...new Set(names)],
    errors: result.errors.map(({ path, error }) => ({ path, error })),
  };
}
