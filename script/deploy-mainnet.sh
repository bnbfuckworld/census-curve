#!/usr/bin/env bash
# Prepare the unsigned BSC deployment for 配额曲线第一册.
# This script never reads a private key and never broadcasts.
set -euo pipefail
set +x
set +o xtrace

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"
unset DEPLOYER_PRIVATE_KEY ETH_FROM

DEPLOYER="0x1E483aa1351B8C77a0328f34D949f0B396BBc883"
REGISTRY="0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"
NAME="配额曲线第一册"
SYMBOL="QTA"
OUT="${ROOT}/deploy/unsigned.json"

if [[ "${1:-}" == "--help" ]]; then
  echo "用法: script/deploy-mainnet.sh"
  echo "只写出 deploy/unsigned.json。不读私钥，不广播。"
  echo "签名在柜台的部署签：/curve/deploy/ 。工厂部署钱包是 ${DEPLOYER}；开册可由任何已持有 Agent ID 的钱包签名。"
  exit 0
fi
if [[ "${1:-}" == "--broadcast" || -n "${1:-}" ]]; then
  echo "这个脚本不广播，也不接受参数。签名在 /curve/deploy/ 完成。" >&2
  exit 1
fi

if ! forge build --skip test >/tmp/census-curve-build.log 2>&1; then
  echo "编译失败。没有写出待签交易，也没有广播。" >&2
  cat /tmp/census-curve-build.log >&2
  exit 1
fi

CREATION=$(forge inspect src/CensusCurveFactory.sol:CensusCurveFactory bytecode)
RUNTIME=$(forge inspect src/CensusCurveFactory.sol:CensusCurveFactory deployedBytecode)
CALLDATA=$(cast calldata "create(string,string)" "${NAME}" "${SYMBOL}")

python3 - "${OUT}" "${DEPLOYER}" "${REGISTRY}" "${NAME}" "${SYMBOL}" "${CREATION}" "${RUNTIME}" "${CALLDATA}" <<'PY'
import json, pathlib, sys
out, deployer, registry, name, symbol, creation, runtime, calldata = sys.argv[1:]
for label, value in (("creation", creation), ("runtime", runtime), ("calldata", calldata)):
    if not value.startswith("0x") or len(value) < 10:
        raise SystemExit(f"{label} 不是字节码")
doc = {
    "chainId": 56,
    "from": deployer,
    "registry": registry,
    "registrySource": "https://docs.space.id/agent-id",
    "sourcify": "https://repo.sourcify.dev/56/0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
    "name": name,
    "symbol": symbol,
    "creationBytecode": creation,
    "deployedBytecode": runtime,
    "createCalldata": calldata,
    "checks": [
        "工厂已在 BNB 主网部署。部署交易的 from 是 0x1E483aa1351B8C77a0328f34D949f0B396BBc883。",
        "开册可由任何已持有 Agent ID 的钱包签名，调用 create(\"配额曲线第一册\", \"QTA\")。资格只认链上付款人，不限定某一个地址。",
        "曲线 agent() 等于官方 Agent ID 注册表 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F。来源：SPACE ID 文档 https://docs.space.id/agent-id ，BNB Chain 主网 chainId 56，集合名 SPACE ID Agent ID，符号 AI。",
        "曲线 slope、base、quota0 分别是 1e15、1e15、100 ether。工厂没有 owner，没有暂停，也没有调参函数。",
        "代币上的 factory、curve、pool 与 markets(0) 一致。",
    ],
}
path = pathlib.Path(out)
path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
PY

echo "待签交易已写入 deploy/unsigned.json。没有广播，book.json 没有改。"
echo "部署钱包: ${DEPLOYER}"
echo "链号: 56"
echo "注册表: ${REGISTRY}"
echo "开册: create(\"${NAME}\", \"${SYMBOL}\")"
echo "签名步骤:"
echo "  1. 打开柜台 /curve/deploy/ 。工厂若已在 book.json 里记下，页面会显示已完成。"
echo "  2. 开册用任何已持有 Agent ID 的钱包连接，链号 56，再签 create(\"${NAME}\", \"${SYMBOL}\")。页面不代签。"
echo "  3. 开册成功后，页面会向链上核对再写入 book.json。"
echo "核对:"
echo "  - 曲线 agent() 指向 ${REGISTRY}（https://docs.space.id/agent-id）。"
echo "  - slope = 1e15，base = 1e15，quota0 = 100 ether。"
echo "  - 工厂没有 owner。部署交易的 from 是 ${DEPLOYER}。开册不限定这一个地址。"
