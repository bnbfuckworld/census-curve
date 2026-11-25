import { PUBLISHED } from "./economics";
import { formatBnb, formatToken } from "./format";
import type { DeskPayload } from "./types";

export type BookMode = "loading" | "live" | "held" | "empty" | "offline" | "stale" | "wrong" | "refused";

export function ledgerLine(desk: DeskPayload | null, mode: BookMode): string {
  const book = desk?.book;
  const published = desk?.published ?? PUBLISHED;
  if (mode === "loading") return "读取中";
  if (mode === "offline") return "节点中断";
  if (mode === "held") return "读数已停";
  if (mode === "stale") return "地址无合约";
  if (mode === "wrong") return "链号不是 56";
  if (mode === "refused") return "登记被拒";
  if (desk?.local && !desk.local.economicsMatch) return "参数不符";
  if (mode === "empty") return formatToken(published.quota0);
  if (!book) return "读数停住。";

  const redeem = book.redeemWei ? formatBnb(book.redeemWei) : "尚无赎回";
  const pool = book.poolOpen && book.poolPrice ? formatBnb(book.poolPrice) : "无池价";
  const supply = book.supply === "0" ? "供给 0" : `供给 ${formatToken(book.supply)}`;
  const lookedUp = Boolean(desk.identities.length && desk.identities.some((item) => item.address));

  if (!lookedUp) {
    return `${supply} · 赎回 ${redeem} · 池价 ${pool}`;
  }
  if (!book.eligible) {
    return `这个地址没有 Agent ID。${supply} · 赎回 ${redeem} · 池价 ${pool}`;
  }
  const quota = book.remaining === "0" ? "铸额已尽" : formatToken(book.remaining);
  return `铸额 ${quota} · 赎回 ${redeem} · 池价 ${pool}`;
}
