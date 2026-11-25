// Checks a running desk. Does not broadcast to BSC.
// CHECK_URL defaults to the rehearsal desk when one is already up.
const base = (process.env.CHECK_URL ?? "http://127.0.0.1:43123/curve").replace(/\/$/, "");

async function get(path) {
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  const data = await res.json();
  return { status: res.status, data };
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function wei(whole) {
  return (BigInt(whole) * 10n ** 18n).toString();
}

const desk = await get("/api/desk/?who=lin");
if (!desk.data.attached) {
  if (desk.data.reason !== "unopened") {
    console.error("册页没接上，原因不是未登记", desk.data.reason);
    process.exit(1);
  }
  const slipped = await post("/api/desk/send/", {
    who: "lin",
    action: "mint",
    token: "1",
    bnb: "0.01",
    lp: "",
    tokenToBnb: false,
    confirm: true,
    force: false,
  });
  if (slipped.data.ok || slipped.data.failure?.code !== "unopened") {
    console.error("空册仍然试图送出", slipped.data);
    process.exit(1);
  }
  console.log("空册：未登记，且没有送出。");
  process.exit(0);
}

const hundred = await post("/api/desk/quote/", {
  who: "lin",
  action: "mint",
  token: "100",
  bnb: "0.01",
  lp: "",
  tokenToBnb: false,
});
if (!hundred.data.ok || hundred.data.quote.bnbWei !== (51n * 10n ** 17n).toString()) {
  console.error("100 枚积分不是 5.1 BNB", hundred.data.quote?.bnbWei);
  process.exit(1);
}
console.log("报价：首次 100 枚沿积分 5.1 BNB。");

const before = BigInt(desk.data.book.remaining);
const mintedBefore = BigInt(desk.data.book.mintedOf);
if (before > 10n ** 18n) {
  const minted = await post("/api/desk/send/", {
    who: "lin",
    action: "mint",
    token: "1",
    bnb: "0.01",
    lp: "",
    tokenToBnb: false,
    confirm: true,
    force: false,
  });
  if (!minted.data.ok) {
    console.error("铸造没有入账", minted.data.failure);
    process.exit(1);
  }
  const left = BigInt(minted.data.receipt.after.remaining);
  if (left !== before - 10n ** 18n) {
    console.error("铸 1 枚后剩余不对", left.toString());
    process.exit(1);
  }
  if (!minted.data.receipt.hash || !minted.data.receipt.blockNumber) {
    console.error("回执缺少哈希或区块");
    process.exit(1);
  }
  console.log("铸造：剩余", left.toString(), "回执", minted.data.receipt.hash);
}

const again = await get("/api/desk/?who=lin");
const held = BigInt(again.data.book.remaining);
const sold = await post("/api/desk/send/", {
  who: "lin",
  action: "sell",
  token: "1",
  bnb: "0.01",
  lp: "",
  tokenToBnb: false,
  confirm: true,
  force: false,
});
if (!sold.data.ok) {
  console.error("卖回没有入账", sold.data.failure);
  process.exit(1);
}
if (BigInt(sold.data.receipt.after.remaining) !== held) {
  console.error("卖回之后铸额变了", sold.data.receipt.after.remaining);
  process.exit(1);
}
if (BigInt(sold.data.receipt.after.mintedOf) < mintedBefore && mintedBefore !== 0n) {
  console.error("已铸变少了");
  process.exit(1);
}
console.log("卖回：剩余仍是", sold.data.receipt.after.remaining);

const refused = await post("/api/desk/send/", {
  who: "lin",
  action: "mint",
  token: "1",
  bnb: "0.01",
  lp: "",
  tokenToBnb: false,
  confirm: false,
  force: false,
});
if (refused.data.ok || refused.data.failure?.code !== "rejected") {
  console.error("拒签仍被送出", refused.data);
  process.exit(1);
}

async function expectBlock(who, token, code) {
  const quoted = await post("/api/desk/quote/", {
    who,
    action: who === "lin" && token === "1000000" ? "sell" : "mint",
    token,
    bnb: "0.01",
    lp: "",
    tokenToBnb: false,
  });
  const got = quoted.data.ok ? quoted.data.quote.blocked?.code : quoted.data.failure?.code;
  if (got !== code) {
    console.error(who, token, "期望", code, "得到", got);
    process.exit(1);
  }
  console.log("失败态", code, "成立");
}

await expectBlock("none", "1", "no-agent");
await expectBlock("blank", "1", "empty-handle");
await expectBlock("broke", "1", "gas");
await expectBlock("lin", "1000000", "curve-short");
const quota = await post("/api/desk/quote/", {
  who: "lin",
  action: "mint",
  token: "1000",
  bnb: "0.01",
  lp: "",
  tokenToBnb: false,
});
const quotaCode = quota.data.ok ? quota.data.quote.blocked?.code : quota.data.failure?.code;
if (quotaCode !== "quota") {
  console.error("配额用尽没有拦住", quotaCode);
  process.exit(1);
}
console.log("失败态 quota 成立");
console.log("路径核对完成。没有向 BSC 广播。");
