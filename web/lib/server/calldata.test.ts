import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, encodeFunctionData, hexToBytes, http } from "viem";
import { curveAbi } from "../abi";
import { bawPreviewCommand } from "../sign";

const AGENT = "0x8c3b6ED81CD80E9FB617e40B146709fb5d978309";
const DEPLOYER = "0x1E483aa1351B8C77a0328f34D949f0B396BBc883";
const CURVE = "0xa298EA6d338a923e452A84A77a584852cD37308B";
const RPCS = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.bnbchain.org",
  "https://1rpc.io/bnb",
];
const AMOUNT = 10n ** 18n;
const VALUE = 1_500_000_000_000_000n;
const NOT_AGENT = "0x0d9ab13f";

const data = encodeFunctionData({ abi: curveAbi, functionName: "mint", args: [AMOUNT] });

async function quoteMint(): Promise<bigint> {
  let last: unknown;
  for (const rpc of RPCS) {
    const client = createPublicClient({ transport: http(rpc, { timeout: 8_000, retryCount: 0 }) });
    try {
      return await client.readContract({
        address: CURVE,
        abi: curveAbi,
        functionName: "quoteMint",
        args: [AMOUNT],
      });
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error("all rpcs failed");
}

async function call(from: `0x${string}`, value: bigint) {
  let last: unknown;
  for (const rpc of RPCS) {
    const client = createPublicClient({ transport: http(rpc, { timeout: 8_000, retryCount: 0 }) });
    try {
      return await client.call({
        account: from,
        to: CURVE,
        data,
        value,
      });
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("0x0d9ab13f") || message.toLowerCase().includes("notagent")) {
        throw err;
      }
    }
  }
  throw last ?? new Error("all rpcs failed");
}

test("encoded 1 QTA mint calldata matches the published selector", () => {
  assert.equal(data, "0xa0712d680000000000000000000000000000000000000000000000000de0b6b3a7640000");
  assert.equal(hexToBytes(data).length, 36);
  assert.equal(
    bawPreviewCommand({ from: AGENT, to: CURVE, valueWei: VALUE.toString(), data }),
    `baw contract-call preview --binanceChainId 56 --from ${AGENT} --to ${CURVE} --value ${VALUE.toString()} --inputData ${data} --json`,
  );
});

test("eth_call mint(1e18) from the Agent ID wallet succeeds", async () => {
  const value = await quoteMint();
  assert.ok(value > 0n);
  const result = await call(AGENT, value);
  assert.ok(result);
});

test("eth_call mint(1e18) from the deploy wallet reverts NotAgent", async () => {
  const value = await quoteMint();
  await assert.rejects(call(DEPLOYER, value), (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes(NOT_AGENT) || message.toLowerCase().includes("notagent");
  });
});
