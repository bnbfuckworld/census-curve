import fs from "fs";
import path from "path";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { curveAbi, poolAbi, registryAbi, tokenAbi } from "../abi";
import { curveSizeIssue } from "../minCurve";
import { failure, failureForRevert } from "../copy";
import { formatBnb, formatToken, groupInteger } from "../format";
import { bawPreviewCommand } from "../sign";
import {
  BASE,
  CHAIN_ID,
  PUBLISHED,
  QUOTA0,
  REGISTRY,
  RPC,
  SLOPE,
} from "../economics";
import type {
  Action,
  Book,
  DeskPayload,
  Failure,
  Identity,
  LocalMarket,
  QuoteDTO,
  QuoteResponse,
  ReceiptDTO,
  RevertDTO,
  SendResponse,
  Who,
} from "../types";
import { ACTIONS, WHO } from "../types";

const GAS_CUSHION = 10n ** 15n;
const MAX_UINT = 2n ** 256n - 1n;
const BSC_RPCS = new Set([
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.bnbchain.org",
  "https://bsc-dataseed2.bnbchain.org",
  "https://bsc-dataseed3.bnbchain.org",
  "https://bsc-dataseed4.bnbchain.org",
]);

function bookPath(): string {
  const fromEnv = process.env.CENSUS_BOOK?.trim();
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), "..", "deploy", "book.json");
}

