"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, getAddress, isAddress } from "viem";
import { withBase } from "@/lib/basePath";
import { failure } from "@/lib/copy";
import { REGISTRY } from "@/lib/economics";
import { formatBnb } from "@/lib/format";
import { previewSlip } from "@/lib/plain";
import { ownerOfAbi } from "@/lib/seatAbi";
import { PHASE_LABEL, type SeatPhase } from "@/lib/seatPhase";
import type { SeatSnapshot } from "@/lib/seatTypes";
import { SEAT_RISK } from "@/lib/sign";
import type { Action, Failure, QuoteDTO, QuoteResponse, ReceiptCheck } from "@/lib/types";
import { Foot } from "./Foot";
import { Mark } from "./Mark";
import { EMPTY, Ticket, type TicketModel } from "./Ticket";

const SEAT_RISK_SHORT = "溢价不退、可能亏损、不承诺收益。";

const ACTIONS: { action: Action; label: string }[] = [
  { action: "seat", label: "入席" },
  { action: "sell", label: "卖回" },
  { action: "swap", label: "兑换" },
  { action: "add", label: "入池" },
  { action: "remove", label: "出池" },
];

const SEAT_BUTTON: Partial<Record<SeatPhase, string>> = {
  unopened: "尚未接入现网",
  offline: "读取停住了",
  refused: "登记被拒绝",
  "wrong-chain": "链号不对",
  stale: "地址上没有合约",
  guard: "保护期未结束",
  taken: "本窗已满",
  full: "名册已满",
  seated: "已经入席",
  "no-agent": "没有 Agent ID",
  "not-owner": "不是这个地址的 Agent ID",
  "empty-handle": "句柄是空的",
  "no-book": "册还没开",
  "wrong-book": "参数对不上",
};

type Wallet = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function ethereum(): Wallet | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: Wallet }).ethereum;
  return eth ?? null;
}

function qty(wei: string): string {
  const n = BigInt(wei);
  return n === 0n ? "0x0" : "0x" + n.toString(16);
}

function money(attached: boolean, wei: string): string {
  return attached && wei !== "" ? formatBnb(wei) : "—";
}

