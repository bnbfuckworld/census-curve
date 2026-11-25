import { formatBnb, formatToken } from "./format";
import type { Action, QuoteDTO } from "./types";

const ZERO = /^0x0{40}$/i;

export const TRADE_RISK =
  "曲线价格随供给变动，后铸更贵。卖回或进池都可能亏损。本产品不承诺收益，也没有利息或分红。工厂、曲线、池和代币没有 owner，不能暂停，也不能改参数。";

export const SEAT_RISK =
  "价格按块从 2 倍地板降到地板。高出地板的部分打进死地址，卖回不退。开册后的前 16 块不能入席。衰减到地板的那一块可能被构建者拿走。卖回不把席位让出来。本产品不承诺收益，也没有利息或分红。工厂、席位册、池和代币没有 owner，不能暂停，也不能改参数。";

export const SLIPPAGE_NOTE =
  "池子兑换、入池和出池的最小成交量按报价的 99% 写入 calldata（约 1% 滑点）。铸造和卖回曲线没有滑点参数：少付会整笔退回，多付的铸造价款会退给付款人。报价会随供给变化，签之前若有人先成交，请重新报价，不要沿用旧的 calldata。";

export function isZeroAddress(value: string | undefined): boolean {
  return !value || ZERO.test(value);
}

export function bawPreviewCommand(input: { from?: string; to: string; valueWei: string; data: string }): string {
  const from = input.from && !isZeroAddress(input.from) ? input.from : "<你的付款地址>";
  return [
    "baw contract-call preview",
    "--binanceChainId 56",
    `--from ${from}`,
    `--to ${input.to}`,
    `--value ${input.valueWei}`,
    `--inputData ${input.data}`,
    "--json",
  ].join(" ");
}

export function bawExecuteHint(): string {
  return "baw contract-call execute --requestId <这次 preview 返回的 requestId> --json";
}

export function bawInstruction(quote: Pick<QuoteDTO, "from" | "to" | "valueWei" | "calldata" | "needApprove" | "approveTo" | "approveCalldata" | "blocked">): string {
  if (quote.blocked) {
    return `这一笔现在不会成立：${quote.blocked.title}。不要预览，也不要执行。`;
  }
  const lines: string[] = [
    "本页不会代跑这些命令。请在你自己的代理或终端里执行。不要把私钥或助记词发给本站。",
    "",
    "1. 先确认开发者模式（未开启就到币安 App：Agentic Wallet 管理页 → 设置 → 开发者模式）：",
    "baw wallet settings --json",
    "",
  ];
  if (quote.needApprove && quote.approveTo && quote.approveCalldata) {
    lines.push("2. 先预览并确认授权（value 为 0）：");
    lines.push(bawPreviewCommand({ from: quote.from, to: quote.approveTo, valueWei: "0", data: quote.approveCalldata }));
    lines.push("用户明确同意后：");
    lines.push(bawExecuteHint());
    lines.push("");
    lines.push("3. 授权入账后再预览正票：");
  } else {
    lines.push("2. 预览正票：");
  }
  lines.push(bawPreviewCommand({ from: quote.from, to: quote.to, valueWei: quote.valueWei, data: quote.calldata }));
  lines.push("看过 parsedTx、risks 和授权变化，并且用户明确同意之后：");
  lines.push(bawExecuteHint());
  lines.push("若返回 PENDING_CONFIRMATION，停住，等在币安 App 里确认。不要再发第二笔。preview 过期就重新 preview，不要复用旧 requestId。");
  lines.push("");
  lines.push(SLIPPAGE_NOTE);
  return lines.join("\n");
}

export function agentPrompt(quote: QuoteDTO): string {
  if (quote.blocked) {
    return `不要执行这笔交易。原因：${quote.blocked.title}。${quote.blocked.body}`;
  }
  const from = isZeroAddress(quote.from) ? "（先向用户确认付款地址，必须是持有 Agent ID 的钱包）" : quote.from;
  const valueBnb = formatBnb(quote.valueWei);
  const amount =
    quote.action === "remove" ? `份额相关，约得到 ${formatToken(quote.tokenWei)} 和 ${formatBnb(quote.bnbWei)}` : formatToken(quote.tokenWei);
  const verb: Record<Action, string> = {
    mint: "按曲线铸造",
    sell: "卖回曲线",
    swap: "按池价兑换",
    add: "加入池子",
    remove: "从池子取出份额",
    seat: "占本窗席位并铸出 1 枚",
  };
  return [
    `请用我自己的 Binance Agentic Wallet，在 BNB 链（chainId 56）上预览并等我确认后再执行一笔「${verb[quote.action]}」。不要改参数，不要再发第二笔，也不要把私钥发给任何网页。`,
    `动作：${verb[quote.action]}。数量：${amount}。应付价值：${valueBnb}（${quote.valueWei} wei）。`,
    `from：${from}`,
    `to：${quote.to}`,
    `inputData：${quote.calldata}`,
    quote.needApprove && quote.approveCalldata
      ? `这一笔需要先授权池子。授权 to：${quote.approveTo}，data：${quote.approveCalldata}，value：0。`
      : "",
    "先跑：baw wallet settings --json。确认开发者模式已开启且未过期。",
    `再跑：${bawPreviewCommand({ from: isZeroAddress(quote.from) ? undefined : quote.from, to: quote.to, valueWei: quote.valueWei, data: quote.calldata })}`,
    "把 parsedTx、risks 和 authorityChanges 原样给我看。我明确同意后，再用这次 preview 的 requestId 执行：baw contract-call execute --requestId <requestId> --json。若返回 PENDING_CONFIRMATION，停在那里，等我在币安 App 里确认。",
    SLIPPAGE_NOTE,
  ]
    .filter(Boolean)
    .join("\n");
}
