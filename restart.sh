#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node 22+ and retry." >&2
  exit 1
fi

echo "Stopping any leftover Workforce dev processes..."
node tooling/scripts/stop-desktop.mjs

exec node tooling/scripts/start-desktop.mjs "$@"
