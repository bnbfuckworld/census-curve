# 两条入口

网页连上普通插件钱包，不等于 Agent 登录。

资格只在链上检查：调用者此刻对 `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` 的 `balanceOf > 0`，并且 `handleOf` 非空。会话、网页签名、WalletConnect 连接状态，都不能当成已经持有 Agent ID。没有 ID 的交易会回滚，合约不代领。

Agent ID 只能在币安 App 内领取。本项目不是该名称的发行方，不使用官方标识。

册页地址在 `deploy/book.json`。`script/deploy-mainnet.sh` 默认不广播；只有原样传入 `--broadcast` 才发送交易。产品柜台是 `script/serve-curve.sh`，不拉起 anvil。

开发演练：`script/rehearse-local.sh` 只连接 `127.0.0.1:18545`。那不是产品启动路径。官方配对和预览都不会代替币安 App 里的确认。网页连上普通插件钱包 ≠ Agent 登录。柜台不提供插件钱包连接。

下面是给人用和给代理用的入口。地址还空着时，不要在币安 App 里确认。

## 1. 人在币安 App 里确认

1. 在币安 App 里领取自己的 `.ai`。本项目不提供领取入口。
2. 打开 Agentic Wallet，进入管理页右上角的设置，打开开发者模式，并确认风险提示。开发者模式不能由本项目或命令行打开。
3. 配对必须用官方返回的 `urlForWeb`，原样使用，不要拼接、截断或改参数。用新窗口打开（`noopener,noreferrer`）。不要放进 iframe。不要用 WalletConnect 冒充这次官方配对。
4. 人核对配对码，在币安 App 里确认。确认之前，没有任何一笔铸造、卖出或兑换应该被发出。

站点如果以后要读链，只能做只读报价（`eth_call` / `cast call`）。签发仍在 App 里完成。

## 2. 给 AI 代理的入口

代理可以代为组装和预览交易，不能自行认定用户已经授权，也不能把「连接钱包再点铸造」当成主路径。操作清单在 `skills/census-curve/SKILL.md`。

顺序固定为：

1. `baw wallet settings --json`，确认 `devMode.enabled` 为真且未过期。否则先告诉用户去 App 里打开开发者模式，不要预览。
2. 用只读调用算出 `quoteMint`、`quoteSell` 或 `quoteSwap`。把枚数、BNB 数量和最小成交量给用户看。
3. `baw contract-call preview --binanceChainId 56 ... --json`。把解析结果、`risks` 和授权变化给用户看。
4. 用户明确同意之后，才可以用该次 preview 的 `requestId` 执行。需要 App 确认时，停在 `PENDING_CONFIRMATION`，等人在币安 App 里点。
5. preview 失败就不要执行。过期了就重新 preview，不要复用旧的 `requestId`。

链号是 `56`。价值单位是 wei，不是「0.1 BNB」这种十进制文字。

## 调用面

工厂部署之后会得到三个地址：代币、曲线、池。创建者只能传入名称和符号。

| 动作 | 合约 | 函数 | `value` |
| --- | --- | --- | --- |
| 按额度铸造 | 曲线 | `mint(uint256 amount)` | 等于 `quoteMint`，可以多付，多余退回 |
| 卖回曲线 | 曲线 | `sell(uint256 amount)` | 0 |
| 用 BNB 买池子里的币 | 池 | `swap(false, amountIn, minOut)` | 等于 `amountIn` |
| 把币卖进池子 | 池 | `swap(true, amountIn, minOut)` | 0，且先 `approve` 池子 |
| 加流动性 | 池 | `addLiquidity(tokenAmount, minLpOut)` | 配对的 BNB，且先 `approve` 池子 |
| 撤流动性 | 池 | `removeLiquidity(lpAmount, minToken, minBnb)` | 0 |

卖回曲线不需要授权：曲线销毁的是调用者自己的余额，不能销毁别人的。池子没有销毁权。

本地只读报价的例子（不会发交易）：

```bash
cast call "$CURVE" "quoteMint(uint256)(uint256)" "$AMOUNT"
cast call "$CURVE" "remaining(address)(uint256)" "$ACCOUNT"
cast call "$POOL" "quoteSwap(bool,uint256)(uint256)" false "$BNB_IN"
```

`minOut` 用报价减一点滑点，不要传 0。报价函数不检查 Agent ID；真正会回滚的是上表里的写函数。
