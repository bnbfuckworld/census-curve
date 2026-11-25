"use client";

import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { registryAbi } from "@/lib/abi";
import { withBase } from "@/lib/basePath";
import { failure } from "@/lib/copy";
import { REGISTRY } from "@/lib/economics";
import { formatExact } from "@/lib/format";
import { previewSlip, type PreviewSlip } from "@/lib/plain";
import type { Action, DeskPayload, Failure, QuoteDTO, QuoteResponse, ReceiptCheck, Who } from "@/lib/types";
import { CurveChart } from "./CurveChart";
import { Foot } from "./Foot";
import { Ledger, type BookMode } from "./Ledger";
import { Mark } from "./Mark";
import { Ticket, EMPTY, type TicketModel } from "./Ticket";

const HOLDER: Who = "lin";

const ACTIONS: { action: Action; label: string; verb: string }[] = [
  { action: "mint", label: "铸", verb: "铸造" },
  { action: "sell", label: "卖", verb: "卖回" },
  { action: "swap", label: "换", verb: "兑换" },
  { action: "add", label: "入", verb: "加入" },
  { action: "remove", label: "出", verb: "取出" },
];

const UNOPENED: PreviewSlip = {
  what: "100 枚 · 约 5.1 BNB",
  look: "地址空",
  after: "签名",
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

function modeOf(copying: boolean, desk: DeskPayload | null): BookMode {
  if (!desk) return copying ? "loading" : "offline";
  if (!desk.attached) {
    if (desk.reason === "unopened") return "empty";
    if (desk.reason === "stale") return "stale";
    if (desk.reason === "wrong-chain") return "wrong";
    if (desk.reason === "refused-file") return "refused";
    return "offline";
  }
  return "live";
}

export function Desk({ initialDesk = null }: { initialDesk?: DeskPayload | null }) {
  const [desk, setDesk] = useState<DeskPayload | null>(initialDesk);
  const [copying, setCopying] = useState(!initialDesk);
  const [nonce, setNonce] = useState(0);
  const [tokenAmt, setTokenAmt] = useState("1");
  const [bnbAmt, setBnbAmt] = useState("0.01");
  const [lpAmt, setLpAmt] = useState("");
  const [tokenToBnb, setTokenToBnb] = useState(false);
  const [lastAction, setLastAction] = useState<Action>("mint");
  const [ticket, setTicket] = useState<TicketModel>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  const [accountDraft, setAccountDraft] = useState("");
  const [receiptHash, setReceiptHash] = useState("");
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptCheck | null>(null);
  const [injectAvailable, setInjectAvailable] = useState(false);
  const [injectBusy, setInjectBusy] = useState(false);
  const [injectError, setInjectError] = useState<Failure | null>(null);

  const refresh = useCallback(async () => {
    setCopying(true);
    try {
      const query = account ? `&account=${encodeURIComponent(account)}` : "";
      const res = await fetch(withBase(`/api/desk?who=${HOLDER}${query}`), { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as DeskPayload | null;
      if (!res.ok || !data || data.live !== false) {
        setDesk(null);
      } else {
        setDesk(data);
      }
    } catch {
      setDesk(null);
    } finally {
      setCopying(false);
    }
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh, nonce]);

  useEffect(() => {
    setInjectAvailable(Boolean(ethereum()));
  }, []);

  const mode = modeOf(copying, desk);
  const quotaClosed = Boolean(desk?.book?.eligible && desk.book.remaining === "0");

  async function postQuote(action: Action): Promise<QuoteResponse> {
    const res = await fetch(withBase("/api/desk/quote"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        who: HOLDER,
        action,
        token: tokenAmt,
        bnb: bnbAmt,
        lp: lpAmt,
        tokenToBnb,
        account: account || undefined,
      }),
    });
    const data = (await res.json().catch(() => null)) as QuoteResponse | null;
    if (!data) return { ok: false, failure: failure("page-broke") };
    return data;
  }

  async function onSeal(action: Action) {
    setLastAction(action);
    setReceipt(null);
    if (!desk) {
      setTicket({
        kind: copying ? "loading" : "failure",
        ...(copying ? { label: "读取" } : { failure: failure("offline") }),
      } as TicketModel);
      return;
    }
    if (!desk.attached) {
      setTicket({ kind: "failure", failure: desk.failure ?? failure(desk.reason ?? "offline") });
      return;
    }
    setBusy(true);
    setTicket({ kind: "loading", label: "报价" });
    try {
      const data = await postQuote(action);
      if (!data.ok) setTicket({ kind: "failure", failure: data.failure });
      else setTicket({ kind: "quote", quote: data.quote });
    } catch {
      setTicket({ kind: "failure", failure: failure("offline") });
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    if (!desk?.attached) {
      setTicket({ kind: "preview", slip: UNOPENED });
      return;
    }
    setBusy(true);
    setTicket({ kind: "loading", label: "预览" });
    try {
      const data = await postQuote(lastAction);
      if (!data.ok) {
        setTicket({
          kind: "preview",
          slip: {
            what: data.failure.title,
            look: data.failure.body,
            after: data.failure.next,
          },
        });
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
      const res = await fetch(withBase("/api/desk/receipt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash, account: account || undefined }),
      });
      const data = (await res.json().catch(() => null)) as ReceiptCheck | null;
      if (!data) {
        setReceipt({ ok: false, failure: failure("page-broke") });
        return;
      }
      setReceipt(data);
      if (data.ok) {
        setTicket({ kind: "receipt", receipt: data });
        setNonce((n) => n + 1);
      }
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
      if (!accounts?.[0]) {
        setInjectError(failure("rejected"));
        return;
      }
      const from = accounts[0];
      const switched = await (async () => {
        const hex = (await wallet.request({ method: "eth_chainId" })) as string;
        if (Number(hex) === 56) return true;
        try {
          await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
          return true;
        } catch {
          return false;
        }
      })();
      if (!switched) {
        setInjectError(failure("wrong-chain"));
        return;
      }
      const registry = desk?.registry || REGISTRY;
      const data = encodeFunctionData({
        abi: registryAbi,
        functionName: "balanceOf",
        args: [from as `0x${string}`],
      });
      const raw = (await wallet.request({ method: "eth_call", params: [{ to: registry, data }, "latest"] })) as string;
      if (BigInt(raw) === 0n) {
        setInjectError(failure("no-agent"));
        return;
      }
      if (quote.needApprove && quote.approveTo && quote.approveCalldata) {
        const approveHash = (await wallet.request({
          method: "eth_sendTransaction",
          params: [{ from, to: quote.approveTo, data: quote.approveCalldata, value: "0x0" }],
        })) as string;
        const approveStatus = await waitReceipt(wallet, approveHash);
        if (approveStatus === "fail") {
          setInjectError(failure("receipt-fail"));
          setReceiptHash(approveHash);
          return;
        }
        if (approveStatus === "lost") {
          setInjectError(failure("send-lost"));
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
        setAccountDraft(from);
      }
      const status = await waitReceipt(wallet, hash);
      if (status === "fail") {
        setInjectError(failure("receipt-fail"));
        return;
      }
      await onCheckReceipt(hash);
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (message.includes("insufficient") || message.includes("funds")) setInjectError(failure("gas"));
      else if (message.includes("reject") || message.includes("denied")) setInjectError(failure("rejected"));
      else setInjectError(failure("send-lost"));
    } finally {
      setInjectBusy(false);
    }
  }

  function edit(apply: () => void) {
    apply();
    setTicket((current) => (current.kind === "quote" || current.kind === "failure" ? EMPTY : current));
    setReceipt(null);
  }

  const quoted = ticket.kind === "quote" && ticket.quote.action === lastAction;
  const verb = ACTIONS.find((item) => item.action === lastAction)?.verb ?? "报价";
  const empty = mode === "empty";
  const mintClosed = lastAction === "mint" && quotaClosed;
  let buttonLabel = verb;
  if (empty) buttonLabel = "尚未接入现网";
  else if (mintClosed) buttonLabel = "铸额已尽";
  else if (quoted) buttonLabel = "重新报价";

  return (
    <main className="frame" aria-busy={busy || copying}>
      <header className="top">
        <a className="brand" href={withBase("/")}>
          <Mark />
          <span>Census Curve</span>
        </a>
        <nav className="nav">
          <a href="https://x.com/censuscurve" target="_blank" rel="noreferrer">
            官号
          </a>
          <button type="button" disabled={busy} onClick={() => void onPreview()}>
            预览
          </button>
          <a href={withBase("/seat")}>第二册</a>
          <a href={withBase("/rights")}>权限说明</a>
          <a href={withBase("/deploy")}>部署</a>
        </nav>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">CENSUS CURVE</p>
            <h1>只给 Agent ID 的链上发行</h1>
            <dl className="facts">
            <div>
              <dt>起价</dt>
              <dd className="num">0.001 BNB</dd>
            </div>
            <div>
              <dt>每枚</dt>
              <dd className="num">+0.001 BNB</dd>
            </div>
            <div>
              <dt>首册</dt>
              <dd className="num">100 枚</dd>
            </div>
            <div>
              <dt>链</dt>
              <dd>BNB Chain</dd>
            </div>
          </dl>
        </div>
        <CurveChart supplyWei={desk?.book?.supply ?? "0"} />
      </section>
      <section className="trade" aria-label="交易">
        <div className="segments" role="tablist" aria-label="动作">
          {ACTIONS.map((item) => (
            <button
              key={item.action}
              type="button"
              role="tab"
              aria-selected={lastAction === item.action}
              onClick={() => {
                setLastAction(item.action);
                setTicket(EMPTY);
                setReceipt(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="trade-grid">
          <div className="order-col">
            <Ledger
              desk={desk}
              mode={mode}
              action={lastAction}
              tokenAmt={tokenAmt}
              bnbAmt={bnbAmt}
              lpAmt={lpAmt}
              tokenToBnb={tokenToBnb}
              onToken={(value) => edit(() => setTokenAmt(value))}
              onBnb={(value) => edit(() => setBnbAmt(value))}
              onLp={(value) => edit(() => setLpAmt(value))}
              onDirection={(value) => edit(() => setTokenToBnb(value))}
              onAllToken={() => {
                const book = desk?.book;
                if (!book?.eligible) return;
                edit(() => setTokenAmt(formatExact(book.remaining)));
              }}
              onAllLp={() => {
                const book = desk?.book;
                if (!book) return;
                if (book.lp === "0") {
                  setTicket({ kind: "failure", failure: failure("balance", "没有内部份额可填") });
                  return;
                }
                edit(() => setLpAmt(book.lp));
              }}
            />
            <p className="risk">
              可能亏损、不承诺收益。 <a href={withBase("/rights")}>权限说明</a>
            </p>
            <button
              type="button"
              className="btn primary go"
              disabled={busy || empty || mintClosed}
              onClick={() => void onSeal(lastAction)}
            >
              {buttonLabel}
            </button>
            {desk?.attached ? (
              <label className="lookup">
                查阅地址
                <span className="inline">
                  <input
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="查阅地址"
                    value={accountDraft}
                    placeholder={desk.identities[0]?.address || "0x"}
                    onChange={(event) => setAccountDraft(event.target.value.trim())}
                  />
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      if (!accountDraft) return;
                      setAccount(accountDraft);
                      setNonce((n) => n + 1);
                    }}
                  >
                    读取
                  </button>
                </span>
              </label>
            ) : null}
          </div>
          <Ticket
            model={ticket}
            receiptHash={receiptHash}
            receiptBusy={receiptBusy}
            receipt={receipt}
            injectAvailable={injectAvailable}
            injectBusy={injectBusy}
            injectError={injectError}
            risk=""
            onReceiptHash={setReceiptHash}
            onCheckReceipt={() => void onCheckReceipt()}
            onInjectedSend={() => void onInjectedSend()}
            onReset={() => {
              setTicket(EMPTY);
              setReceipt(null);
              setInjectError(null);
            }}
          />
        </div>
      </section>
      <Foot
        factory={desk?.local?.factory}
        token={desk?.local?.token}
        curve={desk?.local?.curve}
        pool={desk?.local?.pool}
      />
    </main>
  );
}
