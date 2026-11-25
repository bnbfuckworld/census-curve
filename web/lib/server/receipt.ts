import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  isHash,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { curveAbi, poolAbi, tokenAbi } from "../abi";
import { failure } from "../copy";
import { BSC_RPC, CHAIN_ID } from "../economics";
import { formatBnb, formatToken } from "../format";
import type { Action, ReceiptCheck } from "../types";
import { readFile } from "./chain";

export type ReceiptRpc = {
  getChainId: () => Promise<number>;
  getTransactionReceipt: (args: { hash: Hex }) => Promise<TransactionReceipt | null>;
  readContract: (args: {
    address: Address;
    abi: readonly unknown[] | unknown;
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
};

export type ReceiptDeps = {
  client?: ReceiptRpc;
  rpc?: string;
};

const SCAN = "https://bscscan.com/tx/";

function defaultClient(rpc = BSC_RPC): ReceiptRpc {
  return createPublicClient({ transport: http(rpc, { timeout: 8_000, retryCount: 0 }) }) as unknown as ReceiptRpc;
}


function eventArgs(decoded: { args?: unknown }): Record<string, unknown> {
  const args = decoded.args;
  if (args && typeof args === "object" && !Array.isArray(args)) return args as Record<string, unknown>;
  return {};
}

function asBig(value: unknown): bigint | null {
  return typeof value === "bigint" ? value : null;
}

function same(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

function parseAccount(value: string | undefined): Address | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!isAddress(trimmed)) return null;
  return getAddress(trimmed);
}

function titleFor(action: Action | "approve"): string {
  switch (action) {
    case "mint":
      return "铸造已入账";
    case "sell":
      return "卖回已入账";
    case "swap":
      return "兑换已入账";
    case "add":
      return "入池已入账";
    case "remove":
      return "出池已入账";
    case "approve":
      return "授权已记上";
    case "seat":
      return "入席已入账";
  }
}

function parseAction(
  receipt: TransactionReceipt,
  curve: string,
  pool: string,
  token: string,
): {
  action: Action | "approve";
  tokenWei: bigint | null;
  bnbWei: bigint | null;
} {
  let action: Action | "approve" = same(receipt.to ?? "", token) ? "approve" : same(receipt.to ?? "", curve) ? "mint" : "swap";
  let tokenWei: bigint | null = null;
  let bnbWei: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: curveAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Minted") {
        action = "mint";
        tokenWei = asBig(eventArgs(decoded).amount);
        bnbWei = asBig(eventArgs(decoded).cost);
      } else if (decoded.eventName === "Sold") {
        action = "sell";
        tokenWei = asBig(eventArgs(decoded).amount);
        bnbWei = asBig(eventArgs(decoded).refund);
      }
    } catch {
      /* not a curve event */
    }
    try {
      const decoded = decodeEventLog({ abi: poolAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Swapped") {
        action = "swap";
        {
          const args = eventArgs(decoded);
          const tokenToBnb = Boolean(args.tokenToBnb);
          tokenWei = asBig(tokenToBnb ? args.amountIn : args.amountOut);
          bnbWei = asBig(tokenToBnb ? args.amountOut : args.amountIn);
        }
      } else if (decoded.eventName === "LiquidityAdded") {
        action = "add";
        tokenWei = asBig(eventArgs(decoded).tokenAmount);
        bnbWei = asBig(eventArgs(decoded).bnbAmount);
      } else if (decoded.eventName === "LiquidityRemoved") {
        action = "remove";
        tokenWei = asBig(eventArgs(decoded).tokenAmount);
        bnbWei = asBig(eventArgs(decoded).bnbAmount);
      }
    } catch {
      /* not a pool event */
    }
    try {
      const decoded = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Approval" && action === "approve") {
        tokenWei = asBig(eventArgs(decoded).amount);
      }
    } catch {
      /* not a token event */
    }
  }
  if (same(receipt.to ?? "", pool) && action === "mint") action = "swap";
  return { action, tokenWei, bnbWei };
}

