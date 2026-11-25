"use client";

import { useCallback, useEffect, useState } from "react";
import { Foot } from "@/components/Foot";
import { Mark } from "@/components/Mark";
import { failure as named } from "@/lib/copy";
import { withBase } from "@/lib/basePath";
import type { Failure } from "@/lib/types";

export type Plan = {
  chainId: number;
  registry: string;
  registrySource: string;
  name: string;
  symbol: string;
  createCalldata: string;
  checks: string[];
};

export type Book = {
  factory: string;
  deployTx: string;
  token: string;
  curve: string;
  pool: string;
  createTx: string;
};

type Ethereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function ethereum(): Ethereum | null {
  const host = window as unknown as { ethereum?: Ethereum };
  return host.ethereum ?? null;
}

function scanTx(hash: string) {
  return `https://bscscan.com/tx/${hash}`;
}

function scanAddr(address: string) {
  return `https://bscscan.com/address/${address}`;
}

function short(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function filled(book: Book | null) {
  return Boolean(book?.factory && book.token && book.curve && book.pool && book.createTx);
}

function hasFactory(book: Book | null) {
  return Boolean(book?.factory);
}

export function DeployClient({ initialPlan, initialBook }: { initialPlan: Plan; initialBook: Book }) {
  const [plan, setPlan] = useState<Plan | null>(initialPlan);
  const [book, setBook] = useState<Book | null>(initialBook);
  const [account, setAccount] = useState("");
  const [chainOk, setChainOk] = useState(false);
  const [agentBalance, setAgentBalance] = useState<bigint | null>(null);
  const alreadyOpen = Boolean(initialBook.factory && initialBook.token && initialBook.curve && initialBook.pool && initialBook.createTx);
  const [note, setNote] = useState(
    alreadyOpen ? "第一册已经开出。地址已写入柜台。" : "工厂已经在链上。开册需要一个持有 Agent ID 的钱包。",
  );
  const [failure, setFailure] = useState<Failure | null>(null);
  const [createTx, setCreateTx] = useState(alreadyOpen ? initialBook.createTx : "");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(withBase("/api/deploy/plan"), { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; plan?: Plan; book?: Book; failure?: Failure }
      | null;
    if (!data?.ok || !data.plan) {
      setFailure(data?.failure ?? named("page-broke"));
      return;
    }
    setPlan(data.plan);
    setBook(data.book ?? null);
    if (filled(data.book ?? null) && data.book?.createTx) {
      setCreateTx(data.book.createTx);
      setNote("第一册已经开出。地址已写入柜台。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshWallet = useCallback(async () => {
    const wallet = ethereum();
    if (!wallet || !plan || !account) {
      setChainOk(false);
      setAgentBalance(null);
      return;
    }
    try {
      const hex = (await wallet.request({ method: "eth_chainId" })) as string;
      const ok = Number(hex) === plan.chainId;
      setChainOk(ok);
      if (!ok) {
        setAgentBalance(null);
        return;
      }
      const data = `0x70a08231${account.slice(2).toLowerCase().padStart(64, "0")}`;
      const raw = (await wallet.request({
        method: "eth_call",
        params: [{ to: plan.registry, data }, "latest"],
      })) as string;
      setAgentBalance(BigInt(raw || "0x0"));
    } catch {
      setChainOk(false);
      setAgentBalance(null);
    }
  }, [account, plan]);

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  useEffect(() => {
    const wallet = ethereum();
    if (!wallet?.on) return;
    const onAccounts = (...args: unknown[]) => {
      const list = args[0] as string[] | undefined;
      setAccount(list?.[0] ?? "");
    };
    const onChain = () => {
      void refreshWallet();
    };
    wallet.on("accountsChanged", onAccounts);
    wallet.on("chainChanged", onChain);
    return () => {
      wallet.removeListener?.("accountsChanged", onAccounts);
      wallet.removeListener?.("chainChanged", onChain);
    };
  }, [refreshWallet]);

  async function connect() {
    setFailure(null);
    const wallet = ethereum();
    if (!wallet) {
      setFailure(named("offline"));
      return;
    }
    const accounts = (await wallet.request({ method: "eth_requestAccounts" }).catch(() => null)) as string[] | null;
    if (!accounts?.[0]) {
      setFailure(named("rejected"));
      return;
    }
    setAccount(accounts[0]);
    setNote("已连接。链号必须是 56，而且这个地址要持有 Agent ID。");
  }

  async function switchChain() {
    setFailure(null);
    const wallet = ethereum();
    if (!wallet) return;
    try {
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
      setChainOk(true);
      await refreshWallet();
    } catch {
      setFailure(named("wrong-chain"));
    }
  }

  const noAgent = Boolean(account && chainOk && agentBalance === 0n);
  const canCreate =
    Boolean(plan && book?.factory && account && chainOk && agentBalance !== null && agentBalance > 0n && !filled(book) && !busy && !pending);

  async function signCreate() {
    if (!plan || !book?.factory || !canCreate) return;
    const wallet = ethereum();
    if (!wallet) {
      setFailure(named("offline"));
      return;
    }
    setBusy(true);
    setFailure(null);
    setNote("钱包会弹出开册。拒绝则没有交易。");
    try {
      const hex = (await wallet.request({ method: "eth_chainId" })) as string;
      if (Number(hex) !== plan.chainId) {
        setFailure(named("wrong-chain"));
        setBusy(false);
        return;
      }
      const hash = (await wallet.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: book.factory, data: plan.createCalldata, value: "0x0" }],
      })) as string;
      setCreateTx(hash);
      setPending(true);
      setNote("开册交易已送出，正在等回执。");
      for (let i = 0; i < 40; i++) {
        const receipt = (await wallet
          .request({ method: "eth_getTransactionReceipt", params: [hash] })
          .catch(() => null)) as { status?: string } | null;
        if (receipt) {
          if (receipt.status !== "0x1") {
            setPending(false);
            setBusy(false);
            setFailure(named("revert"));
            setNote("开册被退回。book.json 没有写入。");
            return;
          }
          await finish(hash);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setPending(false);
      setBusy(false);
      setFailure(named("send-lost"));
      setNote("回执还没取到。先不要再签一次，先在区块浏览器里核对该哈希。");
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (message.includes("insufficient") || message.includes("funds")) setFailure(named("gas"));
      else if (message.includes("reject") || message.includes("denied")) setFailure(named("rejected"));
      else setFailure(named("send-lost"));
      setPending(false);
      setBusy(false);
    }
  }

  async function finish(hash: string) {
    setNote("交易已成功。正在向链上核对并写入柜台，还没有把未核对的地址写进去。");
    const res = await fetch(withBase("/api/deploy/record"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ createTx: hash }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; failure?: Failure; token?: string; curve?: string; pool?: string; factory?: string }
      | null;
    setPending(false);
    setBusy(false);
    if (!data) {
      setFailure(named("send-lost"));
      setNote("开册交易已在链上，但柜台还没有写入。先不要再签一次。");
      return;
    }
    if (!data.ok) {
      setFailure(data.failure ?? named("revert"));
      setNote("开册交易已在链上，但地址还没有写入柜台。先不要再签一次，先在区块浏览器里核对该哈希。");
      return;
    }
    setNote("第一册已开出。地址已写入。回到交易页就可以看到柜台。");
    await load();
  }

  const factory = book?.factory || "";
  const already = filled(book);

  return (
    <main className="frame">
      <header className="top">
        <a className="brand" href={withBase("/")}>
          <Mark />
          <span>Census Curve</span>
        </a>
        <nav className="nav">
          <a href="https://x.com/censuscurve" target="_blank" rel="noreferrer">
            官号
          </a>
          <a href={withBase("/")}>交易</a>
          <a href={withBase("/rights")}>权限说明</a>
        </nav>
      </header>
      <section className="hero">
        <div>
          <p className="kicker">DEPLOY</p>
          <h1>开第一册</h1>
          <p className="lede">工厂已经部署。开册由持有 Agent ID 的钱包签名。本页不收私钥，也不代签。</p>
        </div>
      </section>
      <section className="trade">
        <div className="trade-head">
          <strong>待签</strong>
          <span className="num">BSC · 56</span>
        </div>
        <div className="panel">
          {!plan ? <p>正在取出待签交易。</p> : null}
          {plan ? (
            <>
              <p>
                <strong>第一步 · 工厂</strong>
                {hasFactory(book) ? " 已完成" : " 尚未写入"}
              </p>
              {hasFactory(book) ? (
                <>
                  <p className="addr num">
                    工厂{" "}
                    <a href={scanAddr(factory)} target="_blank" rel="noreferrer">
                      {factory}
                    </a>
                  </p>
                  {book?.deployTx ? (
                    <p className="addr num">
                      部署交易{" "}
                      <a href={scanTx(book.deployTx)} target="_blank" rel="noreferrer">
                        {short(book.deployTx)}
                      </a>
                    </p>
                  ) : null}
                </>
              ) : (
                <p>还没有记下工厂地址。这一页不重新部署工厂。</p>
              )}
              <p>
                <strong>第二步 · 开册</strong> {plan.name} / {plan.symbol}
              </p>
              <p className="addr num">
                Agent ID {plan.registry}{" "}
                <a href={plan.registrySource} target="_blank" rel="noreferrer">
                  来源
                </a>
              </p>
              <ol className="steps">
                {plan.checks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
              <p>{note}</p>
              {account ? <p className="addr num">当前钱包 {account}</p> : null}
              {account && !chainOk ? <p>钱包不在链号 56。先切换到 BNB 主网。</p> : null}
              {noAgent ? <p>这个钱包没有 Agent ID，开不了册</p> : null}
              {createTx ? (
                <p className="addr num">
                  开册交易{" "}
                  <a href={scanTx(createTx)} target="_blank" rel="noreferrer">
                    {short(createTx)}
                  </a>
                </p>
              ) : null}
              {pending ? <p>等待链上回执。</p> : null}
              {already ? (
                <>
                  <p>第一册已在链上。</p>
                  <p className="addr num">
                    代币{" "}
                    <a href={scanAddr(book!.token)} target="_blank" rel="noreferrer">
                      {book!.token}
                    </a>
                  </p>
                  <p className="addr num">
                    曲线{" "}
                    <a href={scanAddr(book!.curve)} target="_blank" rel="noreferrer">
                      {book!.curve}
                    </a>
                  </p>
                  <p className="addr num">
                    池{" "}
                    <a href={scanAddr(book!.pool)} target="_blank" rel="noreferrer">
                      {book!.pool}
                    </a>
                  </p>
                </>
              ) : null}
              {failure ? (
                <>
                  <p>
                    <strong>{failure.title}</strong>
                  </p>
                  <p>{failure.body}</p>
                  <p className="next">{failure.next}</p>
                </>
              ) : null}
              <div className="ticket-actions">
                <button type="button" className="btn" disabled={busy || already} onClick={() => void connect()}>
                  连接
                </button>
                {account && !chainOk ? (
                  <button type="button" className="btn" disabled={busy} onClick={() => void switchChain()}>
                    切换到 BNB 主网
                  </button>
                ) : null}
                <button type="button" className="btn primary" disabled={!canCreate} onClick={() => void signCreate()}>
                  创建 QTA
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
      <Foot factory={factory || undefined} token={book?.token || undefined} curve={book?.curve || undefined} pool={book?.pool || undefined} />
    </main>
  );
}
