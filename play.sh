#!/usr/bin/env bash
# Product entry. Foreground. No anvil, no broadcast.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
exec "${ROOT}/script/serve-curve.sh" "$@"
