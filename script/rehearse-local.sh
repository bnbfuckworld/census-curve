#!/usr/bin/env bash
# Local rehearsal only. Refuses any RPC other than 127.0.0.1:18545.
# Deploys the release factory onto a loopback chain whose id is 56, and
# places the test registry stand-in at the hard-coded Agent ID address so
# that factory can be called. This is not mainnet, not a testnet, and not
# a release of the harness.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

export PATH="${HOME}/.foundry/bin:${PATH}"
unset ETH_RPC_URL ETH_FROM

RPC="http://127.0.0.1:18545"
PORT=18545
CHAIN_ID=56
REGISTRY="0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"
LIN="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
BLANK="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
NONE="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
BROKE="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
LOCAL_DIR="${ROOT}/web/.local"
DESK="${LOCAL_DIR}/desk.json"
PIDFILE="${LOCAL_DIR}/anvil.pid"
ANVIL_LOG="${LOCAL_DIR}/anvil.log"

if [[ "${1:-}" == "--help" ]]; then
  echo "用法: script/rehearse-local.sh [--fresh]"
  echo "只连接 ${RPC}。不会向主网或测试网广播。anvil 只绑 127.0.0.1。"
  exit 0
fi

chain_id() {
  cast chain-id --rpc-url "${RPC}" 2>/dev/null || true
}

port_open() {
  [[ "$(chain_id)" != "" ]]
}

listen_rows() {
  local port_hex
  port_hex=$(printf '%04X' "$1")
  awk -v suffix=":${port_hex}" 'NR>1 && $4=="0A" && substr($2, length($2)-4)==suffix { print $2 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null || true
}

assert_loopback() {
  local rows row ip
  rows=$(listen_rows "${PORT}")
  if [[ -z "${rows}" ]]; then
    return 0
  fi
  while read -r row; do
    [[ -z "${row}" ]] && continue
    ip=${row%%:*}
    if [[ "${ip}" != "0100007F" ]]; then
      echo "端口 ${PORT} 不是只绑在 127.0.0.1。拒绝使用，不会改它。" >&2
      exit 1
    fi
  done <<<"${rows}"
}

stop_recorded_anvil() {
  if [[ ! -f "${PIDFILE}" ]]; then
    return 0
  fi
  local pid
  pid=$(tr -cd '0-9' <"${PIDFILE}")
  if [[ -n "${pid}" ]] && [[ -d "/proc/${pid}" ]]; then
    kill "${pid}" 2>/dev/null || true
    for _ in $(seq 1 20); do
      if [[ ! -d "/proc/${pid}" ]]; then
        break
      fi
      sleep 0.1
    done
  fi
  rm -f "${PIDFILE}"
}

start_anvil() {
  mkdir -p "${LOCAL_DIR}"
  nohup anvil --host 127.0.0.1 --port "${PORT}" --chain-id "${CHAIN_ID}" --hardfork shanghai --quiet \
    >>"${ANVIL_LOG}" 2>&1 &
  echo $! >"${PIDFILE}"
  for _ in $(seq 1 50); do
    if [[ "$(chain_id)" == "${CHAIN_ID}" ]]; then
      assert_loopback
      return 0
    fi
    sleep 0.1
  done
  echo "本机链没有在 ${RPC} 上以链号 56 起来。" >&2
  exit 1
}

if [[ "${1:-}" == "--fresh" ]]; then
  stop_recorded_anvil
  rm -f "${DESK}"
  if port_open; then
    echo "127.0.0.1:${PORT} 仍被占用，而且不是本脚本记下的进程。没有动它。" >&2
    exit 1
  fi
fi

if port_open; then
  ID="$(chain_id)"
  if [[ "${ID}" != "${CHAIN_ID}" ]]; then
    echo "127.0.0.1:${PORT} 上的链号是 ${ID}，不是 56。本脚本拒绝使用。" >&2
    exit 1
  fi
  assert_loopback
else
  start_anvil
fi