function chainOf(rpc: string) {
  return defineChain({
    id: CHAIN_ID,
    name: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

function client(rpc: string): PublicClient {
  return createPublicClient({
    chain: chainOf(rpc),
    transport: http(rpc, { timeout: 8_000, retryCount: 0 }),
  });
}

const REVERT_NAMES = [
  "ZeroAccount",
  "NotAgent",
  "EmptyHandle",
  "OnlyFactory",
  "OnlyCurve",
  "AlreadyWired",
  "WrongMarket",
  "WrongChain",
  "BadName",
  "BadSymbol",
  "BadConfig",
  "ZeroAmount",
  "QuotaExceeded",
  "PrimaryClosed",
  "InsufficientPayment",
  "InsufficientBalance",
  "InsufficientLiquidity",
  "NoLiquidity",
  "Slippage",
  "ValueMismatch",
  "Reentrancy",
  "TransferFailed",
  "MathOverflow",
  "Insolvent",
] as const;

const errorAbi = REVERT_NAMES.map((name) => ({
  type: "error" as const,
  name,
  inputs: [],
}));

const selectorToName = new Map<string, string>();
for (const name of REVERT_NAMES) {
  selectorToName.set(toFunctionSelector(`${name}()`).toLowerCase(), name);
}

type DeskFile = {
  network: "bsc" | "rehearsal";
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
  identities: { id: Who; title: string; address: string }[];
  holder: string;
};

type Prepared = {
  action: Action;
  who: Who;
  from: Address;
  token: Address;
  to: Address;
  data: Hex;
  value: bigint;
  tokenWei: bigint;
  bnbWei: bigint;
  minOutWei: bigint | null;
  outUnit: QuoteDTO["outUnit"];
  needApprove: boolean;
  approveAmount: bigint;
  notes: string[];
  blocked: Failure | null;
  marginal: bigint;
  poolPrice: bigint | null;
  poolOpen: boolean;
  remaining: bigint;
  mintedOf: bigint;
  n: bigint;
  supply: bigint;
  fn: string;
  book: Book;
};

function shell(reason: DeskPayload["reason"], extra?: Failure, rpc = ""): DeskPayload {
  return {
    live: false,
    chainId: 56,
    rpc,
    attached: false,
    personal: false,
    reason,
    registry: REGISTRY,
    published: PUBLISHED,
    local: null,
    identities: [],
    who: "lin",
    book: null,
    failure: extra ?? failure(reason ?? "offline"),
    probes: [],
  };
}

function blankAddress(value: string | undefined): boolean {
  return !value || value.trim() === "" || value === "0x" || /^0x0+$/i.test(value.trim());
}

export function readFile(): { file: DeskFile } | { failure: Failure; reason: DeskPayload["reason"] } {
  let raw: string;
  try {
    raw = fs.readFileSync(bookPath(), "utf8");
  } catch {
    return { failure: failure("unopened"), reason: "unopened" };
  }
  let json: DeskFile;
  try {
    json = JSON.parse(raw) as DeskFile;
  } catch {
    return { failure: failure("refused-file"), reason: "refused-file" };
  }
  if (json.network !== "bsc" && json.network !== "rehearsal") {
    return { failure: failure("refused-file"), reason: "refused-file" };
  }
  json.rpc = (json.rpc ?? "").trim().replace(/\/$/, "");
  const rpcOk = json.network === "rehearsal" ? json.rpc === RPC : BSC_RPCS.has(json.rpc);
  if (!rpcOk || json.chainId !== CHAIN_ID) {
    return { failure: failure("refused-file"), reason: "refused-file" };
  }
  const slots = [json.factory, json.token, json.curve, json.pool];
  const empty = slots.every((item) => blankAddress(item));
  const factoryOnly =
    !blankAddress(json.factory) && [json.token, json.curve, json.pool].every((item) => blankAddress(item));
  // Factory is on chain, but the first book is not open yet. The desk stays unopened
  // until token, curve, and pool are all present. A half-filled market is rejected.
  if (factoryOnly) return { failure: failure("unopened"), reason: "unopened" };
  const partial = slots.some((item) => blankAddress(item)) && !empty;
  if (partial) return { failure: failure("refused-file"), reason: "refused-file" };
  try {
    if (getAddress(json.registry) !== getAddress(REGISTRY)) {
      return { failure: failure("refused-file"), reason: "refused-file" };
    }
    json.registry = getAddress(json.registry);
  } catch {
    return { failure: failure("refused-file"), reason: "refused-file" };
  }
  json.name = json.name || "配额曲线第一册";
  json.symbol = json.symbol || "QTA";
  json.createTx = json.createTx || "";
  json.holder = json.holder || "";
  json.identities = Array.isArray(json.identities) ? json.identities : [];
  if (empty) {
    json.factory = "";
    json.token = "";
    json.curve = "";
    json.pool = "";
    return { file: json };
  }
  try {
    json.factory = getAddress(json.factory);
    json.token = getAddress(json.token);
    json.curve = getAddress(json.curve);
    json.pool = getAddress(json.pool);
    if (json.network === "rehearsal") {
      json.identities = json.identities.map((item) => ({
        ...item,
        address: getAddress(item.address),
      }));
      const ids = new Set(json.identities.map((item) => item.id));
      if (WHO.some((id) => !ids.has(id))) {
        return { failure: failure("refused-file"), reason: "refused-file" };
      }
    } else if (json.holder) {
      const holder = getAddress(json.holder);
      json.holder = holder;
      json.identities = [{ id: "lin", title: "持证", address: holder }];
    } else {
      json.identities = [];
    }
  } catch {
    return { failure: failure("refused-file"), reason: "refused-file" };
  }
  return { file: json };
}

function parseWho(input: string | null | undefined): Who {
  if (input && (WHO as readonly string[]).includes(input)) return input as Who;
  return "lin";
}

function isAction(input: string): input is Action {
  return (ACTIONS as readonly string[]).includes(input);
}

export function parseAmount(
  input: string | undefined,
): { ok: true; wei: bigint } | { ok: false; failure: Failure } {
  const t = (input ?? "").trim().replace(/,/g, "");
  if (t === "") return { ok: false, failure: failure("bad-amount", "空着") };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, failure: failure("bad-amount") };
  const [whole, frac = ""] = t.split(".");
  if (frac.length > 18) return { ok: false, failure: failure("bad-amount", "小数超过 18 位") };
  if (whole.length > 12) return { ok: false, failure: failure("bad-amount", "整数太大") };
  const wei = BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0") || "0");
  if (wei === 0n) return { ok: false, failure: failure("zero") };
  return { ok: true, wei };
}

function parseShare(input: string): { ok: true; wei: bigint } | { ok: false; failure: Failure } {
  const t = input.trim().replace(/[,\s]/g, "");
  if (!/^\d+$/.test(t)) return { ok: false, failure: failure("bad-amount", "份额要写整数") };
  if (t.length > 78) return { ok: false, failure: failure("bad-amount", "份额太大") };
  const wei = BigInt(t);
  if (wei === 0n) return { ok: false, failure: failure("zero") };
  return { ok: true, wei };
}

function errorName(err: unknown): string | null {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/insufficient funds/i.test(msg)) return "GAS";
  if (
    /ECONNREFUSED|fetch failed|network|timed out|Timeout|socket|Failed to fetch|headers timeout/i.test(
      msg,
    )
  ) {
    return "OFFLINE";
  }
  if (err instanceof BaseError) {
    const rev = err.walk((item) => item instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) {
      return rev.data.errorName;
    }
    const data = (rev instanceof ContractFunctionRevertedError ? rev.raw : undefined) ?? undefined;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const decoded = decodeErrorResult({ abi: errorAbi, data: data as Hex });
        return decoded.errorName;
      } catch {
        const sel = data.slice(0, 10).toLowerCase();
        if (selectorToName.has(sel)) return selectorToName.get(sel) ?? null;
      }
    }
  }
  const lower = msg.toLowerCase();
  for (const [sel, name] of selectorToName) {
    if (lower.includes(sel)) return name;
  }
  const signed =
    msg.match(/signature:\s*(\w+)\(\)/) ??
    msg.match(/custom error '(\w+)\(\)'/) ??
    msg.match(/reverted with reason:\s*(\w+)/);
  if (signed) return signed[1];
  return null;
}

