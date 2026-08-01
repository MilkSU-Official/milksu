#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

wails_bin="${MILKSU_WAILS_BIN:-$(go env GOPATH)/bin/wails}"
if [[ ! -x "$wails_bin" ]]; then
  echo "Wails CLI not found at $wails_bin" >&2
  exit 1
fi

go test ./...
go vet ./...
node --test bridge-approval.test.js bridge-policy.test.js bridge-resource-policy.test.js
npm --prefix app test -- --run
npm --prefix app run lint
npm --prefix app run build
npm run sidecar:smoke
npm run docs:build
"$wails_bin" build

rg -q "TestAgentModel" app/wailsjs/go/main/App.d.ts
rg -q "GetCodingDiff" app/wailsjs/go/main/App.d.ts
rg -q "GetCodingArchitecturePreview" app/wailsjs/go/main/App.d.ts
rg -q "RespondToolApproval" app/wailsjs/go/main/App.d.ts
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
fi

mkdir -p app/dist
: > app/dist/.gitkeep
git diff --check

echo "M3 engineering release checks passed."
