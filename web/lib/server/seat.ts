import fs from "fs";
import path from "path";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHash,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { parseTokenId, tokenIdHex, tokenIdOfHandle } from "../agentId";
import { tokenAbi } from "../abi";
import { failure, failureForRevert } from "../copy";
import { CHAIN_ID, REGISTRY, RPC } from "../economics";
import { formatBnb, formatToken } from "../format";
import { curveSizeIssue } from "../minCurve";
import { blocksToSeconds, seatPhase, type SeatPhase } from "../seatPhase";
import { ownerOfAbi, seatBookAbi, seatFactoryAbi, seatPoolAbi } from "../seatAbi";
import type { RosterRow, SeatSnapshot } from "../seatTypes";
import { bawPreviewCommand } from "../sign";
import { parseAmount } from "./chain";
import type { Action, Failure, QuoteDTO, QuoteResponse, ReceiptCheck } from "../types";

const BSC_RPCS = new Set([
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.bnbchain.org",
  "https://bsc-dataseed2.bnbchain.org",
  "https://bsc-dataseed3.bnbchain.org",
  "https://bsc-dataseed4.bnbchain.org",
]);

const WAD = 10n ** 18n;
const MIN_BNB = 10n ** 12n;
const ZERO = zeroAddress;

type SeatFile = {
  network: "bsc" | "rehearsal";
  rpc: string;
  chainId: number;
  registry: Address;
  factory: string;
  token: string;
  book: string;
  pool: string;
  name: string;
  symbol: string;
};

type WindowQuote = {
  open: boolean;
  windowFree: boolean;
  bookFull: boolean;
  window: bigint;
  elapsed: bigint;
  blocksLeft: bigint;
  floor: bigint;
  price: bigint;
  premium: bigint;
  reserveIn: bigint;
  burn: bigint;
};

function seatPath(): string {
  const fromEnv = process.env.CENSUS_SEAT?.trim();
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), "..", "deploy", "seat.json");
}

function clientOf(rpc: string): PublicClient {
  return createPublicClient({ transport: http(rpc, { timeout: 12_000, retryCount: 0 }) });
}

function blank(value: string | undefined): boolean {
  return !value || value.trim() === "" || /^0x0*$/i.test(value.trim());
}

function emptySnap(phase: SeatPhase, row?: Failure, rpc = ""): SeatSnapshot {
  return {
    attached: false,
    local: rpc.includes("127.0.0.1"),
    phase,
    failure: row ?? failure(phase === "offline" ? "offline" : phase),
    chainId: 56,
    rpc,
    registry: REGISTRY,
    blockNumber: "",
    name: "配额曲线第二册",
    symbol: "QTB",
    factory: "",
    token: "",
    book: "",
    pool: "",
    open: false,
    windowFree: false,
    bookFull: false,
    window: "0",
    elapsed: "0",
    blocksLeft: "",
    secondsLeft: "",
    floor: "0",
    price: "0",
    premium: "0",
    reserveIn: "0",
    burn: "0",
    lastBurn: "0",
    filled: "0",
    cap: "100",
    supply: "0",
    reserve: "0",
    windowAgentId: "",
    windowTaker: "",
    windowHandle: "",
    feeBps: "",
    priorSwaps: "",
    account: "",
    agentId: "",
    agentIdHex: "",
    handle: "",
    eligible: false,
    alreadySeated: false,
    bnb: "0",
    tokenBal: "0",
    lp: "0",
    poolOpen: false,
    tokenReserve: "0",
    bnbReserve: "0",
    roster: [],
  };
}