export function classify(err: unknown): Failure {
  return failureForRevert(errorName(err));
}

function forAction(action: Action, named: Failure): Failure {
  if (action === "sell" && (named.code === "balance" || named.code === "zero")) {
    return failure("curve-short", named.audit);
  }
  return named;
}

async function bookOf(
  c: PublicClient,
  file: DeskFile,
  who: Address | null,
): Promise<Book> {
  const curve = file.curve as Address;
  const pool = file.pool as Address;
  const token = file.token as Address;
  const registry = file.registry as Address;
  const [supply, reserve, n, marginal, nextQuota, tokenReserve, bnbReserve, poolPrice] = await Promise.all([
    c.readContract({ address: curve, abi: curveAbi, functionName: "supply" }),
    c.readContract({ address: curve, abi: curveAbi, functionName: "reserve" }),
    c.readContract({ address: curve, abi: curveAbi, functionName: "n" }),
    c.readContract({ address: curve, abi: curveAbi, functionName: "marginalPrice" }),
    c.readContract({ address: curve, abi: curveAbi, functionName: "nextQuota" }),
    c.readContract({ address: pool, abi: poolAbi, functionName: "tokenReserve" }),
    c.readContract({ address: pool, abi: poolAbi, functionName: "bnbReserve" }),
    c.readContract({ address: pool, abi: poolAbi, functionName: "priceBnbPerToken" }),
  ]);
  let remaining = 0n;
  let mintedOf = 0n;
  let quotaOf = 0n;
  let started = false;
  let tokenBal = 0n;
  let lp = 0n;
  let bnb = 0n;
  let agentBalance = 0n;
  let handle = "";
  if (who) {
    [remaining, mintedOf, quotaOf, started, tokenBal, lp, bnb, agentBalance, handle] = await Promise.all([
      c.readContract({ address: curve, abi: curveAbi, functionName: "remaining", args: [who] }),
      c.readContract({ address: curve, abi: curveAbi, functionName: "mintedOf", args: [who] }),
      c.readContract({ address: curve, abi: curveAbi, functionName: "quotaOf", args: [who] }),
      c.readContract({ address: curve, abi: curveAbi, functionName: "started", args: [who] }),
      c.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [who] }),
      c.readContract({ address: pool, abi: poolAbi, functionName: "lpOf", args: [who] }),
      c.getBalance({ address: who }),
      c.readContract({ address: registry, abi: registryAbi, functionName: "balanceOf", args: [who] }),
      c.readContract({ address: registry, abi: registryAbi, functionName: "handleOf", args: [who] }),
    ]);
  }
  const poolOpen = tokenReserve > 0n && bnbReserve > 0n;
  const one = 10n ** 18n;
  let redeemWei: string | null = null;
  let redeemAmount: string | null = null;
  if (supply > 0n) {
    const slice = supply >= one ? one : supply;
    const quoted = await c.readContract({
      address: curve,
      abi: curveAbi,
      functionName: "quoteSell",
      args: [slice],
    });
    redeemWei = quoted.toString();
    redeemAmount = slice.toString();
  }
  return {
    supply: supply.toString(),
    reserve: reserve.toString(),
    n: n.toString(),
    marginal: marginal.toString(),
    redeemWei,
    redeemAmount,
    nextQuota: nextQuota.toString(),
    remaining: remaining.toString(),
    mintedOf: mintedOf.toString(),
    quotaOf: quotaOf.toString(),
    started,
    tokenReserve: tokenReserve.toString(),
    bnbReserve: bnbReserve.toString(),
    poolPrice: poolPrice.toString(),
    poolOpen,
    tokenBal: tokenBal.toString(),
    lp: lp.toString(),
    bnb: bnb.toString(),
    agentBalance: agentBalance.toString(),
    handle,
    eligible: agentBalance > 0n && handle.length > 0,
  };
}

function identityFrom(file: DeskFile, id: Who, book: Book): Identity {
  const row = file.identities.find((item) => item.id === id)!;
  return {
    id,
    title: row.title,
    address: row.address,
    handle: book.handle,
    agentBalance: book.agentBalance,
    bnb: book.bnb,
    eligible: book.eligible,
  };
}

function parseAccount(input: string | null): Address | null {
  if (!input) return null;
  try {
    return getAddress(input);
  } catch {
    return null;
  }
}