if [[ -f "${DESK}" ]]; then
  EXISTING=$(python3 - "${DESK}" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))["factory"])
PY
)
  CODE=$(cast code "${EXISTING}" --rpc-url "${RPC}" 2>/dev/null || echo "0x")
  if [[ "${CODE}" != "0x" && "${CODE}" != "0x0" && -n "${CODE}" ]]; then
    echo "册页还在 ${EXISTING} 。要重开一本，加 --fresh。"
    exit 0
  fi
fi

echo "把注册表替身放到 ${REGISTRY}（只在本机链）。"
CODEX=$(forge inspect test/harness/MockAgentId.sol:MockAgentId deployedBytecode)
cast rpc anvil_setCode "${REGISTRY}" "${CODEX}" --rpc-url "${RPC}" >/dev/null

cast send "${REGISTRY}" "setAgent(address,uint256,string)" "${LIN}" 1 "lin" \
  --unlocked --from "${LIN}" --rpc-url "${RPC}" >/dev/null
# Empty string is the handle. Cast keeps it when passed as its own argument.
cast send "${REGISTRY}" "setAgent(address,uint256,string)" "${BLANK}" 1 "" \
  --unlocked --from "${LIN}" --rpc-url "${RPC}" >/dev/null
cast send "${REGISTRY}" "setAgent(address,uint256,string)" "${BROKE}" 1 "pin" \
  --unlocked --from "${LIN}" --rpc-url "${RPC}" >/dev/null
cast rpc anvil_setBalance "${BROKE}" 0x0 --rpc-url "${RPC}" >/dev/null

echo "部署发布工厂（链号 56，本机回环）。"
CREATE_OUT=$(forge create src/CensusCurveFactory.sol:CensusCurveFactory \
  --rpc-url "${RPC}" \
  --unlocked \
  --from "${LIN}" \
  --broadcast)
FACTORY=$(printf '%s\n' "${CREATE_OUT}" | awk '/Deployed to:/ {print $3}')
if [[ -z "${FACTORY}" ]]; then
  echo "工厂没有部署成功。" >&2
  printf '%s\n' "${CREATE_OUT}" >&2
  exit 1
fi

echo "开册。"
SEND_JSON=$(cast send "${FACTORY}" "create(string,string)" "配额曲线第一册" "QTA" \
  --unlocked --from "${LIN}" --rpc-url "${RPC}" --json)
CREATE_TX=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])' <<<"${SEND_JSON}")
MARKETS=$(cast call "${FACTORY}" "markets(uint256)(address,address,address)" 0 --rpc-url "${RPC}")

mkdir -p "${LOCAL_DIR}"
python3 - "${DESK}" "${FACTORY}" "${CREATE_TX}" "${REGISTRY}" "${RPC}" "${LIN}" "${BLANK}" "${NONE}" "${BROKE}" <<PY
import json, pathlib, sys
desk, factory, create_tx, registry, rpc, lin, blank, none, broke = sys.argv[1:]
markets = """${MARKETS}""".replace("(", " ").replace(")", " ").replace(",", " ").split()
if len(markets) < 3:
    raise SystemExit("markets() 没有返回三个地址: " + markets.__repr__())
doc = {
    "network": "rehearsal",
    "rpc": rpc,
    "chainId": 56,
    "registry": registry,
    "factory": factory,
    "token": markets[0],
    "curve": markets[1],
    "pool": markets[2],
    "name": "配额曲线第一册",
    "symbol": "QTA",
    "createTx": create_tx,
    "identities": [
        {"id": "lin", "title": "林", "address": lin},
        {"id": "blank", "title": "空句柄", "address": blank},
        {"id": "none", "title": "无证", "address": none},
        {"id": "broke", "title": "无气费", "address": broke},
    ],
}
path = pathlib.Path(desk)
path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
PY

echo "演练册页已写好：web/.local/desk.json。这不是产品启动路径。"
echo "回环只在 127.0.0.1:${PORT}。产品柜台用 script/serve-curve.sh，读 deploy/book.json。"
