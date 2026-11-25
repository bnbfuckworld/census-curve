# 身份配额曲线

给代理用的操作说明。网页连上普通插件钱包，不等于 Agent 登录。链上只认本笔交易的 `msg.sender` 是否持有 Agent ID。

册页地址在 `deploy/book.json`。地址空着时，只准备给人看的预览，不要执行，不要向币安链广播。`script/deploy-mainnet.sh` 默认不广播。

产品柜台是 `script/serve-curve.sh`，页面在 `/curve/`。开发演练是 `script/rehearse-local.sh`，只连接 `127.0.0.1:18545`，上面的地址不能写进发往币安链的 `--to`。用户只在币安 App 里确认。网页连上普通插件钱包 ≠ Agent 登录。

## 先看资格，再谈交易

- 链：BNB Smart Chain，`binanceChainId` 用 `56`。
- 注册表：`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`。`balanceOf(account) > 0` 且 `handleOf` 非空才算持有。
- 不要对零地址调用 `balanceOf`。
- 不要代领 Agent ID，不要索取私钥，不要使用官方标识。
- 领取只能在币安 App 内完成。

配对如果要做人：

1. `baw auth signin --json`
2. 把返回的 `urlForWeb` 原样交给用户，用新窗口打开。不要改 URL，不要放进 iframe，不要改成 WalletConnect。
3. 原样展示 `pairingCode`。
4. `baw auth verify --qrCodeId <id> --json` 必须跑到返回。过期就重新 `signin`，不要用旧 id 重试。

## 开发者模式

只要下一步是 `contract-call`，先跑：

```bash
baw wallet settings --json
```

`devMode.enabled` 不是真，或 `devMode.expiresAt` 已过，就停。告诉用户去币安 App：Agentic Wallet 管理页 → 设置 → 开发者模式。本命令行不能替他打开。用户说开好了之后再查一次设置。

## 预览，然后等人确认

1. 只读报价。铸造看曲线的 `quoteMint(uint256)`，卖回看 `quoteSell(uint256)`，池子看 `quoteSwap(bool,uint256)`。同时看 `remaining(address)`。额度用尽时不要再组 `mint`。
2. 把枚数、BNB wei、最小成交量和动作讲给用户。
3. 组 calldata 后预览，不要自己执行：

```bash
baw contract-call preview \
  --binanceChainId 56 \
  --from "$AGENT_WALLET" \
  --to "$TARGET" \
  --value "$WEI" \
  --inputData "$CALLDATA" \
  --json
```

4. 展示 `parsedTx`、`risks`、`authorityChanges`。用户用明确的话同意之后，才能 `baw contract-call execute --requestId <本次 preview 的 id> --json`。
5. preview 失败、被拦截、没有 `requestId`：不要执行。
6. 返回 `PENDING_CONFIRMATION`：停住，等人在币安 App 里确认。不要再发一笔。
7. preview 过期：重新 preview。不要复用旧 `requestId`。

不要传 gas 价格。不要把「连接插件钱包再调用 mint」当成主路径。

## 写函数

| 动作 | 目标 | calldata | value |
| --- | --- | --- | --- |
| 铸造 | 曲线 | `mint(uint256)` | `quoteMint` 的 wei。多付会退回 |
| 卖回曲线 | 曲线 | `sell(uint256)` | `0` |
| 用 BNB 买池中的币 | 池 | `swap(bool,uint256,uint256)`，第一个参数 `false` | 等于 `amountIn` |
| 把币卖进池 | 池 | `swap(true, amountIn, minOut)` | `0`。先让用户 `approve(池, amount)` |
| 加流动性 | 池 | `addLiquidity(uint256,uint256)` | 配对 BNB。先 `approve` |
| 撤流动性 | 池 | `removeLiquidity(uint256,uint256,uint256)` | `0` |

`minOut` 用报价减去用户接受的滑点。不要为了省事传 0。

卖回曲线不需要 `approve`。不要去调用代币的 `burn`，那会回滚。

## 不要做的事

- 不要实现或调用铸币订单簿、统一价拍卖、拆分二元。
- 不要假设登录会话已经付过款或已经有额度。
- 不要在用户失去 Agent ID 之后找一条公共提款路径。卖出和撤流动性都会回滚，资金留在合约里。
