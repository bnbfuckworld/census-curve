#!/usr/bin/env bash
# Foreground starter for systemd. No tmux. No anvil.
# The desk listens on 127.0.0.1:43123 and reads deploy/book.json.
# That file points at BSC. Empty addresses stay on the desk as an unopened book.
# Fill token/curve/pool after the book is created on chain; this script never broadcasts.
#
# Put any reverse proxy in front of 127.0.0.1:43123 and keep the /curve
# prefix (no trailing slash after the upstream address), because Next
# serves everything under basePath /curve.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
unset ETH_RPC_URL ETH_FROM DEPLOYER_PRIVATE_KEY
export CENSUS_BOOK="${ROOT}/deploy/book.json"

WEB_PORT=43123
PID_DIR="${ROOT}/web/.local"
SERVE_PID="${PID_DIR}/serve.pid"

if [[ "${1:-}" == "--help" ]]; then
  echo "用法: script/serve-curve.sh"
  echo "前台运行。不拉起 anvil。柜台只绑 127.0.0.1:${WEB_PORT}。"
  echo "册页是 deploy/book.json。公开路径由 nginx 挂到 /curve/。"
  echo "部署用 script/deploy-mainnet.sh，默认不广播。"
  exit 0
fi
if [[ -n "${1:-}" ]]; then
  echo "这个启动脚本不接受参数，也不会拉起本机链。" >&2
  exit 1
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "需要 Node 和 npm。" >&2
  exit 1
fi

port_hex=$(printf '%04X' "${WEB_PORT}")
if awk -v suffix=":${port_hex}" 'NR>1 && $4=="0A" && substr($2, length($2)-4)==suffix { found=1 } END { exit !found }' /proc/net/tcp /proc/net/tcp6 2>/dev/null; then
  echo "127.0.0.1:${WEB_PORT} 已被占用。先停掉旧柜台，再启动。" >&2
  exit 1
fi

if [[ ! -d "${ROOT}/web/node_modules" ]]; then
  npm ci --prefix "${ROOT}/web"
fi

npm run build --prefix "${ROOT}/web"

mkdir -p "${PID_DIR}"
echo $$ >"${SERVE_PID}"
trap 'rm -f "${SERVE_PID}"' EXIT INT TERM

cd "${ROOT}/web"
npx next start -H 127.0.0.1 -p "${WEB_PORT}"
