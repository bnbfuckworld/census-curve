import fs from "fs";
import path from "path";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isHash,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { BASE, BSC_RPC, CHAIN_ID, QUOTA0, REGISTRY, SLOPE } from "../economics";
import { failure } from "../copy";
import type { Failure } from "../types";

export const MARKET_CREATED_EVENT = {
  type: "event",
  name: "MarketCreated",
  inputs: [
    { name: "creator", type: "address", indexed: true },
    { name: "token", type: "address", indexed: false },
    { name: "curve", type: "address", indexed: false },
    { name: "pool", type: "address", indexed: false },
    { name: "name", type: "string", indexed: false },
    { name: "symbol", type: "string", indexed: false },
  ],
} as const;

type Plan = {
  chainId: number;
  registry: string;
  deployedBytecode: string;
  name: string;
  symbol: string;
};

type Book = {
  network: string;
  rpc: string;
  chainId: number;
  registry: string;
  factory: string;
  token: string;
  curve: string;
  pool: string;
  name: string;
  symbol: string;
  createTx: string;
  deployTx?: string;
};

export type RecordResult =
  | { ok: true; factory: string; token: string; curve: string; pool: string; createTx: string }
  | { ok: false; failure: Failure };

export type RecordRpc = Pick<PublicClient, "getChainId" | "getTransactionReceipt" | "readContract" | "getBytecode">;

export type RecordDeps = {
  client?: RecordRpc;
  bookFile?: string;
  planFile?: string;
};

function defaultBookFile(): string {
  if (process.env.CENSUS_BOOK) return path.resolve(process.env.CENSUS_BOOK);
  return path.resolve(process.cwd(), "../deploy/book.json");
}

function defaultPlanFile(book: string): string {
  return path.resolve(path.dirname(book), "unsigned.json");
}

function defaultClient(): RecordRpc {
  return createPublicClient({ transport: http(BSC_RPC, { timeout: 8_000, retryCount: 0 }) });
}

function blankAddress(value: string | undefined): boolean {
  return !value || value.trim() === "" || value === "0x" || /^0x0+$/i.test(value.trim());
}

function filledMarket(book: Book): boolean {
  return Boolean(
    book.createTx &&
      isHash(book.createTx as Hex) &&
      !blankAddress(book.token) &&
      !blankAddress(book.curve) &&
      !blankAddress(book.pool),
  );
}

