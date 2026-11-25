"use client";

import { useState } from "react";
import { formatBnb, formatExact, formatToken, formatWei } from "@/lib/format";
import type { PreviewSlip } from "@/lib/plain";
import { agentPrompt, bawExecuteHint, bawInstruction, TRADE_RISK } from "@/lib/sign";
import type { Failure, QuoteDTO, ReceiptCheck, ReceiptCheckOk } from "@/lib/types";

export type TicketModel =
  | { kind: "blank" }
  | { kind: "empty" }
  | { kind: "loading"; label: string }
  | { kind: "failure"; failure: Failure }
  | { kind: "quote"; quote: QuoteDTO }
  | { kind: "preview"; slip: PreviewSlip }
  | { kind: "receipt"; receipt: ReceiptCheckOk };

export const EMPTY: TicketModel = { kind: "blank" };

type TicketProps = {
  model: TicketModel;
  receiptHash: string;
  receiptBusy: boolean;
  receipt: ReceiptCheck | null;
  injectAvailable: boolean;
  injectBusy: boolean;
  injectError: Failure | null;
  onReceiptHash: (value: string) => void;
  onCheckReceipt: () => void;
  onInjectedSend: () => void;
  onReset: () => void;
  risk?: string;
  guide?: boolean;
};

export function Ticket({
  model,
  receiptHash,
  receiptBusy,
  receipt,
  injectAvailable,
  injectBusy,
  injectError,
  onReceiptHash,
  onCheckReceipt,
  onInjectedSend,
  onReset,
  risk = TRADE_RISK,
  guide = false,
}: TicketProps) {
  const headline =
    model.kind === "blank" || model.kind === "empty"
      ? "报价"
      : model.kind === "loading"
        ? model.label
        : model.kind === "preview"
          ? "预览"
          : model.kind === "failure"
            ? model.failure.title
            : model.kind === "receipt"
              ? model.receipt.title
              : model.quote.blocked
                ? model.quote.blocked.title
                : "签名";

  return (
    <article className="quote">
      <header>
        <p className="kicker">TICKET</p>
        <p>{headline}</p>
      </header>
      {model.kind === "blank" || model.kind === "empty" ? (
        <>
          {guide ? (
            <ol className="path-steps" aria-label="三步">
              <li>
                <span className="path-n">1</span>
                <span>查地址</span>
              </li>
              <li>
                <span className="path-n">2</span>
                <span>报价</span>
              </li>
              <li>
                <span className="path-n">3</span>
                <span>签名并回填哈希</span>
              </li>
            </ol>
          ) : null}
        </>
      ) : null}
      {model.kind === "preview" ? (
        <dl className="rows">
          <div>
            <dt>做什么</dt>
            <dd>{model.slip.what}</dd>
          </div>
          <div>
            <dt>怎么核</dt>
            <dd>{model.slip.look}</dd>
          </div>
          <div>
            <dt>之后</dt>
            <dd>{model.slip.after}</dd>
          </div>
        </dl>
      ) : null}
      {model.kind === "failure" ? (
        <section className="slip">
          <p>{model.failure.body}</p>
          <p className="hint">{model.failure.next}</p>
          {risk ? <p className="risk">{risk}</p> : null}
        </section>
      ) : null}
      {model.kind === "quote" ? <QuoteBody quote={model.quote} /> : null}
      {model.kind === "receipt" ? <CheckedBody result={model.receipt} risk={risk} /> : null}
      {model.kind === "quote" && !model.quote.blocked ? (
        <SignSlip
          risk={risk}
          quote={model.quote}
          receiptHash={receiptHash}
          receiptBusy={receiptBusy}
          receipt={receipt}
          injectAvailable={injectAvailable}
          injectBusy={injectBusy}
          injectError={injectError}
          onReceiptHash={onReceiptHash}
          onCheckReceipt={onCheckReceipt}
          onInjectedSend={onInjectedSend}
        />
      ) : null}
      {model.kind === "quote" && model.quote.blocked ? (
        <section className="slip">
          <p className="hint">{model.quote.blocked.body}</p>
          <p className="hint">{model.quote.blocked.next}</p>
          {risk ? <p className="risk">{risk}</p> : null}
        </section>
      ) : null}
      {model.kind !== "blank" && model.kind !== "empty" && model.kind !== "loading" ? (
        <button type="button" className="linkish" onClick={onReset}>
          清掉这张票
        </button>
      ) : null}
    </article>
  );
}

