# 身份配额曲线 · Census Curve

基于 Agent ID 的 BNB Chain 发行协议，按出块分轮定价，带 V4 Hook 机制。

An Agent ID–based token issuance protocol on BNB Chain, priced in block-height rounds, with a V4-style hook mechanism.

- 网站 / Website：https://censuscurve.top/curve/
- 链 / Chain：BNB Smart Chain 主网 / mainnet（`chainId` 56）
- Agent ID 注册表 / registry：`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`（SPACE ID Agent ID，符号 `AI`）

#BinanceWalletHackathon

## 中文

### 两册

- **第一册（QTA，页面 `/curve/`）**：每个 Agent 有一份只减不增的铸额，按线性曲线积分定价；超额需求在恒定乘积池里交易。没有 Agent ID 的地址，铸造、卖出、兑换和转账都会回滚。
- **第二册（QTB，页面 `/curve/seat/`）**：每 160 块一个窗口，每个窗口只成交一个 Agent ID；开册后前 16 块不能入席；每个 Agent ID 整册只能入席一次，每次铸 1 整枚，上限 100 席。窗口内价格从 2 倍地板线性降到地板，高出地板的部分打进死地址，卖回不退。节拍只用区块高度。
- **Hook**：第二册的池子是项目自写的恒定乘积池，不是 Uniswap v4 或 PancakeSwap Infinity 池。它在每笔交换前执行 v4 `beforeSwap` 语义的费率逻辑：基础 30 bps，同一块内成交越多费率越高，上限 100 bps；本窗口席位本人免这段拥挤费。手续费留在储备里。

资格判定：注册表 `balanceOf(address) > 0`，且不会对零地址调用 `balanceOf`。Agent ID 只能在币安 App 内领取，本项目不代领，也不是该名称的发行方。

### 主网合约地址

第一册（配额曲线第一册，QTA）：

| 合约 | 地址 |
| --- | --- |
| Registry（Agent ID） | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |
| Factory | `0x08A7FB944d16a9f8cb7031e0D756d7B5Be13B87c` |
| Token（QTA） | `0x69043d39ad5D8F2Bb5Bc16b913B0526E444bdB18` |
| Curve | `0xa298EA6d338a923e452A84A77a584852cD37308B` |
| Pool | `0x586AfadF10f101B8C7E2Fc0eee33103EC649f418` |

第二册（配额曲线第二册，QTB）：

| 合约 | 地址 |
| --- | --- |
| Factory | `0x5E9A8861B911b24E1f1AD4D7ABDbcd54e78d5b2c` |
| Book | `0xD71334E71f43b6d0be110CAA96857d9277E8c6F5` |
| Token（QTB） | `0x9B8e9ec9406c21D7E30a5eFC721A595c546F2E3c` |
| Pool | `0x407EbF4D25946086F0d2a88D56be0F6f6E387f8b` |

地址记录在 [deploy/book.json](deploy/book.json) 与 [deploy/seat.json](deploy/seat.json)。

### 权限披露

- 工厂、曲线、席位册、池和代币都没有 owner。
- 没有暂停开关，没有调参 setter，没有升级入口。
- 没有管理员提现函数，没有金库。池子手续费留在储备里，只随流动性份额取出。
- 开册不限定签名地址，只认付款人当时持有 Agent ID。

### 网站与钱包

- 网站不收配对码，不做扫码登录，服务端不保存会话。
- 网页连上普通插件钱包，不等于 Agent 登录；交易由用户在自己的钱包里确认。页面不索取私钥或助记词。
- 本项目不承诺任何收益。

### 本地构建与测试

需要 [Foundry](https://book.getfoundry.sh/getting-started/installation) 和 Node.js 22+。

```bash
# 合约
forge install foundry-rs/forge-std@v1.17.0 --no-git   # 或 --no-commit
forge build
forge test -vv

# 网页
npm ci --prefix web
npm run test:states --prefix web
npm run typecheck --prefix web
npm run build --prefix web

# 本地启动（只听 127.0.0.1:43123，页面 /curve/，不广播）
./script/serve-curve.sh
```

`script/deploy-mainnet.sh` 与 `script/deploy-seat.sh` 只生成待签交易（`deploy/unsigned*.json`），不读私钥，不广播，传入 `--broadcast` 会被拒绝。不要部署 `test/harness` 下的合约。

编译参数（见 `foundry.toml`）：solc `0.8.26`，optimizer 开启，runs `200`，EVM `shanghai`。第一册的逐字节复现见 [verify/book1](verify/book1/README.md)。

### 目录

```
src/        合约（第一册 CensusCurve*、第二册 TurnSeat*、共用 AgentGate/CurveMath/MulDiv/Errors）
test/       Foundry 测试与测试替身（harness 不可部署）
script/     本地启动、演练、生成待签交易的脚本
web/        Next.js 前端与只读 API
deploy/     主网地址记录与待签交易（含创建字节码）
verify/     第一册字节码复现说明
docs/       机制说明
skills/     给 Agent 用的操作说明
```

## English

### Two books

- **Book 1 (QTA, `/curve/`)**: each Agent holds a mint quota that only decreases, priced along a linear curve integral; demand beyond the quota trades in a constant-product pool. Minting, selling, swapping and transfers revert for addresses without an Agent ID.
- **Book 2 (QTB, `/curve/seat/`)**: one 160-block window per round, one Agent ID per window; no seats in the first 16 blocks after creation; each Agent ID can take one seat per book, minting exactly 1 token, capped at 100 seats. Within a window the price falls linearly from 2× floor to the floor; the amount above the floor is sent to the dead address and is not refunded on sell. Timing uses block height only.
- **Hook**: Book 2's pool is a self-written constant-product pool, not a Uniswap v4 or PancakeSwap Infinity pool. Before every swap it runs fee logic with v4 `beforeSwap` semantics: 30 bps base, rising with the number of swaps in the same block, capped at 100 bps; the current window's seat holder is exempt from the congestion part. Fees stay in the reserves.

Eligibility: `balanceOf(address) > 0` on the registry; `balanceOf` is never called for the zero address. Agent IDs can only be claimed inside the Binance app; this project does not claim them on anyone's behalf and is not the issuer of that name.

### Mainnet addresses

See the tables in the Chinese section above (Book 1: Registry, Factory, Token, Curve, Pool; Book 2: Factory, Book, Token, Pool). They are also recorded in `deploy/book.json` and `deploy/seat.json`.

### Permissions

- No owner on the factories, curve, seat book, pools or tokens.
- No pause, no parameter setters, no upgrade path.
- No admin withdrawal and no treasury. Pool fees stay in reserves and leave only with LP shares.
- Opening a book is not restricted to any signer; it only requires the payer to hold an Agent ID at that moment.

### Website and wallets

- The website does not collect pairing codes, has no QR-code login, and the server keeps no sessions.
- Connecting a browser wallet is not an Agent login; users confirm transactions in their own wallet. The site never asks for a private key or seed phrase.
- No returns are promised.

### Build and test

Requires Foundry and Node.js 22+. Run the commands in the Chinese section above: `forge install foundry-rs/forge-std@v1.17.0`, `forge build`, `forge test -vv`, then `npm ci`, `npm run test:states`, `npm run typecheck` and `npm run build` with `--prefix web`. `./script/serve-curve.sh` starts the site on `127.0.0.1:43123` under `/curve/` and never broadcasts.

Compiler settings (from `foundry.toml`): solc `0.8.26`, optimizer on, 200 runs, EVM `shanghai`. To reproduce Book 1 byte for byte, see [verify/book1](verify/book1/README.md).

## License

MIT, see [LICENSE](LICENSE).
