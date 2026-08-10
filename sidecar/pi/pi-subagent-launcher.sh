#!/bin/sh

set -eu

# Node's permission model injects its own permission flags into NODE_OPTIONS
# for child processes. The MilkSU runner applies a narrower macOS sandbox
# itself, so it must start outside the parent Node permission layer.
unset NODE_OPTIONS
exec "$@"