function sameTx(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeBookAtomic(file: string, book: Book): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(book, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function parseCreated(receipt: TransactionReceipt, factory: Address) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({
        abi: [MARKET_CREATED_EVENT],
        data: log.data,
        topics: log.topics,
      });
      if (parsed.eventName !== "MarketCreated") continue;
      const args = parsed.args;
      return {
        creator: getAddress(args.creator),
        token: getAddress(args.token),
        curve: getAddress(args.curve),
        pool: getAddress(args.pool),
        name: args.name,
        symbol: args.symbol,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function recordDeployment(
  body: { factory?: string; deployTx?: string; createTx?: string },
  deps: RecordDeps = {},
): Promise<RecordResult> {
  const bookPath = deps.bookFile ?? defaultBookFile();
  const planPath = deps.planFile ?? defaultPlanFile(bookPath);

  let plan: Plan;
  let book: Book;
  try {
    plan = readJson<Plan>(planPath);
    book = readJson<Book>(bookPath);
  } catch {
    return { ok: false, failure: failure("page-broke") };
  }

  if (plan.chainId !== CHAIN_ID) {
    return { ok: false, failure: failure("refused-file") };
  }

  if (!body.createTx || !isHash(body.createTx as Hex)) {
    return { ok: false, failure: failure("bad-json") };
  }
  const createTx = body.createTx as Hex;

  // Client-supplied factory / deployTx are ignored. The recorded factory is the source of truth.
  if (blankAddress(book.factory)) {
    return { ok: false, failure: failure("unopened") };
  }

  let factory: Address;
  try {
    factory = getAddress(book.factory);
  } catch {
    return { ok: false, failure: failure("refused-file") };
  }

  if (filledMarket(book)) {
    if (sameTx(book.createTx, createTx)) {
      return {
        ok: true,
        factory,
        token: getAddress(book.token),
        curve: getAddress(book.curve),
        pool: getAddress(book.pool),
        createTx: book.createTx,
      };
    }
    return { ok: false, failure: failure("refused-file") };
  }

  const c = deps.client ?? defaultClient();
  try {
    if ((await c.getChainId()) !== CHAIN_ID) return { ok: false, failure: failure("wrong-chain") };
    const code = await c.getBytecode({ address: factory });
    if (!code || code.toLowerCase() !== plan.deployedBytecode.toLowerCase()) {
      return { ok: false, failure: failure("stale") };
    }
    const openedReceipt = await c.getTransactionReceipt({ hash: createTx });
    if (!openedReceipt) return { ok: false, failure: failure("send-lost") };
    if (openedReceipt.status !== "success") return { ok: false, failure: failure("revert") };
    if (!openedReceipt.to || getAddress(openedReceipt.to) !== factory) {
      return { ok: false, failure: failure("rejected") };
    }
    const sender = getAddress(openedReceipt.from);
    const agentBalance = (await c.readContract({
      address: REGISTRY as Address,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: [sender],
    })) as bigint;
    if (agentBalance === 0n) return { ok: false, failure: failure("no-agent") };

    const created = parseCreated(openedReceipt, factory);
    if (!created) return { ok: false, failure: failure("stale") };
    if (created.creator !== sender) return { ok: false, failure: failure("stale") };
    if (plan.name && created.name !== plan.name) return { ok: false, failure: failure("stale") };
    if (plan.symbol && created.symbol !== plan.symbol) return { ok: false, failure: failure("stale") };

    const token = created.token;
    const curve = created.curve;
    const pool = created.pool;
    const [agent, slope, base, quota0, wiredFactory, wiredCurve, wiredPool] = await Promise.all([
      c.readContract({
        address: curve,
        abi: [{ type: "function", name: "agent", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
        functionName: "agent",
      }),
      c.readContract({
        address: curve,
        abi: [{ type: "function", name: "slope", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
        functionName: "slope",
      }),
      c.readContract({
        address: curve,
        abi: [{ type: "function", name: "base", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
        functionName: "base",
      }),
      c.readContract({
        address: curve,
        abi: [{ type: "function", name: "quota0", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
        functionName: "quota0",
      }),
      c.readContract({
        address: token,
        abi: [{ type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
        functionName: "factory",
      }),
      c.readContract({
        address: token,
        abi: [{ type: "function", name: "curve", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
        functionName: "curve",
      }),
      c.readContract({
        address: token,
        abi: [{ type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
        functionName: "pool",
      }),
    ]);
    if (getAddress(agent as Address) !== getAddress(REGISTRY)) return { ok: false, failure: failure("stale") };
    if (slope !== SLOPE || base !== BASE || quota0 !== QUOTA0) return { ok: false, failure: failure("stale") };
    if (getAddress(wiredFactory as Address) !== factory || getAddress(wiredCurve as Address) !== curve || getAddress(wiredPool as Address) !== pool) {
      return { ok: false, failure: failure("stale") };
    }

    // Re-read just before write so a concurrent fill is not overwritten.
    const latest = readJson<Book>(bookPath);
    if (filledMarket(latest)) {
      if (sameTx(latest.createTx, createTx)) {
        return {
          ok: true,
          factory,
          token: getAddress(latest.token),
          curve: getAddress(latest.curve),
          pool: getAddress(latest.pool),
          createTx: latest.createTx,
        };
      }
      return { ok: false, failure: failure("refused-file") };
    }

    const next: Book = {
      ...latest,
      network: latest.network || "bsc",
      rpc: latest.rpc || BSC_RPC,
      chainId: 56,
      registry: getAddress(latest.registry || REGISTRY),
      factory,
      token,
      curve,
      pool,
      name: plan.name || latest.name,
      symbol: plan.symbol || latest.symbol,
      createTx,
    };
    writeBookAtomic(bookPath, next);
    return { ok: true, factory, token, curve, pool, createTx };
  } catch {
    return { ok: false, failure: failure("offline") };
  }
}