function readFile(): { file: SeatFile } | { failure: Failure; phase: SeatPhase } {
  let raw: string;
  try {
    raw = fs.readFileSync(seatPath(), "utf8");
  } catch {
    return { failure: failure("unopened"), phase: "unopened" };
  }
  let json: SeatFile;
  try {
    json = JSON.parse(raw) as SeatFile;
  } catch {
    return { failure: failure("refused-file"), phase: "refused" };
  }
  if (json.network !== "bsc" && json.network !== "rehearsal") {
    return { failure: failure("refused-file"), phase: "refused" };
  }
  json.rpc = (json.rpc ?? "").trim().replace(/\/$/, "");
  const rpcOk = json.network === "rehearsal" ? json.rpc === RPC : BSC_RPCS.has(json.rpc);
  if (!rpcOk || json.chainId !== CHAIN_ID) return { failure: failure("refused-file"), phase: "refused" };
  try {
    if (getAddress(json.registry) !== getAddress(REGISTRY)) {
      return { failure: failure("refused-file"), phase: "refused" };
    }
    json.registry = getAddress(json.registry);
  } catch {
    return { failure: failure("refused-file"), phase: "refused" };
  }
  json.name = json.name || "配额曲线第二册";
  json.symbol = json.symbol || "QTB";
  return { file: json };
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && value) return BigInt(value);
  return 0n;
}

function asAddr(value: unknown): Address {
  return getAddress(String(value));
}

function pick(raw: unknown, index: number, name: string): unknown {
  if (Array.isArray(raw)) return raw[index];
  if (raw && typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    if (name in row) return row[name];
    if (index in row) return row[index];
  }
  return undefined;
}

function windowOf(raw: unknown): WindowQuote {
  return {
    open: asBool(pick(raw, 0, "open")),
    windowFree: asBool(pick(raw, 1, "windowFree")),
    bookFull: asBool(pick(raw, 2, "bookFull")),
    window: asBig(pick(raw, 3, "window")),
    elapsed: asBig(pick(raw, 4, "elapsed")),
    blocksLeft: asBig(pick(raw, 5, "blocksLeft")),
    floor: asBig(pick(raw, 6, "floor")),
    price: asBig(pick(raw, 7, "price")),
    premium: asBig(pick(raw, 8, "premium")),
    reserveIn: asBig(pick(raw, 9, "reserveIn")),
    burn: asBig(pick(raw, 10, "burn")),
  };
}

function nftUrl(registry: string, id: bigint, local: boolean): string {
  if (local) return `https://bscscan.com/nft/${registry}/${id.toString()}`;
  return `https://bscscan.com/nft/${registry}/${id.toString()}`;
}

function addrUrl(account: string): string {
  return `https://bscscan.com/address/${account}`;
}

