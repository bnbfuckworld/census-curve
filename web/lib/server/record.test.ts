import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { BASE, QUOTA0, REGISTRY, SLOPE } from "../economics.ts";
import { MARKET_CREATED_EVENT, recordDeployment, type RecordRpc } from "./record.ts";

const FACTORY = getAddress("0x08A7FB944d16a9f8cb7031e0D756d7B5Be13B87c");
const TOKEN = getAddress("0x69043d39ad5D8F2Bb5Bc16b913B0526E444bdB18");
const CURVE = getAddress("0xa298EA6d338a923e452A84A77a584852cD37308B");
const POOL = getAddress("0x586AfadF10f101B8C7E2Fc0eee33103EC649f418");
const AGENT = getAddress("0x8c3b6ED81CD80E9FB617e40B146709fb5d978309");
const OTHER = getAddress("0x1E483aa1351B8C77a0328f34D949f0B396BBc883");
const CREATE_TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const OTHER_TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const BYTECODE = "0x6080604052";

const NAME = "配额曲线第一册";
const SYMBOL = "QTA";

function eventLog(factory: Address, creator: Address, token: Address, curve: Address, pool: Address) {
  const topics = encodeEventTopics({
    abi: [MARKET_CREATED_EVENT],
    eventName: "MarketCreated",
    args: { creator },
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "string" },
      { type: "string" },
    ],
    [token, curve, pool, NAME, SYMBOL],
  );
  return {
    address: factory,
    topics,
    data,
    blockHash: "0x" + "11".repeat(32),
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: CREATE_TX,
    transactionIndex: 0,
    removed: false,
  };
}

function receipt(overrides: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return {
    status: "success",
    from: AGENT,
    to: FACTORY,
    logs: [eventLog(FACTORY, AGENT, TOKEN, CURVE, POOL)],
    blockNumber: 1n,
    blockHash: "0x" + "11".repeat(32),
    transactionHash: CREATE_TX,
    transactionIndex: 0,
    contractAddress: null,
    cumulativeGasUsed: 1n,
    effectiveGasPrice: 1n,
    gasUsed: 1n,
    logsBloom: "0x",
    type: "legacy",
    blobGasUsed: undefined,
    blobGasPrice: undefined,
    root: undefined,
    ...overrides,
  } as TransactionReceipt;
}

function baseBook() {
  return {
    network: "bsc",
    rpc: "https://bsc-dataseed.bnbchain.org",
    chainId: 56,
    registry: REGISTRY,
    factory: FACTORY,
    token: "",
    curve: "",
    pool: "",
    name: NAME,
    symbol: SYMBOL,
    createTx: "",
    deployTx: "0x7222bf0af1ba4f25288e7dbcba7d9ba0f8ad2361cf8c6733da7c4f2adfe13a33",
  };
}

function setup(book = baseBook()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "census-record-"));
  const bookFile = path.join(dir, "book.json");
  const planFile = path.join(dir, "unsigned.json");
  fs.writeFileSync(bookFile, JSON.stringify(book, null, 2) + "\n");
  fs.writeFileSync(
    planFile,
    JSON.stringify({
      chainId: 56,
      registry: REGISTRY,
      deployedBytecode: BYTECODE,
      name: NAME,
      symbol: SYMBOL,
    }) + "\n",
  );
  return { dir, bookFile, planFile };
}

function mockRpc(opts: {
  chainId?: number;
  code?: string;
  receipt?: TransactionReceipt | null;
  balanceOf?: bigint;
  agent?: Address;
  slope?: bigint;
  base?: bigint;
  quota0?: bigint;
  wiredFactory?: Address;
  wiredCurve?: Address;
  wiredPool?: Address;
  calls?: string[];
}): RecordRpc {
  const calls = opts.calls ?? [];
  return {
    getChainId: async () => opts.chainId ?? 56,
    getBytecode: async () => (opts.code ?? BYTECODE) as Hex,
    getTransactionReceipt: async () => {
      calls.push("receipt");
      if (opts.receipt === null) throw new Error("not found");
      return opts.receipt ?? receipt();
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      switch (functionName) {
        case "balanceOf":
          return opts.balanceOf ?? 1n;
        case "agent":
          return opts.agent ?? (REGISTRY as Address);
        case "slope":
          return opts.slope ?? SLOPE;
        case "base":
          return opts.base ?? BASE;
        case "quota0":
          return opts.quota0 ?? QUOTA0;
        case "factory":
          return opts.wiredFactory ?? FACTORY;
        case "curve":
          return opts.wiredCurve ?? CURVE;
        case "pool":
          return opts.wiredPool ?? POOL;
        default:
          throw new Error(`unexpected ${functionName}`);
      }
    },
  } as RecordRpc;
}

