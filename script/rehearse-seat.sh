#!/usr/bin/env bash
# Deploy book 2 onto a local anvil fork. Loopback only. No keys. No public broadcast.
set -euo pipefail
set +x
set +o xtrace

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"
unset DEPLOYER_PRIVATE_KEY ETH_FROM PRIVATE_KEY

RPC="${1:-http://127.0.0.1:18545}"
HOLDER="0x8c3b6ED81CD80E9FB617e40B146709fb5d978309"
REGISTRY="0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"
OUT="${ROOT}/deploy/seat.local.json"

case "$RPC" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "只连接本机分叉，拒绝 ${RPC}。" >&2
    exit 1
    ;;
esac
if [[ "${2:-}" == "--broadcast" || -n "${2:-}" ]]; then
  echo "这个脚本不接受额外参数，也不向公网广播。" >&2
  exit 1
fi

CHAIN=$(cast chain-id --rpc-url "$RPC")
if [[ "$CHAIN" != "56" ]]; then
  echo "本机节点链号是 ${CHAIN}，第二册工厂只在 56 上构造。" >&2
  exit 1
fi

cast rpc anvil_impersonateAccount "$HOLDER" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$HOLDER" 0x3635C9ADC5DEA00000 --rpc-url "$RPC" >/dev/null

BYTECODE=$(forge inspect src/TurnSeatFactory.sol:TurnSeatFactory bytecode)
FACTORY=$(cast send --unlocked --from "$HOLDER" --rpc-url "$RPC" --gas-limit 6000000 --legacy --json --create "$BYTECODE" | python3 -c '
import json, sys
doc = json.load(sys.stdin)
data = doc.get("data") if isinstance(doc.get("data"), dict) else {}
addr = doc.get("contractAddress") or data.get("contractAddress") or data.get("contract_address") or ""
if not addr:
    raise SystemExit("no contractAddress: " + json.dumps(doc)[:800])
print(addr)
')
cast send --unlocked --from "$HOLDER" --rpc-url "$RPC" --gas-limit 8000000 --legacy "$FACTORY" "create(string,string)" "配额曲线第二册" "QTB" >/dev/null
MARKETS=$(cast call "$FACTORY" "markets(uint256)(address,address,address)" 0 --rpc-url "$RPC")

python3 - "$OUT" "$RPC" "$REGISTRY" "$FACTORY" "$MARKETS" <<'PY'
import json, pathlib, re, sys
out, rpc, registry, factory, markets = sys.argv[1:]
found = re.findall(r"0x[0-9a-fA-F]{40}", markets)
if len(found) != 3:
    raise SystemExit(f"markets 没有三个地址: {markets!r}")
token, book, pool = found
doc = {
    "network": "rehearsal",
    "rpc": rpc.rstrip("/"),
    "chainId": 56,
    "registry": registry,
    "factory": factory,
    "token": token,
    "book": book,
    "pool": pool,
    "name": "配额曲线第二册",
    "symbol": "QTB",
}
path = pathlib.Path(out)
path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
PY

python3 - "$OUT" <<'PY'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text())
print("本地分叉上的第二册写在 deploy/seat.local.json。没有改 deploy/seat.json，没有碰私钥。")
print("工厂", doc["factory"])
print("代币", doc["token"])
print("席位册", doc["book"])
print("池", doc["pool"])
print("柜台要读这份文件时：CENSUS_SEAT=" + sys.argv[1])
PY