export async function loadSeat(accountRaw: string | null, agentRaw: string | null): Promise<SeatSnapshot> {
  const opened = readFile();
  if ("failure" in opened) return emptySnap(opened.phase, opened.failure);
  const file = opened.file;
  const local = file.rpc.includes("127.0.0.1");
  if (blank(file.factory) && blank(file.token) && blank(file.book) && blank(file.pool)) {
    return emptySnap("unopened", failure("unopened"), file.rpc);
  }
  const c = clientOf(file.rpc);
  try {
    if ((await c.getChainId()) !== CHAIN_ID) return emptySnap("wrong-chain", failure("wrong-chain"), file.rpc);
    let token = file.token;
    let book = file.book;
    let pool = file.pool;
    const factory = getAddress(file.factory);
    if (blank(token) || blank(book) || blank(pool)) {
      const count = await c.readContract({ address: factory, abi: seatFactoryAbi, functionName: "marketCount" });
      if (count === 0n) {
        const snap = emptySnap("no-book", failure("no-book"), file.rpc);
        snap.factory = factory;
        return snap;
      }
      const market = await c.readContract({
        address: factory,
        abi: seatFactoryAbi,
        functionName: "markets",
        args: [0n],
      });
      token = market[0];
      book = market[1];
      pool = market[2];
    }
    const tokenAddr = getAddress(token);
    const bookAddr = getAddress(book);
    const poolAddr = getAddress(pool);
    const code = await c.getBytecode({ address: bookAddr });
    if (!code || code === "0x") return emptySnap("stale", failure("stale"), file.rpc);

    const account = accountRaw && isAddress(accountRaw) ? getAddress(accountRaw) : undefined;
    const askedId = parseTokenId(agentRaw);
    const blockNumber = await c.getBlockNumber();
    const [quoteRaw, filled, supply, reserve, cap, windowBlocks, guardBlocks, base, slope, baseFee, maxFee, curveOf, poolOf, agentOf] =
      await Promise.all([
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "quoteWindow", args: [blockNumber] }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "filled" }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "supply" }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "reserve" }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "CAP" }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "WINDOW_BLOCKS" }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "GUARD_BLOCKS" }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "BASE" }),
        c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "SLOPE" }),
        c.readContract({ address: poolAddr, abi: seatPoolAbi, functionName: "BASE_FEE_BPS" }),
        c.readContract({ address: poolAddr, abi: seatPoolAbi, functionName: "MAX_FEE_BPS" }),
        c.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "curve" }),
        c.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "pool" }),
        c.readContract({ address: factory, abi: seatFactoryAbi, functionName: "AGENT" }),
      ]);
    if (
      windowBlocks !== 160n ||
      guardBlocks !== 16n ||
      cap !== 100n ||
      base !== 10n ** 15n ||
      slope !== 10n ** 15n ||
      baseFee !== 30n ||
      maxFee !== 100n ||
      getAddress(curveOf) !== bookAddr ||
      getAddress(poolOf) !== poolAddr ||
      getAddress(agentOf) !== file.registry
    ) {
      return emptySnap("wrong-book", failure("wrong-book"), file.rpc);
    }

    const quote = windowOf(quoteRaw);
    let handle = "";
    let balance = 0n;
    let derived = 0n;
    if (account) {
      const [bal, got] = await Promise.all([
        c.readContract({ address: file.registry, abi: ownerOfAbi, functionName: "balanceOf", args: [account] }),
        c.readContract({ address: file.registry, abi: ownerOfAbi, functionName: "handleOf", args: [account] }),
      ]);
      balance = bal;
      handle = got;
      if (handle) derived = tokenIdOfHandle(handle);
    }
    const agentId = askedId ?? derived;
    let owner = "";
    let ownerMatches = askedId === null && derived === 0n;
    if (agentId > 0n || askedId !== null) {
      try {
        owner = getAddress(
          await c.readContract({
            address: file.registry,
            abi: ownerOfAbi,
            functionName: "ownerOf",
            args: [agentId],
          }),
        );
        ownerMatches = account ? owner === account : true;
      } catch {
        ownerMatches = false;
      }
    }
    const eligible = Boolean(account) && balance > 0n && handle.length > 0;
    const lookedUp = Boolean(account) || askedId !== null;
    let alreadySeated = false;
    if (agentId > 0n) {
      alreadySeated = await c.readContract({
        address: bookAddr,
        abi: seatBookAbi,
        functionName: "idUsed",
        args: [agentId],
      });
    }

    let windowAgentId = "";
    let windowTaker = "";
    let windowHandle = "";
    if (quote.open) {
      const seat = await c.readContract({
        address: bookAddr,
        abi: seatBookAbi,
        functionName: "seats",
        args: [quote.window],
      });
      if (seat[2]) {
        const taker = getAddress(seat[1]);
        windowAgentId = seat[0].toString();
        windowTaker = taker;
        try {
          windowHandle = await c.readContract({
            address: file.registry,
            abi: ownerOfAbi,
            functionName: "handleOf",
            args: [taker],
          });
        } catch {
          windowHandle = "";
        }
      }
    }

    const who = account ?? ZERO;
    const fee = await c.readContract({
      address: poolAddr,
      abi: seatPoolAbi,
      functionName: "previewFee",
      args: [who, agentId],
    });
    const [tokenReserve, bnbReserve, tokenBal, lp, bnb] = await Promise.all([
      c.readContract({ address: poolAddr, abi: seatPoolAbi, functionName: "tokenReserve" }),
      c.readContract({ address: poolAddr, abi: seatPoolAbi, functionName: "bnbReserve" }),
      account
        ? c.readContract({ address: tokenAddr, abi: tokenAbi, functionName: "balanceOf", args: [account] })
        : Promise.resolve(0n),
      account
        ? c.readContract({ address: poolAddr, abi: seatPoolAbi, functionName: "lpOf", args: [account] })
        : Promise.resolve(0n),
      account ? c.getBalance({ address: account }) : Promise.resolve(0n),
    ]);

    const length = await c.readContract({ address: bookAddr, abi: seatBookAbi, functionName: "rosterLength" });
    const roster = await readRoster(c, file.registry, bookAddr, length, local);
    const phase = seatPhase({
      attached: true,
      open: quote.open,
      windowFree: quote.windowFree,
      bookFull: quote.bookFull,
      alreadySeated,
      lookedUp,
      eligible: lookedUp ? eligible : true,
      ownerMatches: lookedUp ? ownerMatches : true,
      emptyHandle: Boolean(account) && balance > 0n && handle.length === 0,
    });
    const lastBurn = quote.floor > quote.reserveIn ? quote.floor - quote.reserveIn : 0n;
    const snap: SeatSnapshot = {
      attached: true,
      local,
      phase,
      failure: phase === "open" ? undefined : failure(phase === "taken" ? "taken" : phase),
      chainId: 56,
      rpc: file.rpc,
      registry: file.registry,
      blockNumber: blockNumber.toString(),
      name: file.name,
      symbol: file.symbol,
      factory,
      token: tokenAddr,
      book: bookAddr,
      pool: poolAddr,
      open: quote.open,
      windowFree: quote.windowFree,
      bookFull: quote.bookFull,
      window: quote.window.toString(),
      elapsed: quote.elapsed.toString(),
      blocksLeft: quote.blocksLeft.toString(),
      secondsLeft: blocksToSeconds(quote.blocksLeft),
      floor: quote.floor.toString(),
      price: quote.price.toString(),
      premium: quote.premium.toString(),
      reserveIn: quote.reserveIn.toString(),
      burn: quote.burn.toString(),
      lastBurn: lastBurn.toString(),
      filled: filled.toString(),
      cap: cap.toString(),
      supply: supply.toString(),
      reserve: reserve.toString(),
      windowAgentId,
      windowTaker,
      windowHandle,
      feeBps: fee[0].toString(),
      priorSwaps: fee[1].toString(),
      account: account ?? "",
      agentId: agentId > 0n || askedId !== null ? agentId.toString() : "",
      agentIdHex: agentId > 0n || askedId !== null ? tokenIdHex(agentId) : "",
      handle,
      eligible,
      alreadySeated,
      bnb: bnb.toString(),
      tokenBal: tokenBal.toString(),
      lp: lp.toString(),
      poolOpen: tokenReserve > 0n && bnbReserve > 0n,
      tokenReserve: tokenReserve.toString(),
      bnbReserve: bnbReserve.toString(),
      roster,
    };
    if (phase === "open") snap.failure = undefined;
    return snap;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("loadSeat failed:", message.slice(0, 500));
    return emptySnap("offline", failure("offline"), file.rpc);
  }
}

