#!/bin/sh
set -eu

task_project_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
cd "$task_project_dir"

if ! command -v node >/dev/null 2>&1; then
    echo 'Node.js 24+ is required to load the YAML deployment configuration.' >&2
    exit 1
fi
if [ ! -f packages/configuration/build/compose.js ]; then
    echo 'Run pnpm install --frozen-lockfile first to build the configuration helper.' >&2
    exit 1
fi
exec node packages/configuration/build/compose.js "$@"