export async function loadDesk(whoInput: string | null, accountInput: string | null = null): Promise<DeskPayload> {
  const who = parseWho(whoInput);
  const looked = parseAccount(accountInput);
  const opened = readFile();
  if ("failure" in opened) return shell(opened.reason, opened.failure);
  const file = opened.file;
  if (!file.factory) return shell("unopened", failure("unopened"), file.rpc);
  const c = client(file.rpc);
  try {
    const chainId = await c.getChainId();
    if (chainId !== CHAIN_ID) return shell("wrong-chain", failure("wrong-chain"), file.rpc);
    const factoryCode = await c.getBytecode({ address: file.factory as Address });
    if (!factoryCode || factoryCode === "0x") return shell("stale", failure("stale"), file.rpc);
    const [slope, base, quota0, name, symbol, wiredFactory, wiredCurve, wiredPool, registryCode] =
      await Promise.all([
        c.readContract({ address: file.curve as Address, abi: curveAbi, functionName: "slope" }),
        c.readContract({ address: file.curve as Address, abi: curveAbi, functionName: "base" }),
        c.readContract({ address: file.curve as Address, abi: curveAbi, functionName: "quota0" }),
        c.readContract({ address: file.token as Address, abi: tokenAbi, functionName: "name" }),
        c.readContract({ address: file.token as Address, abi: tokenAbi, functionName: "symbol" }),
        c.readContract({ address: file.token as Address, abi: tokenAbi, functionName: "factory" }),
        c.readContract({ address: file.token as Address, abi: tokenAbi, functionName: "curve" }),
        c.readContract({ address: file.token as Address, abi: tokenAbi, functionName: "pool" }),
        c.getBytecode({ address: file.registry as Address }),
      ]);
    if (
      getAddress(wiredFactory) !== file.factory ||
      getAddress(wiredCurve) !== file.curve ||
      getAddress(wiredPool) !== file.pool
    ) {
      return shell("stale", failure("stale"), file.rpc);
    }
    let createTxFound = false;
    try {
      await c.getTransaction({ hash: file.createTx as Hex });
      createTxFound = true;
    } catch {
      createTxFound = false;
    }
    const economicsMatch = slope === SLOPE && base === BASE && quota0 === QUOTA0;
    const local: LocalMarket = {
      factory: file.factory,
      token: file.token,
      curve: file.curve,
      pool: file.pool,
      name,
      symbol,
      createTx: file.createTx,
      createTxFound,
      registryCodeBytes: registryCode ? (registryCode.length - 2) / 2 : 0,
      economicsMatch,
      chainSlope: slope.toString(),
      chainBase: base.toString(),
      chainQuota0: quota0.toString(),
    };
    const personal = file.network === "rehearsal" || file.identities.length > 0;
    const selectedId = file.network === "bsc" ? "lin" : who;
    const viewer = !looked && personal
      ? file.identities.find((item) => item.id === selectedId) ?? file.identities[0]
      : undefined;
    const readAs = looked ?? (viewer ? (viewer.address as Address) : null);
    const selected = await bookOf(c, file, readAs);
    const identities = looked
      ? [
          {
            id: "lin" as Who,
            title: "查阅",
            address: looked,
            handle: selected.handle,
            agentBalance: selected.agentBalance,
            bnb: selected.bnb,
            eligible: selected.eligible,
          },
        ]
      : viewer
        ? [identityFrom(file, viewer.id, selected)]
        : [];
    return {
      live: false,
      chainId: 56,
      rpc: file.rpc,
      attached: true,
      personal: Boolean(readAs),
      registry: REGISTRY,
      published: PUBLISHED,
      local,
      identities,
      who: viewer?.id ?? "lin",
      book: selected,
      probes: [],
    };
  } catch (err) {
    return shell("offline", classify(err), file.rpc);
  }
}

function sqrt(y: bigint): bigint {
  if (y > 3n) {
    let z = y;
    let x = y / 2n + 1n;
    while (x < z) {
      z = x;
      x = (y / x + x) / 2n;
    }
    return z;
  }
  return y === 0n ? 0n : 1n;
}

function buildBaw(p: {
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  blocked: Failure | null;
  action: Action;
}): string {
  if (p.blocked) return p.blocked.title;
  return bawPreviewCommand({
    from: p.from,
    to: p.to,
    valueWei: p.value.toString(),
    data: p.data,
  });
}

function gate(book: Book, value: bigint, personal: boolean): Failure | null {
  if (!personal) return null;
  if (BigInt(book.agentBalance) === 0n) return failure("no-agent");
  if (book.handle.length === 0) return failure("empty-handle");
  if (BigInt(book.bnb) < value + GAS_CUSHION) return failure("gas");
  return null;
}

