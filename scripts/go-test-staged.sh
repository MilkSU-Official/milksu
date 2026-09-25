#!/bin/bash
# Run `go test` only for the packages that contain the staged Go files.
set -euo pipefail

# Common Go installation directories across macOS, Linux and Windows (Git Bash).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/local/go/bin:/usr/bin:/c/Program Files/Go/bin:/c/Go/bin:$PATH"

if ! command -v go >/dev/null 2>&1; then
  echo 'go not found. Please install Go or ensure go is in PATH.' >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  exit 0
fi

packages=$(printf '%s\n' "$@" | xargs -n1 dirname | sort -u | sed 's/^/\.\//' | tr '\n' ' ')
if [ -z "$packages" ]; then
  exit 0
fi

echo "go test $packages"
go test $packages