function shortId(hex: string): string {
  if (!hex) return "—";
  return hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

function shortAddr(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function BlockRail({ snap }: { snap: SeatSnapshot }) {
  const guard = snap.attached && !snap.open;
  const total = guard ? 16 : 160;
  const left = snap.attached && snap.blocksLeft !== "" ? Number(snap.blocksLeft) : null;
  const current = left === null ? -1 : Math.min(total - 1, Math.max(0, total - left));
  const cells = Array.from({ length: total }, (_, index) => {
    if (current < 0) return "wait";
    if (index < current) return "past";
    if (index === current) return "now";
    return "wait";
  });
  const caption = snap.attached ? "已过 · 当前 · 未到" : "—";
  return (
    <div className="seat-rail">
      <div
        className={guard ? "block-rail is-guard" : "block-rail"}
        role="img"
        aria-label={caption}
      >
        {cells.map((kind, index) => (
          <span key={index} className={`block-cell is-${kind}`} />
        ))}
      </div>
      <p className="hint">{caption}</p>
    </div>
  );
}

function DutchCurve({ snap }: { snap: SeatSnapshot }) {
  if (!snap.attached || !snap.floor || snap.floor === "0") {
    return <p className="hint">—</p>;
  }
  const width = 280;
  const height = 112;
  const left = 4;
  const right = 4;
  const top = 22;
  const bottom = 18;
  const span = 159;
  const elapsed = snap.open ? Math.min(span, Math.max(0, Number(snap.elapsed || "0"))) : 0;
  const xOf = (step: number) => left + (step / span) * (width - left - right);
  const yOf = (step: number) => {
    const ratio = (2 * span - step) / span;
    return top + (2 - ratio) * (height - top - bottom);
  };
  const points = Array.from({ length: span + 1 }, (_, step) => `${xOf(step).toFixed(2)},${yOf(step).toFixed(2)}`).join(" ");
  const nx = xOf(elapsed);
  const ny = yOf(elapsed);
  const label = snap.open ? "现在" : "开窗";
  const labelX = elapsed > 110 ? nx - 6 : nx + 6;
  const anchor = elapsed > 110 ? "end" : "start";
  return (
    <figure className="dutch">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="价格曲线">
        <polyline points={points} fill="none" stroke="#F0B90B" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <circle cx={nx} cy={ny} r="2.4" fill="#F0B90B" />
        <text x={labelX} y={Math.max(12, ny - 6)} textAnchor={anchor} fill="#F0B90B" fontSize="11">
          {label}
        </text>
        <text x={width - right} y={yOf(span) - 6} textAnchor="end" fill="#8a8a8a" fontSize="11">
          {formatBnb(snap.floor)}
        </text>
      </svg>
    </figure>
  );
}

export function SeatDesk({
  initial,
  initialTicket,
  initialReceipt = null,
  initialAccount = "",
  initialAgentId = "",
  initialHash = "",
}: {
  initial: SeatSnapshot;
  initialTicket?: TicketModel;
  initialReceipt?: ReceiptCheck | null;
  initialAccount?: string;
  initialAgentId?: string;
  initialHash?: string;
}) {
  const [snap, setSnap] = useState(initial);
  const [account, setAccount] = useState(initialAccount);
  const [agentId, setAgentId] = useState(initialAgentId);
  const [draftAccount, setDraftAccount] = useState(initialAccount);
  const [draftAgent, setDraftAgent] = useState(initialAgentId);
  const [action, setAction] = useState<Action>("seat");
  const [tokenAmt, setTokenAmt] = useState("1");
  const [bnbAmt, setBnbAmt] = useState("0.01");
  const [lpAmt, setLpAmt] = useState("");
  const [tokenToBnb, setTokenToBnb] = useState(false);
  const [ticket, setTicket] = useState<TicketModel>(initialTicket ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [receiptHash, setReceiptHash] = useState(initialHash);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptCheck | null>(initialReceipt);
  const [injectAvailable, setInjectAvailable] = useState(false);
  const [injectBusy, setInjectBusy] = useState(false);
  const [injectError, setInjectError] = useState<Failure | null>(null);

  useEffect(() => {
    setInjectAvailable(Boolean(ethereum()));
  }, []);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const query = new URLSearchParams();
        if (account) query.set("account", account);
        if (agentId) query.set("agentId", agentId);
        const res = await fetch(withBase(`/api/seat?${query.toString()}`), { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as SeatSnapshot | null;
        if (!stop && data && typeof data.phase === "string") setSnap(data);
      } catch {
        if (!stop) setSnap((prev) => ({ ...prev, phase: prev.attached ? prev.phase : "offline" }));
      }
    }
    const timer = window.setInterval(() => void pull(), 2000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [account, agentId]);

  useEffect(() => {
    if (ticket.kind !== "quote" || ticket.quote.action !== "seat" || ticket.quote.blocked) return;
    if (!snap.attached) return;
    if (snap.phase === "taken" || snap.phase === "seated" || snap.phase === "full") {
      setTicket({ kind: "failure", failure: failure("sniped") });
      return;
    }
    if (snap.phase === "open" && snap.price && BigInt(snap.price) > BigInt(ticket.quote.valueWei)) {
      setTicket({ kind: "failure", failure: failure("stale-quote") });
    }
  }, [snap, ticket]);

  async function postQuote(next: Action): Promise<QuoteResponse> {
    const res = await fetch(withBase("/api/seat/quote"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: next,
        account: account || undefined,
        agentId: agentId || undefined,
        token: tokenAmt,
        bnb: bnbAmt,
        lp: lpAmt,
        tokenToBnb,
      }),
    });
    const data = (await res.json().catch(() => null)) as QuoteResponse | null;
    if (!data) return { ok: false, failure: failure("page-broke") };
    return data;
  }

  async function onQuote() {
    setReceipt(null);
    setBusy(true);
    setTicket({ kind: "loading", label: "报价" });
    try {
      const data = await postQuote(action);
      setTicket(data.ok ? { kind: "quote", quote: data.quote } : { kind: "failure", failure: data.failure });
    } catch {
      setTicket({ kind: "failure", failure: failure("offline") });
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    setBusy(true);
    setTicket({ kind: "loading", label: "预览" });
    try {
      const data = await postQuote(action);
      if (!data.ok) {
        setTicket({ kind: "preview", slip: { what: data.failure.title, look: data.failure.body, after: data.failure.next } });
      } else {
        setTicket({ kind: "preview", slip: previewSlip(data.quote) });
      }
    } catch {
      setTicket({ kind: "failure", failure: failure("offline") });
    } finally {
      setBusy(false);
    }
  }

  async function onCheckReceipt(hash = receiptHash) {
    if (!hash) return;
    setReceiptBusy(true);
    try {
      const res = await fetch(withBase("/api/seat/receipt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash }),
      });
      const data = (await res.json().catch(() => null)) as ReceiptCheck | null;
      if (!data) {
        setReceipt({ ok: false, failure: failure("page-broke") });
        return;
      }
      setReceipt(data);
      if (data.ok) setTicket({ kind: "receipt", receipt: data });
    } catch {
      setReceipt({ ok: false, failure: failure("offline") });
    } finally {
      setReceiptBusy(false);
    }
  }

  async function waitReceipt(wallet: Wallet, hash: string): Promise<"success" | "fail" | "lost"> {
    for (let i = 0; i < 40; i++) {
      const got = (await wallet.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null)) as
        | { status?: string }
        | null;
      if (got) return got.status === "0x1" ? "success" : "fail";
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return "lost";
  }

  async function onInjectedSend() {
    if (ticket.kind !== "quote" || ticket.quote.blocked) return;
    const quote: QuoteDTO = ticket.quote;
    const wallet = ethereum();
    if (!wallet) {
      setInjectError(failure("offline"));
      return;
    }
    setInjectBusy(true);
    setInjectError(null);
    try {
      const accounts = (await wallet.request({ method: "eth_requestAccounts" }).catch(() => null)) as string[] | null;
      if (!accounts?.[0] || !isAddress(accounts[0])) {
        setInjectError(failure("rejected"));
        return;
      }
      const from = getAddress(accounts[0]);
      const hex = (await wallet.request({ method: "eth_chainId" })) as string;
      if (Number(hex) !== 56) {
        try {
          await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
        } catch {
          setInjectError(failure("wrong-chain"));
          return;
        }
      }
      const balData = encodeFunctionData({ abi: ownerOfAbi, functionName: "balanceOf", args: [from] });
      const rawBal = (await wallet.request({ method: "eth_call", params: [{ to: REGISTRY, data: balData }, "latest"] })) as string;
      if (BigInt(rawBal) === 0n) {
        setInjectError(failure("no-agent"));
        return;
      }
      if (quote.action === "seat" && agentId) {
        const id = BigInt(agentId.startsWith("0x") || /^\d+$/.test(agentId) ? agentId : snap.agentId || "0");
        if (id > 0n) {
          const ownData = encodeFunctionData({ abi: ownerOfAbi, functionName: "ownerOf", args: [id] });
          const rawOwn = (await wallet
            .request({ method: "eth_call", params: [{ to: REGISTRY, data: ownData }, "latest"] })
            .catch(() => null)) as string | null;
          if (!rawOwn) {
            setInjectError(failure("not-owner"));
            return;
          }
          const owner = getAddress(`0x${rawOwn.slice(-40)}`);
          if (owner !== from) {
            setInjectError(failure("not-owner"));
            return;
          }
        }
      }
      if (quote.needApprove && quote.approveTo && quote.approveCalldata) {
        const approveHash = (await wallet.request({
          method: "eth_sendTransaction",
          params: [{ from, to: quote.approveTo, data: quote.approveCalldata, value: "0x0" }],
        })) as string;
        const approveStatus = await waitReceipt(wallet, approveHash);
        if (approveStatus !== "success") {
          setInjectError(failure(approveStatus === "fail" ? "receipt-fail" : "send-lost"));
          setReceiptHash(approveHash);
          return;
        }
      }
      const hash = (await wallet.request({
        method: "eth_sendTransaction",
        params: [{ from, to: quote.to, data: quote.calldata, value: qty(quote.valueWei) }],
      })) as string;
      setReceiptHash(hash);
      if (from.toLowerCase() !== account.toLowerCase()) {
        setAccount(from);
        setDraftAccount(from);
      }
      const status = await waitReceipt(wallet, hash);
      if (status === "fail") {
        setInjectError(failure("seat-revert"));
        return;
      }
      if (status === "lost") {
        setInjectError(failure("send-lost"));
        return;
      }
      await onCheckReceipt(hash);
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (message.includes("insufficient") || message.includes("funds")) setInjectError(failure("balance"));
      else if (message.includes("reject") || message.includes("denied")) setInjectError(failure("rejected"));
      else setInjectError(failure("send-lost"));
    } finally {
      setInjectBusy(false);
    }
  }

  const quoted = ticket.kind === "quote" && ticket.quote.action === action && !ticket.quote.blocked;
  const seatClosed = action === "seat" && snap.phase !== "open";
  const buttonLabel = seatClosed ? (SEAT_BUTTON[snap.phase] ?? "现在不能入席") : quoted ? "重新报价" : (ACTIONS.find((item) => item.action === action)?.label ?? "报价");
  const leftHead = !snap.open ? "开窗第一块" : snap.windowFree ? "现在付" : "本窗已满";

  return (
    <main className="frame" aria-busy={busy}>
      <header className="top">
        <a className="brand" href={withBase("/")}>
          <Mark />
          <span>Census Curve</span>
        </a>
        <nav className="nav">
          <a href={withBase("/")}>第一册</a>
          <button type="button" disabled={busy} onClick={() => void onPreview()}>
            预览
          </button>
          <a href={withBase("/rights")}>权限说明</a>
        </nav>
      </header>

      <section className="hero seat-hero">
        <div className="hero-copy">
          <p className="kicker">第二册</p>
          <h1>一轮一席</h1>
        </div>
        <div className="clock" data-phase={snap.phase}>
          <p className="kicker">剩余</p>
          <p className="clock-num">{snap.attached ? snap.blocksLeft : "—"}</p>
          <p className="clock-sub">块 · 约 {snap.attached ? snap.secondsLeft : "—"} 秒</p>
          <p className="status-line">
            <span>{PHASE_LABEL[snap.phase]}</span>
            <span className="num">{snap.attached ? `第 ${snap.window} 窗 · ${snap.filled} / ${snap.cap}` : "—"}</span>
          </p>
        </div>
        <BlockRail snap={snap} />
        <dl className="seat-facts">
          <div>
            <dt>地板起价</dt>
            <dd className="num">0.0015 BNB</dd>
          </div>
          <div>
            <dt>窗口</dt>
            <dd className="num">160 块</dd>
          </div>
          <div>
            <dt>开册保护</dt>
            <dd className="num">16 块</dd>
          </div>
          <div>
            <dt>一册</dt>
            <dd className="num">100 席</dd>
          </div>
        </dl>
      </section>

      <section className="seat-grid" aria-label="席位">
        <div className="seat-main">
          {snap.blockNumber ? <p className="hint num">区块 {snap.blockNumber}</p> : null}
          <div className="price-row">
          <table className="compare">
            <thead>
              <tr>
                <th>对照</th>
                <th>{leftHead}</th>
                <th>本窗最后一块</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>价格</th>
                <td className="num">{money(snap.attached, snap.price)}</td>
                <td className="num">{money(snap.attached, snap.floor)}</td>
              </tr>
              <tr>
                <th>溢价</th>
                <td className="num">{money(snap.attached, snap.premium)}</td>
                <td className="num">{snap.attached ? formatBnb("0") : "—"}</td>
              </tr>
              <tr>
                <th>进入曲线</th>
                <td className="num">{money(snap.attached, snap.reserveIn)}</td>
                <td className="num">{money(snap.attached, snap.reserveIn)}</td>
              </tr>
              <tr>
                <th>打入死地址</th>
                <td className="num">{money(snap.attached, snap.burn)}</td>
                <td className="num">{money(snap.attached, snap.lastBurn)}</td>
              </tr>
            </tbody>
          </table>
          <DutchCurve snap={snap} />
          </div>
          <p className="hint num">{snap.attached ? `${snap.priorSwaps} · ${snap.feeBps} bps` : "—"}</p>
          {snap.windowTaker ? (
            <p className="hint">
              {snap.windowHandle || shortId(snap.windowAgentId)} ·{" "}
              <a href={`https://bscscan.com/address/${snap.windowTaker}`} target="_blank" rel="noreferrer">
                {shortAddr(snap.windowTaker)}
              </a>
            </p>
          ) : (
            <p className="hint">空</p>
          )}

          <form
            className="form lookup"
            onSubmit={(event) => {
              event.preventDefault();
              setAccount(draftAccount.trim());
              setAgentId(draftAgent.trim());
              setTicket(EMPTY);
              setReceipt(null);
            }}
          >
            <label>
              付款地址
              <input
                value={draftAccount}
                onChange={(event) => setDraftAccount(event.target.value)}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                aria-label="付款地址"
              />
            </label>
            <label>
              Agent ID 编号（可不填，查地址时自动带出）
              <input
                value={draftAgent}
                onChange={(event) => setDraftAgent(event.target.value)}
                placeholder="十进制或 0x"
                autoComplete="off"
                spellCheck={false}
                aria-label="Agent ID"
              />
            </label>
            <button type="submit" className="btn">
              查询
            </button>
            {snap.account ? (
              <p className="hint">
                {snap.handle || "—"} · {formatBnb(snap.bnb)}
              </p>
            ) : null}
          </form>

          <div className="segments" role="tablist" aria-label="动作">
            {ACTIONS.map((item) => (
              <button
                key={item.action}
                type="button"
                role="tab"
                aria-selected={action === item.action}
                onClick={() => {
                  setAction(item.action);
                  setTicket(EMPTY);
                  setReceipt(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {action === "seat" ? <p className="hint">1 枚</p> : null}
          {action === "sell" ? (
            <label className="lookup">
              枚数
              <input value={tokenAmt} onChange={(event) => setTokenAmt(event.target.value)} inputMode="decimal" aria-label="卖回枚数" />
            </label>
          ) : null}
          {action === "swap" ? (
            <div className="form">
              <button type="button" className="linkish" onClick={() => setTokenToBnb((value) => !value)}>
                {tokenToBnb ? "卖出" : "换入"}
              </button>
              <label className="lookup">
                数量
                <input
                  value={tokenToBnb ? tokenAmt : bnbAmt}
                  onChange={(event) => (tokenToBnb ? setTokenAmt(event.target.value) : setBnbAmt(event.target.value))}
                  inputMode="decimal"
                  aria-label="兑换数量"
                />
              </label>
            </div>
          ) : null}
          {action === "add" ? (
            <div className="form">
              <label className="lookup">
                代币
                <input value={tokenAmt} onChange={(event) => setTokenAmt(event.target.value)} inputMode="decimal" aria-label="入池代币" />
              </label>
              <label className="lookup">
                BNB
                <input value={bnbAmt} onChange={(event) => setBnbAmt(event.target.value)} inputMode="decimal" aria-label="入池 BNB" />
              </label>
            </div>
          ) : null}
          {action === "remove" ? (
            <label className="lookup">
              份额
              <input value={lpAmt} onChange={(event) => setLpAmt(event.target.value)} inputMode="numeric" aria-label="取出份额" />
            </label>
          ) : null}

          <p className="risk">
            {SEAT_RISK_SHORT}{" "}
            <a href={withBase("/rights")}>权限说明</a>
          </p>
          <button type="button" className="btn primary go" disabled={busy || seatClosed} onClick={() => void onQuote()}>
            {buttonLabel}
          </button>
        </div>
        <Ticket
          model={ticket}
          receiptHash={receiptHash}
          receiptBusy={receiptBusy}
          receipt={receipt}
          injectAvailable={injectAvailable}
          injectBusy={injectBusy}
          injectError={injectError}
          onReceiptHash={setReceiptHash}
          onCheckReceipt={() => void onCheckReceipt()}
          onInjectedSend={() => void onInjectedSend()}
          onReset={() => {
            setTicket(EMPTY);
            setReceipt(null);
          }}
          risk=""
          guide
        />
      </section>

      <section className="roster-wrap" aria-label="名册">
        <p className="kicker">名册</p>
        {snap.roster.length === 0 ? (
          <p className="hint">空</p>
        ) : (
          <table className="roster">
            <thead>
              <tr>
                <th>Agent ID</th>
                <th>句柄</th>
                <th>付款人</th>
                <th>窗口</th>
                <th>支付</th>
                <th>块</th>
              </tr>
            </thead>
            <tbody>
              {snap.roster.map((row) => (
                <tr key={`${row.window}-${row.agentId}`}>
                  <td>
                    <a href={row.nft} target="_blank" rel="noreferrer">
                      {row.handle || shortId(row.agentIdHex)}
                    </a>
                  </td>
                  <td>{row.handle || "—"}</td>
                  <td>
                    <a href={row.takerScan} target="_blank" rel="noreferrer">
                      {shortAddr(row.taker)}
                    </a>
                  </td>
                  <td className="num">{row.window}</td>
                  <td className="num">{formatBnb(row.price)}</td>
                  <td className="num">{row.atBlock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Foot factory={snap.factory} token={snap.token} curve={snap.book} pool={snap.pool} curveLabel="席位册" risk={SEAT_RISK} />
    </main>
  );
}