function deps(files: { bookFile: string; planFile: string }, client: RecordRpc) {
  return { bookFile: files.bookFile, planFile: files.planFile, client };
}

test("missing createTx is rejected and the book is not written", async () => {
  const files = setup();
  const result = await recordDeployment({ factory: OTHER, deployTx: CREATE_TX }, deps(files, mockRpc({})));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "bad-json");
  const book = JSON.parse(fs.readFileSync(files.bookFile, "utf8"));
  assert.equal(book.createTx, "");
  assert.equal(book.token, "");
});

test("client-supplied factory is ignored; book factory is used", async () => {
  const files = setup();
  const result = await recordDeployment(
    { createTx: CREATE_TX, factory: OTHER },
    deps(files, mockRpc({})),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.factory, FACTORY);
    assert.equal(result.token, TOKEN);
    assert.equal(result.curve, CURVE);
    assert.equal(result.pool, POOL);
    assert.equal(result.createTx, CREATE_TX);
  }
  const book = JSON.parse(fs.readFileSync(files.bookFile, "utf8"));
  assert.equal(book.factory, FACTORY);
  assert.equal(book.token, TOKEN);
  assert.equal(book.deployTx, "0x7222bf0af1ba4f25288e7dbcba7d9ba0f8ad2361cf8c6733da7c4f2adfe13a33");
});

test("receipt to another address is rejected", async () => {
  const files = setup();
  const result = await recordDeployment(
    { createTx: CREATE_TX },
    deps(files, mockRpc({ receipt: receipt({ to: OTHER }) })),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "rejected");
  assert.equal(JSON.parse(fs.readFileSync(files.bookFile, "utf8")).createTx, "");
});

test("reverted receipt is not written", async () => {
  const files = setup();
  const result = await recordDeployment(
    { createTx: CREATE_TX },
    deps(files, mockRpc({ receipt: receipt({ status: "reverted" }) })),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "revert");
  assert.equal(JSON.parse(fs.readFileSync(files.bookFile, "utf8")).token, "");
});

test("sender without Agent ID is refused", async () => {
  const files = setup();
  const result = await recordDeployment(
    { createTx: CREATE_TX },
    deps(files, mockRpc({ balanceOf: 0n })),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "no-agent");
  assert.equal(JSON.parse(fs.readFileSync(files.bookFile, "utf8")).createTx, "");
});

test("a valid create fills token, curve, pool and createTx from the event", async () => {
  const files = setup();
  const result = await recordDeployment({ createTx: CREATE_TX }, deps(files, mockRpc({})));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.token, TOKEN);
    assert.equal(result.curve, CURVE);
    assert.equal(result.pool, POOL);
  }
  const book = JSON.parse(fs.readFileSync(files.bookFile, "utf8"));
  assert.equal(book.token, TOKEN);
  assert.equal(book.curve, CURVE);
  assert.equal(book.pool, POOL);
  assert.equal(book.createTx, CREATE_TX);
  assert.equal(book.factory, FACTORY);
});

test("recording the same createTx twice is idempotent and does not call RPC the second time", async () => {
  const files = setup();
  const first = await recordDeployment({ createTx: CREATE_TX }, deps(files, mockRpc({})));
  assert.equal(first.ok, true);
  const calls: string[] = [];
  const second = await recordDeployment({ createTx: CREATE_TX }, deps(files, mockRpc({ calls })));
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.token, TOKEN);
    assert.equal(second.createTx, CREATE_TX);
  }
  assert.equal(calls.length, 0);
  const book = JSON.parse(fs.readFileSync(files.bookFile, "utf8"));
  assert.equal(book.createTx, CREATE_TX);
  assert.equal(book.token, TOKEN);
});

test("a different createTx is refused once the book is already filled", async () => {
  const files = setup();
  const first = await recordDeployment({ createTx: CREATE_TX }, deps(files, mockRpc({})));
  assert.equal(first.ok, true);
  const second = await recordDeployment({ createTx: OTHER_TX }, deps(files, mockRpc({})));
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.failure.code, "refused-file");
  const book = JSON.parse(fs.readFileSync(files.bookFile, "utf8"));
  assert.equal(book.createTx, CREATE_TX);
  assert.equal(book.token, TOKEN);
});
