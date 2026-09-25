#!/bin/bash
# Run `go test` only for the packages that contain the staged Go files.
set -euo pipefail

# Common Go installation directories across macOS, Linux and Windows (Git Bash).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/local/go/bin:/usr/bin:/c/Program Files/Go/bin:/c/Go/bin:$PATH"

# git hooks export GIT_* variables; they leak into the fixture repos that
# tests create and break git worktree operations there.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_QUARANTINE_PATH GIT_PREFIX \
  GIT_LITERAL_PATHSPECS GIT_GLOB_PATHSPECS GIT_NOGLOB_PATHSPECS

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