async function readRoster(
  c: PublicClient,
  registry: Address,
  book: Address,
  length: bigint,
  local: boolean,
): Promise<RosterRow[]> {
  const n = Number(length > 100n ? 100n : length);
  if (n === 0) return [];
  const rows = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      c.readContract({ address: book, abi: seatBookAbi, functionName: "roster", args: [BigInt(i)] }),
    ),
  );
  const handles = await Promise.all(
    rows.map(async (row) => {
      try {
        return await c.readContract({
          address: registry,
          abi: ownerOfAbi,
          functionName: "handleOf",
          args: [getAddress(String(pick(row, 1, "taker")))],
        });
      } catch {
        return "";
      }
    }),
  );
  return rows.map((row, i) => {
    const id = asBig(pick(row, 0, "agentId"));
    const taker = getAddress(String(pick(row, 1, "taker")));
    return {
      agentId: id.toString(),
      agentIdHex: tokenIdHex(id),
      taker,
      handle: String(handles[i] ?? ""),
      window: asBig(pick(row, 2, "window")).toString(),
      price: asBig(pick(row, 3, "price")).toString(),
      floorPaid: asBig(pick(row, 4, "floorPaid")).toString(),
      atBlock: asBig(pick(row, 5, "atBlock")).toString(),
      nft: nftUrl(registry, id, local),
      takerScan: addrUrl(taker),
    };
  });
}

