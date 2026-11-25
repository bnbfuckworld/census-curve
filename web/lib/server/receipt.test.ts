import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, type Hex } from "viem";
import { failure } from "../copy";
import { checkReceipt, type ReceiptRpc } from "./receipt";

const CURVE = getAddress("0xa298EA6d338a923e452A84A77a584852cD37308B");
const POOL = getAddress("0x586AfadF10f101B8C7E2Fc0eee33103EC649f418");
const OTHER = getAddress("0x1111111111111111111111111111111111111111");
const AGENT = getAddress("0x8c3b6ED81CD80E9FB617e40B146709fb5d978309");
const HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;

function client(receipt: unknown, remaining = 99n * 10n ** 18n): ReceiptRpc {
  return {
    getChainId: async () => 56,
    getTransactionReceipt: async () => receipt as never,
    readContract: async ({ functionName }) => {
      if (functionName === "remaining") return remaining;
      if (functionName === "mintedOf") return 10n ** 18n;
      throw new Error(`unexpected ${String(functionName)}`);
    },
  };
}

test("receipt check rejects a bad hash", async () => {
  const result = await checkReceipt({ hash: "0x123" }, { client: client(null) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "bad-hash");
});

test("receipt check waits when the receipt is missing", async () => {
  const result = await checkReceipt({ hash: HASH }, { client: client(null) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "no-receipt");
});

test("receipt check refuses a reverted transaction", async () => {
  const result = await checkReceipt(
    { hash: HASH },
    {
      client: client({
        status: "reverted",
        to: CURVE,
        from: AGENT,
        logs: [],
      }),
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "receipt-fail");
});

test("receipt check refuses a transaction sent to another contract", async () => {
  const result = await checkReceipt(
    { hash: HASH },
    {
      client: client({
        status: "success",
        to: OTHER,
        from: AGENT,
        logs: [],
      }),
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "wrong-to");
  assert.equal(failure("wrong-to").title.includes("本册合约"), true);
});

test("receipt check reports remaining quota after a successful curve payment", async () => {
  const left = 99n * 10n ** 18n;
  const result = await checkReceipt(
    { hash: HASH, account: AGENT },
    {
      client: client(
        {
          status: "success",
          to: CURVE,
          from: AGENT,
          logs: [],
        },
        left,
      ),
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.to, CURVE);
  assert.equal(result.from, AGENT);
  assert.equal(result.action, "mint");
  assert.equal(result.remaining, left.toString());
  assert.match(result.body, /剩余铸额/);
  assert.equal(result.scan, `https://bscscan.com/tx/${HASH}`);
});

test("receipt check accepts a successful pool payment", async () => {
  const result = await checkReceipt(
    { hash: HASH },
    {
      client: client({
        status: "success",
        to: POOL,
        from: AGENT,
        logs: [],
      }),
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "swap");
  assert.equal(result.to, POOL);
});
