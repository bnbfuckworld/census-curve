# 第一册字节码复现 / Reproducing Book 1 bytecode

第一册（QTA）部署时的 `src/Errors.sol` 还没有第二册新增的 7 个错误声明。这些声明不影响逻辑，但会改变元数据哈希。要逐字节复现第一册的 `CensusCurveFactory`，或在 BscScan 上验证第一册合约，先用本目录的 `Errors.sol` 替换 `src/Errors.sol`，只编译第一册的入口（第二册文件依赖新增的错误声明，替换后无法编译）。其余源文件与本仓库相同。

Book 1 (QTA) was deployed before Book 2 added seven error declarations to `src/Errors.sol`. They do not change logic but change the metadata hash. To reproduce Book 1's `CensusCurveFactory` byte for byte, or to verify Book 1 on BscScan, replace `src/Errors.sol` with the file in this folder and compile only the Book 1 entry point (Book 2 files need the new errors and will not compile with it). All other sources are identical.

```bash
cp verify/book1/Errors.sol src/Errors.sol
forge build src/CensusCurveFactory.sol   # 只编第一册 / Book 1 only
git checkout src/Errors.sol              # 还原 / restore
```

编出的 `bytecode` 与 `deploy/unsigned.json` 里的 `creationBytecode` 一致。第二册直接用当前源码编译，与 `deploy/unsigned-seat.json` 一致。

The resulting `bytecode` equals `creationBytecode` in `deploy/unsigned.json`. Book 2 compiles from the current sources and matches `deploy/unsigned-seat.json`.
