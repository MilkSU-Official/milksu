#!/bin/sh

set -eu

# Do not let ambient Node options alter the reviewed subagent runner.
unset NODE_OPTIONS
exec "$@"
