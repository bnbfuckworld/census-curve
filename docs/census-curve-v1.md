# 身份配额曲线 v1

只实现了设计文档里的第 1 条。铸币订单簿、统一价拍卖、拆分二元都没有写。上一版保管、托管、分账、继任、罚没方案也没有写进来。

`script/deploy-mainnet.sh` 不广播，也不读取私钥；传入 `--broadcast` 会被拒绝。它只写出 `deploy/unsigned.json`。开册在 `/curve/deploy/` 上由持有 Agent ID 的钱包签名。`script/rehearse-local.sh` 只连接 `127.0.0.1:18545`，用来在开发时走完路径。产品启动是 `script/serve-curve.sh`。

## 本地跑通

需要 [Foundry](https://book.getfoundry.sh/getting-started/installation)。在仓库根目录：

```bash
forge test -vv
```

测试不访问网络。生产工厂在 `chainId != 56` 时构造函数直接回滚；测试把链号改到 56 之后，用 `vm.etch` 把 mock 的字节码放到写死的注册表地址上，仍然是本地调用。

开发演练用同一办法：`script/rehearse-local.sh` 在回环链上把替身代码放到注册表地址，再部署发布工厂。替身不是 SPACE ID 的现网合约。产品册页见 [desk.md](desk.md)。

## 合约

| 文件 | 作用 |
| --- | --- |
| `src/CensusCurveFactory.sol` | 发布字节码。写死 `chainId` 56、注册表、`SLOPE`、`BASE`、`QUOTA0`、`SCALE` |
| `src/CensusFactoryBase.sol` | `create(name, symbol)` 的部署顺序 |
| `src/CensusToken.sol` | 转移时双方都要是 Agent；唯一豁免是创建交易里写死的池 |
| `src/CensusCurve.sol` | `mint`、`sell`、额度与曲线储备 |
| `src/CensusPool.sol` | `swap`、`addLiquidity`、`removeLiquidity` |
| `src/AgentGate.sol` | 零地址先回滚，再读注册表 |
| `src/CurveMath.sol` | 曲线积分 |
| `src/MulDiv.sol` | 512 位中间积的向下取整乘法，溢出回滚 |
| `test/harness/` | mock 注册表和测试工厂。不要部署 |

`create` 的顺序是：部署代币、曲线、池，然后在同一笔交易里 `wire` 池地址。`wire` 只能由工厂调用一次。没有 owner、暂停、税率或升级函数。

## 写死的经济参数

注册表：`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `SLOPE` | `1e15` wei | 供给每增加 1 整枚，边际价增加 0.001 BNB |
| `BASE` | `1e15` wei | 供给为 0 时的边际价，0.001 BNB/枚 |
| `QUOTA0` | `100 ether` | 第一个 Agent 的铸额，100 枚 |
| `SCALE` | `100` | 第 `n` 个锁定额度的人得到 `quota0 * 100 / (100 + n)` |

第一个人铸满 100 枚的积分成本是 5.1 BNB。后来的人铸额更小，小到不足 1 wei 时初级发行停止。创建者和别人用同一公式，没有预留。

## 不变量

- 额度在第一次成功铸币时锁死。卖回曲线或在池子里卖掉都不减少 `mintedOf`，也不减少 `n`。
- `reserve == target(supply)`。卖回金额是两档 `target` 的差，因此不会超过曲线里的 BNB。全额卖回后 `reserve` 和合约余额都是 0。
- 代币 `totalSupply` 等于曲线 `supply`。曲线不持有代币，卖回时直接销毁。曲线地址不是豁免地址，不能把币转给曲线。
- 池子用存储的储备，不把别人直接转进来的币算进储备。0.3% 手续费留在储备里，变成 LP 份额的价值。没有单独的收款地址。
- LP 份额记在池子内部，不能转让。失去 Agent ID 之后不能撤出，资金留在池里。
- 写函数只认 `msg.sender`。`tx.origin` 是 Agent、调用合约不是 Agent 时，铸造回滚。

## 资格

`AgentGate` 先判断地址不是零，然后才 `balanceOf`。余额为 0 回滚 `NotAgent`。`handleOf` 为空回滚 `EmptyHandle`。注册表自己回滚时，整笔交易回滚。

失败交易会回滚 mock 的存储，所以「没有对零地址调用 `balanceOf`」由 Foundry 的 `expectCall(..., 0)` 断言。成功路径还会遍历 mock 记下的每一个参数。

本地报价函数（`quoteMint`、`quoteSell`、`quoteSwap`）不算资格。它们不读注册表。资格只出现在真正的 `mint`、`sell`、`swap`、`addLiquidity`、`removeLiquidity` 和转账里。
