"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="zh-Hans">
      <body style={{ margin: 0, background: "#0a0a0a", color: "#f4f4f1", fontFamily: "sans-serif" }}>
        <main style={{ maxWidth: 640, margin: "48px auto", padding: 24 }}>
          <h1 style={{ fontSize: 40, letterSpacing: "-0.04em" }}>页面停住了</h1>
          <p>这不是一笔交易的回滚，链上没有新的回执。不要把页面上的报错原文当成交易结果。</p>
          <button
            type="button"
            onClick={reset}
            style={{
              appearance: "none",
              border: "1px solid #f0b90b",
              background: "#f0b90b",
              color: "#0a0a0a",
              padding: "10px 14px",
              borderRadius: 0,
              font: "inherit",
            }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
