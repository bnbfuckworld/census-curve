export type SeatPhase =
  | "unopened"
  | "offline"
  | "refused"
  | "wrong-chain"
  | "stale"
  | "guard"
  | "open"
  | "taken"
  | "full"
  | "seated"
  | "no-agent"
  | "not-owner"
  | "empty-handle"
  | "no-book"
  | "wrong-book";

export function blocksToSeconds(blocks: bigint): string {
  if (blocks < 0n) return "0.00";
  const hundredths = blocks * 45n;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${frac}`;
}

export function seatPhase(input: {
  attached: boolean;
  reason?: SeatPhase;
  open: boolean;
  windowFree: boolean;
  bookFull: boolean;
  alreadySeated: boolean;
  lookedUp: boolean;
  eligible: boolean;
  ownerMatches: boolean;
  emptyHandle: boolean;
}): SeatPhase {
  if (!input.attached) return input.reason ?? "offline";
  if (input.lookedUp && input.emptyHandle) return "empty-handle";
  if (input.lookedUp && !input.eligible) return "no-agent";
  if (input.lookedUp && !input.ownerMatches) return "not-owner";
  if (input.alreadySeated) return "seated";
  if (input.bookFull) return "full";
  if (!input.open) return "guard";
  if (!input.windowFree) return "taken";
  return "open";
}

export const PHASE_LABEL: Record<SeatPhase, string> = {
  unopened: "尚未接入现网",
  offline: "读取停住了",
  refused: "登记被拒绝",
  "wrong-chain": "链号不是 56",
  stale: "地址上没有合约",
  guard: "开册保护",
  open: "本窗可以入席",
  taken: "本窗已有席位",
  full: "一百席已满",
  seated: "这个 Agent ID 已入席",
  "no-agent": "这个地址没有 Agent ID",
  "not-owner": "这个 Agent ID 不属于这个地址",
  "empty-handle": "句柄是空的",
  "no-book": "工厂在，册还没开",
  "wrong-book": "链上参数对不上",
};

export const PHASE_BODY: Record<SeatPhase, string> = {
  unopened: "第二册的地址还空着。这里不会编造价格。",
  offline: "节点没有把读数送回来。停住之前的数字不要当成新的。",
  refused: "这份登记和允许的链或注册表不一致。",
  "wrong-chain": "第二册只在链号 56 上读。",
  stale: "记下的席位册地址上已经没有代码。",
  guard: "开册后的前 16 块不能入席。倒计时走完，这一窗的第一块从 2 倍地板开始。",
  open: "这一窗还空着。现在付左边的价，等到本窗最后一块就只付地板。高出地板的部分打进死地址。",
  taken: "这一窗的席位已经写上了。下一窗会重新从 2 倍地板开价。空着的窗口不会把名额用掉。",
  full: "100 个席位都已入册。不能再入席。池子里的兑换还在。",
  seated: "这个 Agent ID 在本册已经有过席位。卖掉代币也不会把席位还回来。",
  "no-agent": "这个地址在注册表里没有 Agent ID。网页上的填写不算登录。",
  "not-owner": "合约要 ownerOf(agentId) 等于付款地址。这里填的对应关系不算数。",
  "empty-handle": "这个地址有记录，但句柄是空的。空句柄不能入席。",
  "no-book": "工厂在链上，这一册还没有创建。",
  "wrong-book": "读到的常量和源码对不上，所以不报价。",
};
