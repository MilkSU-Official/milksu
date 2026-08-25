// Node refuses to strip types under node_modules. Compile the reviewed
// TypeScript extensions to sidecar/pi/reviewed-ts before development loads.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const sidecarDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(sidecarDirectory, "..", "..");
const outputDirectory = join(sidecarDirectory, "reviewed-ts");
const outputFile = join(outputDirectory, "extensions.js");
const fingerprintFile = join(outputDirectory, ".fingerprint");
const entryFile = join(sidecarDirectory, "reviewed-extension-entries.mjs");

const reviewedPackages = [
  "@narumitw/pi-goal",
  "@narumitw/pi-lsp",
  "pi-better-background-tasks",
  "pi-mcp-adapter",
  "pi-sub-agent",
];

const reviewedPatches = [
  "@narumitw+pi-lsp+0.29.0.patch",
  "pi-better-background-tasks+0.1.10.patch",
  "pi-mcp-adapter+2.17.0.patch",
  "pi-sub-agent+0.1.5.patch",
];

function packageJSON(name) {
  return join(repositoryRoot, "node_modules", ...name.split("/"), "package.json");
}

function fingerprintReviewedTypeScript() {
  const hash = createHash("sha256");
  hash.update(readFileSync(entryFile));
  hash.update(readFileSync(fileURLToPath(import.meta.url)));
  for (const name of reviewedPackages) {
    const manifest = packageJSON(name);
    if (!existsSync(manifest)) {
      throw new Error(`reviewed TypeScript package missing: ${name}`);
    }
    hash.update(name);
    hash.update(readFileSync(manifest));
  }
  for (const patch of reviewedPatches) {
    const path = join(repositoryRoot, "patches", patch);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

export async function prepareReviewedTypeScript() {
  const fingerprint = fingerprintReviewedTypeScript();
  if (
    existsSync(outputFile)
    && existsSync(fingerprintFile)
    && readFileSync(fingerprintFile, "utf8") === fingerprint
  ) {
    return outputFile;
  }
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [entryFile],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import { createRequire as __milksuCreateRequire } from "node:module";\n'
        + "const require = __milksuCreateRequire(import.meta.url);",
    },
    external: [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
      "@napi-rs/keyring",
      "@napi-rs/system-ocr",
    ],
    legalComments: "none",
    logLevel: "silent",
  });
  writeFileSync(fingerprintFile, fingerprint, { mode: 0o600 });
  return outputFile;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await prepareReviewedTypeScript();
}