function bodyFor(
  action: Action | "approve",
  tokenWei: bigint | null,
  bnbWei: bigint | null,
  remaining: bigint | null,
): string {
  const got = tokenWei !== null ? formatToken(tokenWei.toString()) : "—";
  const paid = bnbWei !== null ? formatBnb(bnbWei.toString()) : "—";
  const left = remaining !== null ? formatToken(remaining.toString()) : "尚未读到";
  switch (action) {
    case "mint":
      return `得到 ${got}，付出 ${paid}。剩余铸额 ${left}。`;
    case "sell":
      return `卖出 ${got}，拿回 ${paid}。铸额 ${left}。`;
    case "swap":
      return `${got} · ${paid} · 铸额 ${left}`;
    case "add":
      return `${got} · ${paid} · 铸额 ${left}`;
    case "remove":
      return `${got} · ${paid} · 铸额 ${left}`;
    case "approve":
      return "授权";
    case "seat":
      return `入席 ${got} · ${paid}`;
  }
}

export async function checkReceipt(
  body: { hash?: string; account?: string },
  deps: ReceiptDeps = {},
): Promise<ReceiptCheck> {
  if (!body.hash || !isHash(body.hash)) return { ok: false, failure: failure("bad-hash") };
  const opened = readFile();
  if ("failure" in opened) return { ok: false, failure: opened.failure };
  const file = opened.file;
  if (!file.factory || !file.curve || !file.pool || !file.token) {
    return { ok: false, failure: failure("unopened") };
  }
  const client = deps.client ?? defaultClient(deps.rpc ?? file.rpc ?? BSC_RPC);
  try {
    if ((await client.getChainId()) !== CHAIN_ID) return { ok: false, failure: failure("wrong-chain") };
    const receipt = await client.getTransactionReceipt({ hash: body.hash as Hex });
    if (!receipt) return { ok: false, failure: failure("no-receipt") };
    if (receipt.status !== "success") return { ok: false, failure: failure("receipt-fail") };
    const to = receipt.to;
    if (!to || ![file.curve, file.pool, file.token].some((addr) => same(to, addr))) {
      return { ok: false, failure: failure("wrong-to") };
    }
    const parsed = parseAction(receipt, file.curve, file.pool, file.token);
    const who = parseAccount(body.account) ?? getAddress(receipt.from);
    let remaining: bigint | null = null;
    let mintedOf: bigint | null = null;
    try {
      const remainingRaw = await client.readContract({
        address: file.curve as Address,
        abi: curveAbi,
        functionName: "remaining",
        args: [who],
      });
      const mintedRaw = await client.readContract({
        address: file.curve as Address,
        abi: curveAbi,
        functionName: "mintedOf",
        args: [who],
      });
      remaining = asBig(remainingRaw);
      mintedOf = asBig(mintedRaw);
    } catch {
      remaining = null;
      mintedOf = null;
    }
    return {
      ok: true,
      hash: body.hash,
      from: getAddress(receipt.from),
      to: getAddress(to),
      action: parsed.action,
      title: titleFor(parsed.action),
      body: bodyFor(parsed.action, parsed.tokenWei, parsed.bnbWei, remaining),
      tokenWei: parsed.tokenWei !== null ? parsed.tokenWei.toString() : null,
      bnbWei: parsed.bnbWei !== null ? parsed.bnbWei.toString() : null,
      remaining: remaining !== null ? remaining.toString() : null,
      mintedOf: mintedOf !== null ? mintedOf.toString() : null,
      scan: `${SCAN}${body.hash}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (message.includes("could not be found") || message.includes("not found") || message.includes("transaction receipt")) {
      return { ok: false, failure: failure("no-receipt") };
    }
    return { ok: false, failure: failure("offline") };
  }
}
