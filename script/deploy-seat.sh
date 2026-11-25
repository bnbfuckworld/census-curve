#!/usr/bin/env bash
# Prepare the unsigned BSC deployment for 配额曲线第二册.
# This script never reads a private key and never broadcasts.
set -euo pipefail
set +x
set +o xtrace

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"
unset DEPLOYER_PRIVATE_KEY ETH_FROM PRIVATE_KEY

DEPLOYER="0x1E483aa1351B8C77a0328f34D949f0B396BBc883"
REGISTRY="0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"
NAME="配额曲线第二册"
SYMBOL="QTB"
OUT="${ROOT}/deploy/unsigned-seat.json"

if [[ "${1:-}" == "--help" ]]; then
  echo "用法: script/deploy-seat.sh"
  echo "只写出 deploy/unsigned-seat.json。不读私钥，不广播，不改 deploy/seat.json。"
  echo "工厂部署钱包可以是 ${DEPLOYER}。开册必须由当时持有 Agent ID 的钱包自己签。"
  exit 0
fi
if [[ "${1:-}" == "--broadcast" || -n "${1:-}" ]]; then
  echo "这个脚本不广播，也不接受参数。主网签名等明确点头之后再做。" >&2
  exit 1
fi

if ! forge build --skip test >/tmp/census-seat-build.log 2>&1; then
  echo "编译失败。没有写出待签交易，也没有广播。" >&2
  cat /tmp/census-seat-build.log >&2
  exit 1
fi

CREATION=$(forge inspect src/TurnSeatFactory.sol:TurnSeatFactory bytecode)
RUNTIME=$(forge inspect src/TurnSeatFactory.sol:TurnSeatFactory deployedBytecode)
CALLDATA=$(cast calldata "create(string,string)" "${NAME}" "${SYMBOL}")

python3 - "${OUT}" "${DEPLOYER}" "${REGISTRY}" "${NAME}" "${SYMBOL}" "${CREATION}" "${RUNTIME}" "${CALLDATA}" <<'PY'
import json, pathlib, sys
out, deployer, registry, name, symbol, creation, runtime, calldata = sys.argv[1:]
for label, value in (("creation", creation), ("runtime", runtime), ("calldata", calldata)):
    if not value.startswith("0x") or len(value) < 10:
        raise SystemExit(f"{label} 不是字节码")
doc = {
    "chainId": 56,
    "factoryDeployer": deployer,
    "registry": registry,
    "registrySource": "https://docs.space.id/agent-id",
    "name": name,
    "symbol": symbol,
    "creationBytecode": creation,
    "deployedBytecode": runtime,
    "createCalldata": calldata,
    "notes": [
        "第一笔只部署工厂，不需要 Agent ID。建议 from 为 " + deployer + "。",
        "第二笔调用 create，from 必须是当时持有 Agent ID 的地址。没有 Agent ID 的部署钱包签不了这一笔。",
        "不要部署 test/harness 里的工厂。那份字节码没有锁链号。",
        "本文件不是广播。不要把私钥写进命令行。",
    ],
    "checks": [
        "工厂构造要求 chainid == 56，AGENT() 等于 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F。",
        "席位册 WINDOW_BLOCKS = 160，GUARD_BLOCKS = 16，CAP = 100，BASE = SLOPE = 1e15。",
        "池子 BASE_FEE_BPS = 30，MAX_FEE_BPS = 100。流动性按份额取出。",
        "工厂、席位册、池、代币都没有 owner，没有暂停，没有改参，没有管理员提款。",
        "开册成功后，把工厂、代币、席位册、池的地址写入 deploy/seat.json，再让柜台读链。",
    ],
}
path = pathlib.Path(out)
path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
PY

echo "待签交易已写入 deploy/unsigned-seat.json。没有广播，seat.json 没有改。"
echo "工厂部署钱包: ${DEPLOYER}（这一笔不需要 Agent ID）"
echo "开册: create(\"${NAME}\", \"${SYMBOL}\")，必须由持有 Agent ID 的地址自己签"
echo "链号: 56"
echo "注册表: ${REGISTRY}"
echo "主网步骤要等明确点头。本脚本到写出待签交易为止。"