function slipFor(action: string): string {
  if (action === "seat" || action === "sell") return "";
  return "99%";
}

function finishQuote(
  snap: SeatSnapshot,
  partial: Omit<QuoteDTO, "who" | "baw" | "marginal" | "poolPrice" | "poolOpen" | "remaining" | "mintedOf" | "n" | "supply"> & {
    blocked: Failure | null;
  },
): QuoteDTO {
  const quote: QuoteDTO = {
    ...partial,
    who: "lin",
    marginal: snap.price,
    poolPrice: snap.poolOpen ? snap.bnbReserve : null,
    poolOpen: snap.poolOpen,
    remaining: snap.alreadySeated ? "0" : WAD.toString(),
    mintedOf: snap.alreadySeated ? WAD.toString() : "0",
    n: snap.window,
    supply: snap.supply,
    baw: "",
  };
  quote.baw = partial.blocked
    ? "这一笔现在不会成立。不要预览，也不要执行。"
    : bawPreviewCommand({
        from: snap.account || undefined,
        to: partial.to,
        valueWei: partial.valueWei,
        data: partial.calldata,
      });
  return quote;
}

function identityBlock(snap: SeatSnapshot, value: bigint): Failure | null {
  if (!snap.account) return failure("bad-who");
  if (snap.phase === "empty-handle") return failure("empty-handle");
  if (!snap.eligible) return failure("no-agent");
  if (!snap.agentId || snap.phase === "not-owner") return failure("not-owner");
  if (value > 0n && BigInt(snap.bnb) < value) return failure("balance");
  return null;
}

function seatBlock(snap: SeatSnapshot): Failure | null {
  if (snap.phase === "guard") return failure("guard");
  if (snap.phase === "taken") return failure("taken");
  if (snap.phase === "seated") return failure("seated");
  if (snap.phase === "full") return failure("full");
  if (!snap.open || !snap.windowFree) return failure("guard");
  return null;
}

