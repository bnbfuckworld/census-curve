import Link from "next/link";

export default function NotFound() {
  return (
    <main className="frame">
      <section className="trade">
        <div className="panel">
          <h1 style={{ fontSize: 40 }}>没有这一页</h1>
          <p>这里只有交易页和部署页。</p>
          <p className="next">下一步：回到交易页。</p>
          <Link href="/" className="btn primary">
            交易
          </Link>
        </div>
      </section>
    </main>
  );
}
