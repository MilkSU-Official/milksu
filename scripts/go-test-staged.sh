#!/bin/bash
# Run `go test` only for the packages that contain the staged Go files.
set -euo pipefail

if [ $# -eq 0 ]; then
  exit 0
fi

packages=$(printf '%s\n' "$@" | xargs -n1 dirname | sort -u | sed 's/^/\.\//' | tr '\n' ' ')
if [ -z "$packages" ]; then
  exit 0
fi

echo "go test $packages"
go test $packages