export async function quoteSeat(body: {
  action?: string;
  account?: string;
  agentId?: string;
  token?: string;
  bnb?: string;
  lp?: string;
  tokenToBnb?: boolean;
}): Promise<QuoteResponse> {
  const action = body.action;
  if (action !== "seat" && action !== "sell" && action !== "swap" && action !== "add" && action !== "remove") {
    return { ok: false, failure: failure("bad-action") };
  }
  const snap = await loadSeat(body.account ?? null, body.agentId ?? null);
  if (!snap.attached) return { ok: false, failure: snap.failure ?? failure("offline") };
  const id = parseTokenId(snap.agentId);
  if (id === null) return { ok: false, failure: failure("not-owner") };
  const from = (snap.account || ZERO) as Address;
  const notes: string[] = [];
  try {
    if (action === "seat") {
      const blocked = identityBlock(snap, BigInt(snap.price)) ?? seatBlock(snap);
      const data = encodeFunctionData({ abi: seatBookAbi, functionName: "takeSeat", args: [id] });
      notes.push(`${formatBnb(snap.price)} · ${formatBnb(snap.floor)} · ${formatBnb(snap.premium)}`);
      return {
        ok: true,
        quote: finishQuote(snap, {
          action,
          from,
          to: snap.book,
          calldata: data,
          valueWei: snap.price,
          tokenWei: WAD.toString(),
          bnbWei: snap.price,
          minOutWei: null,
          outUnit: "token",
          needApprove: false,
          approveTo: null,
          approveCalldata: null,
          notes,
          blocked,
          fn: "takeSeat(uint256)",
          feeLabel: "—",
          slipNote: slipFor(action),
        }),
      };
    }

    if (action === "sell") {
      const parsed = parseAmount(body.token);
      if (!parsed.ok) return parsed;
      if (parsed.wei === 0n) return { ok: false, failure: failure("zero") };
      if (parsed.wei < WAD || parsed.wei % WAD !== 0n) return { ok: false, failure: failure("whole") };
      let refund = 0n;
      try {
        refund = await clientOf(snap.rpc).readContract({
          address: snap.book as Address,
          abi: seatBookAbi,
          functionName: "quoteSell",
          args: [parsed.wei],
        });
      } catch (err) {
        return { ok: false, failure: failureForRevert(named(err)) };
      }
      const blocked =
        identityBlock(snap, 0n) ??
        (parsed.wei > BigInt(snap.tokenBal) || parsed.wei > BigInt(snap.supply) ? failure("curve-short") : null);
      const data = encodeFunctionData({ abi: seatBookAbi, functionName: "sell", args: [parsed.wei] });
      return {
        ok: true,
        quote: finishQuote(snap, {
          action,
          from,
          to: snap.book,
          calldata: data,
          valueWei: "0",
          tokenWei: parsed.wei.toString(),
          bnbWei: refund.toString(),
          minOutWei: null,
          outUnit: "bnb",
          needApprove: false,
          approveTo: null,
          approveCalldata: null,
          notes,
          blocked,
          fn: "sell(uint256)",
          feeLabel: "—",
          slipNote: slipFor(action),
        }),
      };
    }

    const c = clientOf(snap.rpc);
    if (action === "swap") {
      const tokenToBnb = Boolean(body.tokenToBnb);
      const parsed = parseAmount(tokenToBnb ? body.token : body.bnb);
      if (!parsed.ok) return parsed;
      if (!tokenToBnb && parsed.wei < MIN_BNB) return { ok: false, failure: failure("dust") };
      if (tokenToBnb && curveSizeIssue(parsed.wei) === "dust") return { ok: false, failure: failure("dust") };
      if (!snap.poolOpen) return { ok: false, failure: failure("no-liquidity") };
      const quoted = await c.readContract({
        address: snap.pool as Address,
        abi: seatPoolAbi,
        functionName: "quoteSwap",
        args: [tokenToBnb, parsed.wei, from, id],
      });
      const out = quoted[0];
      const feeBps = quoted[1];
      let minOut = (out * 99n) / 100n;
      if (minOut === 0n) minOut = 1n;
      let blocked = identityBlock(snap, tokenToBnb ? 0n : parsed.wei);
      if (!blocked && tokenToBnb && parsed.wei > BigInt(snap.tokenBal)) blocked = failure("balance");
      const data = encodeFunctionData({
        abi: seatPoolAbi,
        functionName: "swap",
        args: [tokenToBnb, parsed.wei, minOut, id],
      });
      const allowance = tokenToBnb
        ? await c.readContract({
            address: snap.token as Address,
            abi: tokenAbi,
            functionName: "allowance",
            args: [from, snap.pool as Address],
          })
        : 0n;
      notes.push(`${feeBps.toString()} bps`);
      return {
        ok: true,
        quote: finishQuote(snap, {
          action,
          from,
          to: snap.pool,
          calldata: data,
          valueWei: tokenToBnb ? "0" : parsed.wei.toString(),
          tokenWei: (tokenToBnb ? parsed.wei : out).toString(),
          bnbWei: (tokenToBnb ? out : parsed.wei).toString(),
          minOutWei: minOut.toString(),
          outUnit: tokenToBnb ? "bnb" : "token",
          needApprove: tokenToBnb && allowance < parsed.wei,
          approveTo: tokenToBnb ? snap.token : null,
          approveCalldata:
            tokenToBnb && allowance < parsed.wei
              ? encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [snap.pool as Address, parsed.wei] })
              : null,
          notes,
          blocked,
          fn: "swap(bool,uint256,uint256,uint256)",
          feeLabel: `${feeBps.toString()} bps`,
          slipNote: slipFor(action),
        }),
      };
    }

    if (action === "add") {
      const tokenParsed = parseAmount(body.token);
      if (!tokenParsed.ok) return tokenParsed;
      const bnbParsed = parseAmount(body.bnb);
      if (!bnbParsed.ok) return bnbParsed;
      if (curveSizeIssue(tokenParsed.wei) === "dust" || bnbParsed.wei < MIN_BNB) {
        return { ok: false, failure: failure("dust") };
      }
      const lpSupply = await c.readContract({ address: snap.pool as Address, abi: seatPoolAbi, functionName: "lpSupply" });
      let lpOut = 0n;
      if (lpSupply === 0n) {
        lpOut = sqrt(tokenParsed.wei * bnbParsed.wei);
        if (lpOut > 1000n) lpOut -= 1000n;
      } else {
        const fromToken = (tokenParsed.wei * lpSupply) / BigInt(snap.tokenReserve);
        const fromBnb = (bnbParsed.wei * lpSupply) / BigInt(snap.bnbReserve);
        lpOut = fromToken < fromBnb ? fromToken : fromBnb;
      }
      const minLp = lpOut > 100n ? (lpOut * 99n) / 100n : lpOut;
      let blocked = identityBlock(snap, bnbParsed.wei);
      if (!blocked && tokenParsed.wei > BigInt(snap.tokenBal)) blocked = failure("balance");
      const allowance = await c.readContract({
        address: snap.token as Address,
        abi: tokenAbi,
        functionName: "allowance",
        args: [from, snap.pool as Address],
      });
      const data = encodeFunctionData({
        abi: seatPoolAbi,
        functionName: "addLiquidity",
        args: [tokenParsed.wei, minLp, id],
      });
      return {
        ok: true,
        quote: finishQuote(snap, {
          action,
          from,
          to: snap.pool,
          calldata: data,
          valueWei: bnbParsed.wei.toString(),
          tokenWei: tokenParsed.wei.toString(),
          bnbWei: bnbParsed.wei.toString(),
          minOutWei: minLp.toString(),
          outUnit: "share",
          needApprove: allowance < tokenParsed.wei,
          approveTo: snap.token,
          approveCalldata:
            allowance < tokenParsed.wei
              ? encodeFunctionData({
                  abi: tokenAbi,
                  functionName: "approve",
                  args: [snap.pool as Address, tokenParsed.wei],
                })
              : null,
          notes,
          blocked,
          fn: "addLiquidity(uint256,uint256,uint256)",
          feeLabel: "—",
          slipNote: slipFor(action),
        }),
      };
    }

    const shareText = (body.lp ?? "").trim();
    const share = shareText === "" ? BigInt(snap.lp) : /^\d+$/.test(shareText) ? BigInt(shareText) : null;
    if (share === null || share === 0n) return { ok: false, failure: failure(share === 0n ? "zero" : "bad-amount") };
    if (!snap.poolOpen) return { ok: false, failure: failure("no-liquidity") };
    const lpSupply = await c.readContract({ address: snap.pool as Address, abi: seatPoolAbi, functionName: "lpSupply" });
    const tokenOut = (share * BigInt(snap.tokenReserve)) / lpSupply;
    const bnbOut = (share * BigInt(snap.bnbReserve)) / lpSupply;
    if (tokenOut === 0n || bnbOut === 0n) return { ok: false, failure: failure("no-liquidity") };
    let minToken = (tokenOut * 99n) / 100n;
    let minBnb = (bnbOut * 99n) / 100n;
    if (minToken === 0n) minToken = 1n;
    if (minBnb === 0n) minBnb = 1n;
    let blocked = identityBlock(snap, 0n);
    if (!blocked && share > BigInt(snap.lp)) blocked = failure("balance");
    const data = encodeFunctionData({
      abi: seatPoolAbi,
      functionName: "removeLiquidity",
      args: [share, minToken, minBnb, id],
    });
    return {
      ok: true,
      quote: finishQuote(snap, {
        action,
        from,
        to: snap.pool,
        calldata: data,
        valueWei: "0",
        tokenWei: tokenOut.toString(),
        bnbWei: bnbOut.toString(),
        minOutWei: share.toString(),
        outUnit: "share",
        needApprove: false,
        approveTo: null,
        approveCalldata: null,
        notes,
        blocked,
        fn: "removeLiquidity(uint256,uint256,uint256,uint256)",
        feeLabel: "—",
        slipNote: slipFor(action),
      }),
    };
  } catch (err) {
    return { ok: false, failure: failureForRevert(named(err)) };
  }
}