async function prepare(
  c: PublicClient,
  file: DeskFile,
  input: {
    who: Who;
    action: Action;
    token?: string;
    bnb?: string;
    lp?: string;
    tokenToBnb?: boolean;
    account?: string | null;
  },
): Promise<Prepared | { failure: Failure }> {
  const row = file.identities.find((item) => item.id === input.who);
  if (file.network === "rehearsal" && !row) return { failure: failure("bad-who") };
  const looked = parseAccount(input.account ?? null);
  const personal = Boolean(row) || Boolean(looked);
  const from = (looked ?? row?.address ?? "0x0000000000000000000000000000000000000000") as Address;
  const book = await bookOf(c, file, personal ? from : null);
  const curve = file.curve as Address;
  const pool = file.pool as Address;
  const notes: string[] = [];
  const marginal = BigInt(book.marginal);
  const poolOpen = book.poolOpen;
  const poolPrice = poolOpen ? BigInt(book.poolPrice) : null;

  const finish = (
    partial: Omit<
      Prepared,
      | "action"
      | "who"
      | "from"
      | "token"
      | "marginal"
      | "poolPrice"
      | "poolOpen"
      | "remaining"
      | "mintedOf"
      | "n"
      | "supply"
      | "book"
      | "notes"
    > & { notes?: string[]; blocked: Failure | null },
  ): Prepared => ({
    action: input.action,
    who: input.who,
    from,
    token: file.token as Address,
    marginal,
    poolPrice,
    poolOpen,
    remaining: BigInt(book.remaining),
    mintedOf: BigInt(book.mintedOf),
    n: BigInt(book.n),
    supply: BigInt(book.supply),
    book,
    notes: [...notes, ...(partial.notes ?? [])],
    ...partial,
  });

  if (input.action === "mint" || input.action === "sell") {
    const parsed = parseAmount(input.token);
    if (!parsed.ok) return parsed;
    const amount = parsed.wei;
    if (curveSizeIssue(amount) === "dust") return { failure: failure("dust") };
    if (
      input.action === "sell" &&
      (amount > BigInt(book.supply) || (personal && amount > BigInt(book.tokenBal)))
    ) {
      const data = encodeFunctionData({ abi: curveAbi, functionName: "sell", args: [amount] });
      return finish({
        to: curve,
        data,
        value: 0n,
        tokenWei: amount,
        bnbWei: 0n,
        minOutWei: null,
        outUnit: "bnb",
        needApprove: false,
        approveAmount: 0n,
        blocked: failure("curve-short"),
        fn: "sell(uint256)",
      });
    }
    let quoted = 0n;
    try {
      quoted = await c.readContract({
        address: curve,
        abi: curveAbi,
        functionName: input.action === "mint" ? "quoteMint" : "quoteSell",
        args: [amount],
      });
    } catch (err) {
      const named = classify(err);
      if (input.action === "sell" && (named.code === "zero" || named.code === "balance")) {
        return { failure: failure("curve-short", named.audit) };
      }
      return { failure: named };
    }
    if (quoted === 0n) return { failure: failure("dust") };
    const value = input.action === "mint" ? quoted : 0n;
    let blocked = gate(book, value, personal);
    if (!blocked && input.action === "mint") {
      const cap = book.started ? BigInt(book.remaining) : BigInt(book.nextQuota);
      if (amount > cap) blocked = failure("quota");
    }
    if (!blocked && personal && input.action === "sell" && amount > BigInt(book.tokenBal)) {
      blocked = failure("curve-short");
    }
    if (!blocked && input.action === "sell" && amount > BigInt(book.supply)) {
      blocked = failure("curve-short", "卖出数量超过曲线供给");
    }
    const data = encodeFunctionData({
      abi: curveAbi,
      functionName: input.action,
      args: [amount],
    });
    return finish({
      to: curve,
      data,
      value,
      tokenWei: amount,
      bnbWei: quoted,
      minOutWei: null,
      outUnit: "bnb",
      needApprove: false,
      approveAmount: 0n,
      blocked,
      fn: input.action === "mint" ? "mint(uint256)" : "sell(uint256)",
    });
  }

  if (input.action === "swap") {
    const tokenToBnb = Boolean(input.tokenToBnb);
    const parsed = parseAmount(tokenToBnb ? input.token : input.bnb);
    if (!parsed.ok) return parsed;
    const amountIn = parsed.wei;
    if (!poolOpen) {
      const data = encodeFunctionData({
        abi: poolAbi,
        functionName: "swap",
        args: [tokenToBnb, amountIn, 1n],
      });
      return finish({
        to: pool,
        data,
        value: tokenToBnb ? 0n : amountIn,
        tokenWei: tokenToBnb ? amountIn : 0n,
        bnbWei: tokenToBnb ? 0n : amountIn,
        minOutWei: null,
        outUnit: tokenToBnb ? "bnb" : "token",
        needApprove: false,
        approveAmount: 0n,
        blocked: failure("no-liquidity"),
        fn: "swap(bool,uint256,uint256)",
      });
    }
    let expected = 0n;
    try {
      expected = await c.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "quoteSwap",
        args: [tokenToBnb, amountIn],
      });
    } catch (err) {
      return { failure: classify(err) };
    }
    let minOut = (expected * 99n) / 100n;
    if (expected > 0n && minOut === 0n) minOut = 1n;
    const value = tokenToBnb ? 0n : amountIn;
    let blocked = gate(book, value, personal);
    if (!blocked && personal && tokenToBnb && amountIn > BigInt(book.tokenBal)) blocked = failure("balance");
    if (!blocked && expected === 0n) blocked = failure("slippage");
    const allowance =
      personal && tokenToBnb
        ? await c.readContract({
            address: file.token as Address,
            abi: tokenAbi,
            functionName: "allowance",
            args: [from, pool],
          })
        : 0n;
    const data = encodeFunctionData({
      abi: poolAbi,
      functionName: "swap",
      args: [tokenToBnb, amountIn, minOut],
    });
    notes.push("99%");
    return finish({
      to: pool,
      data,
      value,
      tokenWei: tokenToBnb ? amountIn : expected,
      bnbWei: tokenToBnb ? expected : amountIn,
      minOutWei: minOut,
      outUnit: tokenToBnb ? "bnb" : "token",
      needApprove: tokenToBnb && allowance < amountIn,
      approveAmount: amountIn,
      blocked,
      fn: "swap(bool,uint256,uint256)",
    });
  }

  if (input.action === "add") {
    const tokenParsed = parseAmount(input.token);
    if (!tokenParsed.ok) return tokenParsed;
    const bnbParsed = parseAmount(input.bnb);
    if (!bnbParsed.ok) return bnbParsed;
    const tokenWei = tokenParsed.wei;
    const bnbWei = bnbParsed.wei;
    if (tokenWei > MAX_UINT / bnbWei) {
      return { failure: failure("overflow") };
    }
    const tokenReserve = BigInt(book.tokenReserve);
    const bnbReserve = BigInt(book.bnbReserve);
    const lpSupply = await c.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "lpSupply",
    });
    let lpOut = 0n;
    let tokenUsed = tokenWei;
    let bnbUsed = bnbWei;
    if (lpSupply === 0n) {
      const minted = sqrt(tokenWei * bnbWei);
      if (minted <= 1000n) {
        return { failure: failure("no-liquidity", "首笔份额没有超过 1000 的锁定尘埃") };
      }
      lpOut = minted - 1000n;
    } else {
      const fromToken = (tokenWei * lpSupply) / tokenReserve;
      const fromBnb = (bnbWei * lpSupply) / bnbReserve;
      const minted = fromToken < fromBnb ? fromToken : fromBnb;
      if (minted === 0n) return { failure: failure("no-liquidity") };
      lpOut = minted;
      tokenUsed = (minted * tokenReserve) / lpSupply;
      bnbUsed = (minted * bnbReserve) / lpSupply;
      if (tokenUsed === 0n || bnbUsed === 0n) return { failure: failure("no-liquidity") };
    }
    let minLp = (lpOut * 99n) / 100n;
    if (lpOut > 0n && minLp === 0n) minLp = 1n;
    let blocked = gate(book, bnbWei, personal);
    if (!blocked && personal && tokenWei > BigInt(book.tokenBal)) blocked = failure("balance");
    const allowance = personal
      ? await c.readContract({
          address: file.token as Address,
          abi: tokenAbi,
          functionName: "allowance",
          args: [from, pool],
        })
      : 0n;
    const data = encodeFunctionData({
      abi: poolAbi,
      functionName: "addLiquidity",
      args: [tokenWei, minLp],
    });
    notes.push(
      `池子实际吃进约 ${formatToken(tokenUsed.toString())} 和 ${formatBnb(bnbUsed.toString())}，多余退回。内部份额约 ${groupInteger(lpOut.toString())}，下限 ${groupInteger(minLp.toString())}。`,
    );
    return finish({
      to: pool,
      data,
      value: bnbWei,
      tokenWei,
      bnbWei,
      minOutWei: minLp,
      outUnit: "share",
      needApprove: allowance < tokenWei,
      approveAmount: tokenWei,
      blocked,
      fn: "addLiquidity(uint256,uint256)",
    });
  }

  const lpBal = BigInt(book.lp);
  const share = (input.lp ?? "").trim();
  if (!personal && share === "") return { failure: failure("bad-amount", "出册要写下份额") };
  const parsedShare = share === "" ? { ok: true as const, wei: lpBal } : parseShare(share);
  if (!parsedShare.ok) return parsedShare;
  if (parsedShare.wei === 0n) return { failure: failure("balance", "这个账户没有内部份额") };
  if (!book.poolOpen) return { failure: failure("no-liquidity") };
  const lpSupply = await c.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "lpSupply",
  });
  const tokenOut = (parsedShare.wei * BigInt(book.tokenReserve)) / lpSupply;
  const bnbOut = (parsedShare.wei * BigInt(book.bnbReserve)) / lpSupply;
  if (tokenOut === 0n || bnbOut === 0n) return { failure: failure("no-liquidity") };
  let minToken = (tokenOut * 99n) / 100n;
  let minBnb = (bnbOut * 99n) / 100n;
  if (minToken === 0n) minToken = 1n;
  if (minBnb === 0n) minBnb = 1n;
  let blocked = gate(book, 0n, personal);
  if (!blocked && personal && parsedShare.wei > lpBal) blocked = failure("balance");
  const data = encodeFunctionData({
    abi: poolAbi,
    functionName: "removeLiquidity",
    args: [parsedShare.wei, minToken, minBnb],
  });
  return finish({
    to: pool,
    data,
    value: 0n,
    tokenWei: tokenOut,
    bnbWei: bnbOut,
    minOutWei: parsedShare.wei,
    outUnit: "share",
    needApprove: false,
    approveAmount: 0n,
    blocked,
    fn: "removeLiquidity(uint256,uint256,uint256)",
  });
}

