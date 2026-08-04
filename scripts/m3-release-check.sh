#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

wails_bin="${MILKSU_WAILS_BIN:-$(go env GOPATH)/bin/wails}"
if [[ ! -x "$wails_bin" ]]; then
  echo "Wails CLI not found at $wails_bin" >&2
  exit 1
fi

for source_file in bridge*.js; do
  if ! git ls-files --error-unmatch "$source_file" >/dev/null 2>&1; then
    echo "Required Sidecar source is not tracked by Git: $source_file" >&2
    exit 1
  fi
done
for source_file in \
  computer-use-proxy.js \
  internal/computercap/session-policy.yaml \
  pi-subagent-launcher.sh \
  pi-subagent-runner.cjs \
  patches/@earendil-works+pi-coding-agent+0.83.0.patch \
  patches/pi-sub-agent+0.1.5.patch \
  third_party/licenses/cua-MIT.txt; do
  if ! git ls-files --error-unmatch "$source_file" >/dev/null 2>&1; then
    echo "Required Computer Use source is not tracked by Git: $source_file" >&2
    exit 1
  fi
done

if [[ "${MILKSU_BROWSER_INTEGRATION:-0}" == "1" ]]; then
  MILKSU_BROWSER_INTEGRATION=0 go test ./...
  go test ./internal/browsercap -run TestManagedBrowserRoundTrip -count=1
else
  go test ./...
fi
go vet ./...
node --test ./*.test.js ./*.test.cjs
npm --prefix app test -- --run
npm --prefix app run lint
npm --prefix app run build
npm run sidecar:smoke
node scripts/test-coding-agent-delivery.mjs
npm run docs:build
"$wails_bin" build

if [[ "${MILKSU_APP_INTEGRATION:-0}" == "1" ]]; then
  npm run test:local-delivery
fi

rg -q "TestAgentModel" app/wailsjs/go/main/App.d.ts
rg -q "GetCodingDiff" app/wailsjs/go/main/App.d.ts
rg -q "GetCodingArchitecturePreview" app/wailsjs/go/main/App.d.ts
rg -q "RespondToolApproval" app/wailsjs/go/main/App.d.ts
rg -q "GetCodingComputerUseStatus" app/wailsjs/go/main/App.d.ts
rg -q "CompactCodingSession" app/wailsjs/go/main/App.d.ts
rg -q "RequestCodingComputerUsePermissions" app/wailsjs/go/main/App.d.ts
rg -q "StartCodingComputerUse" app/wailsjs/go/main/App.d.ts
rg -q "StopCodingComputerUse" app/wailsjs/go/main/App.d.ts
rg -q "PrepareCodingCollaboration" app/wailsjs/go/main/App.d.ts
rg -q "GetCodingCollaboration" app/wailsjs/go/main/App.d.ts
rg -q "FinishCodingCollaboration" app/wailsjs/go/main/App.d.ts
rg -q "ChooseCodingAttachments" app/wailsjs/go/main/App.d.ts
rg -q "GetLocalDataStatus" app/wailsjs/go/main/App.d.ts
rg -q "GetStartupRecoveryStatus" app/wailsjs/go/main/App.d.ts
rg -q "ExportLocalDataBackup" app/wailsjs/go/main/App.d.ts
rg -q "ExportLocalDiagnostics" app/wailsjs/go/main/App.d.ts
rg -q "ListNSSCTFCatalog" app/wailsjs/go/main/App.d.ts
rg -q "GetCTFAgentBudgetStatus" app/wailsjs/go/main/App.d.ts
rg -q "GetCTFAgentRunCheckpoint" app/wailsjs/go/main/App.d.ts
rg -q "GetCTFAgentReplay" app/wailsjs/go/main/App.d.ts
rg -q "GetCTFToolWorkshopState" app/wailsjs/go/main/App.d.ts
rg -q "GetCTFMemoryContext" app/wailsjs/go/main/App.d.ts
rg -q "GenerateCTFTrainingReport" app/wailsjs/go/main/App.d.ts
rg -q "OpenChromeExtensionManager" app/wailsjs/go/main/App.d.ts
rg -q "RevealBrowserExtension" app/wailsjs/go/main/App.d.ts
rg -q "sourceTargets" app/wailsjs/go/models.ts

if [[ "$(uname -s)" == "Darwin" ]]; then
  codesign --verify --deep --strict build/bin/MilkSU.app
  node scripts/check-macos-signing.mjs --app build/bin/MilkSU.app
  if [[ "${MILKSU_REQUIRE_STABLE_CODESIGN:-0}" == "1" ]]; then
    node scripts/check-macos-signing.mjs --app build/bin/MilkSU.app --require-stable
  fi
fi

mkdir -p app/dist
printf '\n' > app/dist/.gitkeep
git diff --check

echo "M3 engineering release checks passed."