function named(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/([A-Za-z]+)\(\)/);
  return match ? match[1] : null;
}

function sqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (value / x + x) / 2n;
  }
  return x;
}

export async function checkSeatReceipt(hashRaw: string): Promise<ReceiptCheck> {
  const hash = hashRaw.trim();
  if (!isHash(hash)) return { ok: false, failure: failure("bad-hash") };
  const opened = readFile();
  if ("failure" in opened) return { ok: false, failure: opened.failure };
  const file = opened.file;
  const local = file.rpc.includes("127.0.0.1");
  const c = clientOf(file.rpc);
  try {
    const receipt = await c.getTransactionReceipt({ hash });
    if (!receipt) return { ok: false, failure: failure("no-receipt") };
    const to = receipt.to ? getAddress(receipt.to) : "";
    const targets = [file.book, file.token, file.pool].filter((item) => !blank(item)).map((item) => getAddress(item));
    if (!to || !targets.includes(to)) return { ok: false, failure: failure("wrong-to") };
    if (receipt.status !== "success") return { ok: false, failure: failure("seat-revert") };
    let title = "这笔成功了";
    let body = "回执状态是成功。";
    let tokenWei: string | null = null;
    let bnbWei: string | null = null;
    let action: Action = "seat";
    for (const log of receipt.logs) {
      const decoded = decodeOne(log);
      if (!decoded) continue;
      if (decoded.eventName === "SeatTaken") {
        action = "seat";
        title = "核对成功";
        tokenWei = WAD.toString();
        bnbWei = asBig(decoded.args.price).toString();
        body = `铸出 ${formatToken(WAD.toString())}。支付 ${formatBnb(bnbWei)}，其中打进死地址 ${formatBnb(asBig(decoded.args.burned).toString())}。卖回不退这笔溢价。`;
      } else if (decoded.eventName === "Sold") {
        action = "sell";
        title = "卖回已入账";
        tokenWei = asBig(decoded.args.amount).toString();
        bnbWei = asBig(decoded.args.refund).toString();
        body = `退回 ${formatBnb(bnbWei)}。这是曲线积分，不是入席时的全部支付。席位没有还回来。`;
      } else if (decoded.eventName === "Swapped") {
        action = "swap";
        title = "兑换已入账";
        const tokenToBnb = decoded.args.tokenToBnb === true;
        tokenWei = asBig(tokenToBnb ? decoded.args.amountIn : decoded.args.amountOut).toString();
        bnbWei = asBig(tokenToBnb ? decoded.args.amountOut : decoded.args.amountIn).toString();
        body = `这一笔按 ${asBig(decoded.args.feeBps).toString()} bps 成交。`;
      } else if (decoded.eventName === "LiquidityAdded") {
        action = "add";
        title = "入池已入账";
        tokenWei = asBig(decoded.args.tokenAmount).toString();
        bnbWei = asBig(decoded.args.bnbAmount).toString();
        body = "份额记在你的地址上，不能转给别人。取出时按份额拿回两侧储备。";
      } else if (decoded.eventName === "LiquidityRemoved") {
        action = "remove";
        title = "出池已入账";
        tokenWei = asBig(decoded.args.tokenAmount).toString();
        bnbWei = asBig(decoded.args.bnbAmount).toString();
        body = "按份额拿回的代币和 BNB 已经记到付款人。";
      }
    }
    if (local) body = `${body} 这是当前节点上的回执。`;
    return {
      ok: true,
      hash,
      from: getAddress(receipt.from),
      to,
      action,
      title,
      body,
      tokenWei,
      bnbWei,
      remaining: null,
      mintedOf: null,
      scan: local ? "" : `https://bscscan.com/tx/${hash}`,
    };
  } catch {
    return { ok: false, failure: failure("no-receipt") };
  }
}

function decodeOne(log: { address: Address; data: Hex; topics: [] | [Hex, ...Hex[]] }): {
  eventName: string;
  args: Record<string, unknown>;
} | null {
  for (const abi of [seatBookAbi, seatPoolAbi, tokenAbi]) {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      const args = decoded.args;
      return {
        eventName: decoded.eventName,
        args: args && typeof args === "object" ? (args as Record<string, unknown>) : {},
      };
    } catch {
      continue;
    }
  }
  return null;
}