function toQuote(p: Prepared): QuoteDTO {
  const approveCalldata =
    p.needApprove && p.approveAmount > 0n
      ? encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [p.to, p.approveAmount],
        })
      : null;
  return {
    action: p.action,
    who: p.who,
    from: p.from,
    to: p.to,
    calldata: p.data,
    valueWei: p.value.toString(),
    tokenWei: p.tokenWei.toString(),
    bnbWei: p.bnbWei.toString(),
    minOutWei: p.minOutWei === null ? null : p.minOutWei.toString(),
    outUnit: p.outUnit,
    needApprove: p.needApprove,
    approveTo: approveCalldata ? p.token : null,
    approveCalldata,
    notes: p.notes,
    blocked: p.blocked,
    marginal: p.marginal.toString(),
    poolPrice: p.poolPrice === null ? null : p.poolPrice.toString(),
    poolOpen: p.poolOpen,
    remaining: p.remaining.toString(),
    mintedOf: p.mintedOf.toString(),
    n: p.n.toString(),
    supply: p.supply.toString(),
    baw: buildBaw(p),
    fn: p.fn,
  };
}

export async function quote(body: {
  who?: string;
  action?: string;
  token?: string;
  bnb?: string;
  lp?: string;
  tokenToBnb?: boolean;
  account?: string;
}): Promise<QuoteResponse> {
  const opened = readFile();
  if ("failure" in opened) return { ok: false, failure: opened.failure };
  const file = opened.file;
  if (!file.factory) return { ok: false, failure: failure("unopened") };
  if (file.network === "rehearsal" && (!body.who || !(WHO as readonly string[]).includes(body.who))) {
    return { ok: false, failure: failure("bad-who") };
  }
  if (!body.action || !isAction(body.action)) return { ok: false, failure: failure("bad-action") };
  const c = client(file.rpc);
  try {
    if ((await c.getChainId()) !== CHAIN_ID) return { ok: false, failure: failure("wrong-chain") };
    const prepared = await prepare(c, file, {
      who: (file.network === "bsc" ? "lin" : body.who) as Who,
      action: body.action,
      token: body.token,
      bnb: body.bnb,
      lp: body.lp,
      tokenToBnb: body.tokenToBnb,
      account: body.account,
    });
    if ("failure" in prepared) return { ok: false, failure: prepared.failure };
    return { ok: true, quote: toQuote(prepared) };
  } catch (err) {
    return { ok: false, failure: classify(err) };
  }
}