function QuoteBody({ quote }: { quote: QuoteDTO }) {
  return (
    <>
      <dl className="rows">
        <div>
          <dt>你付</dt>
          <dd>
            {quote.action === "mint" ||
            quote.action === "seat" ||
            (quote.action === "swap" && quote.valueWei !== "0") ||
            quote.action === "add"
              ? formatBnb(quote.valueWei)
              : formatToken(quote.tokenWei)}
          </dd>
        </div>
        <div>
          <dt>你得</dt>
          <dd>
            {quote.action === "mint" || quote.action === "seat" || quote.action === "add"
              ? formatToken(quote.tokenWei)
              : quote.action === "remove"
                ? `${formatToken(quote.tokenWei)} + ${formatBnb(quote.bnbWei)}`
                : formatBnb(quote.bnbWei)}
          </dd>
        </div>
        <div>
          <dt>单价</dt>
          <dd>{formatExact(quote.marginal, 18)} BNB</dd>
        </div>
        <div>
          <dt>手续费</dt>
          <dd>{quote.feeLabel ?? (quote.action === "mint" || quote.action === "sell" || quote.action === "seat" ? "—" : "0.3%")}</dd>
        </div>
      </dl>
      {quote.notes.length > 0 ? (
        <ul className="notes">
          {quote.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function CheckedBody({ result, risk }: { result: ReceiptCheckOk; risk: string }) {
  return (
    <section className="slip">
      <p>{result.body}</p>
      <p className="hint">
        付款人 {result.from}
        <br />
        合约 {result.to}
      </p>
      {result.scan.startsWith("http") ? (
        <p>
          <a href={result.scan} target="_blank" rel="noreferrer">
            在 BscScan 查看
          </a>
        </p>
      ) : null}
      {result.remaining !== null ? <p className="hint">剩余铸额 {formatToken(result.remaining)}</p> : null}
      {risk ? <p className="risk">{risk}</p> : null}
    </section>
  );
}

function SignSlip({
  quote,
  receiptHash,
  receiptBusy,
  receipt,
  injectAvailable,
  injectBusy,
  injectError,
  onReceiptHash,
  onCheckReceipt,
  onInjectedSend,
  risk,
}: {
  quote: QuoteDTO;
  risk: string;
  receiptHash: string;
  receiptBusy: boolean;
  receipt: ReceiptCheck | null;
  injectAvailable: boolean;
  injectBusy: boolean;
  injectError: Failure | null;
  onReceiptHash: (value: string) => void;
  onCheckReceipt: () => void;
  onInjectedSend: () => void;
}) {
  const instruction = bawInstruction(quote);
  const prompt = agentPrompt(quote);
  const execute = bawExecuteHint();
  return (
    <section className="slip" aria-label="去签名">
      <p className="kicker">去签名</p>
      <p className="hint">本站不会代跑。</p>
      <dl className="rows sign-rows">
        <div>
          <dt>目标合约</dt>
          <dd className="wire">{quote.to}</dd>
        </div>
        <div>
          <dt>应付价值</dt>
          <dd className="wire">
            {formatBnb(quote.valueWei)} · {formatWei(quote.valueWei)}
          </dd>
        </div>
        <div>
          <dt>函数</dt>
          <dd className="wire">{quote.fn}</dd>
        </div>
      </dl>
      {quote.needApprove && quote.approveTo && quote.approveCalldata ? (
        <CopyBlock label="授权 calldata" value={quote.approveCalldata} />
      ) : null}
      <CopyBlock label="calldata" value={quote.calldata} />
      <CopyBlock label="baw 预览命令" value={quote.baw} />
      <CopyBlock label="执行" value={execute} />
      <CopyBlock label="命令" value={instruction} />
      <CopyBlock label="代理" value={prompt} />
      {risk ? <p className="risk">{risk}</p> : null}
      {injectAvailable ? (
        <div className="sign-actions">
          <button type="button" className="btn ghost" disabled={injectBusy} onClick={onInjectedSend}>
            {injectBusy ? "等待" : "签名"}
          </button>
          {injectError ? <p className="hint">{injectError.title}</p> : null}
        </div>
      ) : null}
      <div className="receipt-box">
        <p className="kicker">我签好了</p>
        <label className="field">
          交易哈希
          <input
            value={receiptHash}
            onChange={(e) => onReceiptHash(e.target.value.trim())}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            aria-label="交易哈希"
          />
        </label>
        <button type="button" className="btn" disabled={receiptBusy || receiptHash.length === 0} onClick={onCheckReceipt}>
          {receiptBusy ? "核对" : "核对回执"}
        </button>
        {receipt && !receipt.ok ? (
          <p className="hint">
            {receipt.failure.title}。{receipt.failure.body} {receipt.failure.next}
          </p>
        ) : null}
        {receipt && receipt.ok ? (
          <p className="hint">
            {receipt.title}。{receipt.body}{" "}
            {receipt.scan.startsWith("http") ? (
              <a href={receipt.scan} target="_blank" rel="noreferrer">
                在 BscScan 查看
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="copy-block">
      <div className="copy-head">
        <span>{label}</span>
        <button type="button" className="linkish" onClick={() => void onCopy()}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="wire">{value}</pre>
    </div>
  );
}
