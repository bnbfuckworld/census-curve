"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="frame">
      <section className="trade">
        <div className="panel">
          <h1 style={{ fontSize: 40 }}>这一页没有读完</h1>
          <p>这不是链上的回滚，没有新的回执。</p>
          <p className="next">下一步：再读取一次。不要把浏览器的报错原文当成交易结果。</p>
          <button type="button" className="btn primary" onClick={reset}>
            重试
          </button>
        </div>
      </section>
    </main>
  );
}