function quotaNote(action: Action, before: Book, after: Book): string | null {
  if (action === "sell") {
    if (before.mintedOf === after.mintedOf && before.n === after.n) {
      return "卖回没有把铸额还回来。已铸的枚数没有减少。";
    }
    return "卖回之后已铸的枚数变了。这不符合曲线的规则，停下来核对，不要继续。";
  }
  if (action === "mint") {
    return "这笔把铸额用掉了。之后把币卖回曲线或卖进池子，铸额也不会回来。";
  }
  return null;
}

function stateHeld(before: Book, after: Book): boolean {
  return (
    before.supply === after.supply &&
    before.reserve === after.reserve &&
    before.n === after.n &&
    before.mintedOf === after.mintedOf &&
    before.remaining === after.remaining &&
    before.tokenBal === after.tokenBal &&
    before.lp === after.lp &&
    before.tokenReserve === after.tokenReserve &&
    before.bnbReserve === after.bnbReserve
  );
}

export async function send(body: {
  who?: string;
  action?: string;
  token?: string;
  bnb?: string;
  lp?: string;
  tokenToBnb?: boolean;
  confirm?: boolean;
  force?: boolean;
}): Promise<SendResponse> {
  if (body.confirm !== true) return { ok: false, failure: failure("rejected") };
  const opened = readFile();
  if ("failure" in opened) return { ok: false, failure: opened.failure };
  const file = opened.file;
  if (!file.factory) return { ok: false, failure: failure("unopened") };
  if (file.network !== "rehearsal" || file.rpc !== RPC) {
    return { ok: false, failure: failure("app-only") };
  }
  if (!body.who || !(WHO as readonly string[]).includes(body.who)) {
    return { ok: false, failure: failure("bad-who") };
  }
  if (!body.action || !isAction(body.action)) return { ok: false, failure: failure("bad-action") };
  const c = client(file.rpc);
  try {
    if ((await c.getChainId()) !== CHAIN_ID) return { ok: false, failure: failure("wrong-chain") };
    const prepared = await prepare(c, file, {
      who: body.who as Who,
      action: body.action,
      token: body.token,
      bnb: body.bnb,
      lp: body.lp,
      tokenToBnb: body.tokenToBnb,
    });
    if ("failure" in prepared) return { ok: false, failure: prepared.failure };
    if (prepared.blocked && !body.force) return { ok: false, failure: prepared.blocked };

    const wallet = createWalletClient({
      account: prepared.from,
      chain: chainOf(file.rpc),
      transport: http(file.rpc, { timeout: 8_000, retryCount: 0 }),
    });
    const before = prepared.book;
    let approveHash: Hex | undefined;
    if (prepared.needApprove) {
      const approveData = encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [file.pool as Address, prepared.approveAmount],
      });
      try {
        approveHash = await wallet.sendTransaction({
          account: prepared.from,
          to: file.token as Address,
          data: approveData,
          value: 0n,
          chain: chainOf(file.rpc),
        });
      } catch (err) {
        return { ok: false, failure: classify(err) };
      }
      const approveReceipt = await c.waitForTransactionReceipt({ hash: approveHash });
      if (approveReceipt.status !== "success") {
        const after = await bookOf(c, file, prepared.from);
        let named = failure("revert", "授权那一笔被退回");
        try {
          await c.call({ account: prepared.from, to: file.token as Address, data: approveData });
        } catch (err) {
          named = classify(err);
        }
        const reverted: RevertDTO = {
          hash: approveHash,
          blockNumber: approveReceipt.blockNumber.toString(),
          gasUsed: approveReceipt.gasUsed.toString(),
          status: "reverted",
          before,
          after,
          stateHeld: stateHeld(before, after),
        };
        return { ok: false, failure: named, reverted };
      }
    }

    if (!body.force) {
      try {
        await c.estimateGas({
          account: prepared.from,
          to: prepared.to,
          data: prepared.data,
          value: prepared.value,
        });
      } catch (err) {
        const named = forAction(prepared.action, classify(err));
        if (approveHash) {
          named.audit = `授权已入账 ${approveHash}。正票没有送出。${named.audit ?? ""}`.trim();
        }
        return { ok: false, failure: named };
      }
    }

    let hash: Hex;
    try {
      hash = await wallet.sendTransaction({
        account: prepared.from,
        to: prepared.to,
        data: prepared.data,
        value: prepared.value,
        chain: chainOf(file.rpc),
      });
    } catch (err) {
      const named = forAction(prepared.action, classify(err));
      if (approveHash) {
        named.audit = `授权已入账 ${approveHash}。正票没有出门。${named.audit ?? ""}`.trim();
      }
      return { ok: false, failure: named };
    }
    const mined = await c.waitForTransactionReceipt({ hash });
    const after = await bookOf(c, file, prepared.from);
    if (mined.status !== "success") {
      let named = failure("revert", "交易状态是失败");
      try {
        await c.call({
          account: prepared.from,
          to: prepared.to,
          data: prepared.data,
          value: prepared.value,
        });
      } catch (err) {
        named = forAction(prepared.action, classify(err));
      }
      const reverted: RevertDTO = {
        hash,
        approveHash,
        blockNumber: mined.blockNumber.toString(),
        gasUsed: mined.gasUsed.toString(),
        status: "reverted",
        before,
        after,
        stateHeld: stateHeld(before, after),
      };
      return { ok: false, failure: named, reverted };
    }
    const receipt: ReceiptDTO = {
      action: prepared.action,
      who: prepared.who,
      hash,
      approveHash,
      blockNumber: mined.blockNumber.toString(),
      gasUsed: mined.gasUsed.toString(),
      status: "success",
      before,
      after,
      quotaNote: quotaNote(prepared.action, before, after),
    };
    return { ok: true, receipt };
  } catch (err) {
    return { ok: false, failure: classify(err) };
  }
}
