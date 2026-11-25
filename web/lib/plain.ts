import { formatBnb, formatToken } from "./format";
import type { QuoteDTO } from "./types";

export type PreviewSlip = {
  what: string;
  look: string;
  after: string;
};

function verb(quote: QuoteDTO): string {
  const coins = formatToken(quote.tokenWei);
  const bnb = formatBnb(quote.bnbWei);
  const paid = formatBnb(quote.valueWei);
  if (quote.action === "seat") return `占本窗席位，铸出 ${coins}，付出 ${paid}`;
  if (quote.action === "mint") return `从曲线铸造 ${coins}，付出 ${paid}`;
  if (quote.action === "sell") return `把 ${coins} 卖回曲线，拿回 ${bnb}`;
  if (quote.action === "swap" && quote.valueWei !== "0") return `按池价用 ${paid} 换币，大约得到 ${coins}`;
  if (quote.action === "swap") return `按池价把 ${coins} 卖进池子，大约拿回 ${bnb}`;
  if (quote.action === "add") return `向池子放入 ${coins} 和 ${paid}`;
  return `从池子取出份额，大约拿回 ${coins} 和 ${bnb}`;
}

export function previewSlip(quote: QuoteDTO): PreviewSlip {
  if (quote.blocked) {
    return {
      what: verb(quote),
      look: quote.blocked.title,
      after: "签名",
    };
  }
  return {
    what: verb(quote),
    look: `${quote.to} · ${formatBnb(quote.valueWei)}`,
    after: "签名",
  };
}
