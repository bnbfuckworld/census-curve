import type { Failure } from "./types";

const TABLE: Record<string, Omit<Failure, "code" | "audit">> = {
  "no-agent": {
    title: "这个地址没有 Agent ID",
    body: "无 Agent ID",
    next: "领取后再来",
  },
  "empty-handle": {
    title: "句柄是空的",
    body: "空句柄",
    next: "换一个有句柄的",
  },
  rejected: {
    title: "签名被拒，这一张没有送出",
    body: "没有交易",
    next: "再提交",
  },
  gas: {
    title: "气费不够",
    body: "BNB 不够",
    next: "自备 BNB",
  },
  quota: {
    title: "铸额用尽",
    body: "不会把铸额还你",
    next: "换",
  },
  revert: {
    title: "链上退回",
    body: "回滚",
    next: "改数量",
  },
  offline: {
    title: "节点中断",
    body: "无新读数",
    next: "再读",
  },
  held: {
    title: "读取已停",
    body: "读数已停",
    next: "再读",
  },
  "send-lost": {
    title: "回执未到",
    body: "无回执",
    next: "核对哈希",
  },
  unopened: {
    title: "尚未接入现网",
    body: "地址空",
    next: "不要签",
  },
  stale: {
    title: "记下的地址上没有合约",
    body: "无代码",
    next: "核对地址",
  },
  "wrong-chain": {
    title: "节点的链号不是 56",
    body: "链号不是 56",
    next: "换回 56",
  },
  "refused-file": {
    title: "登记被拒",
    body: "登记不符",
    next: "用登记地址",
  },
  "bad-amount": {
    title: "不是数量",
    body: "十进制，最多 18 位",
    next: "重填",
  },
  zero: {
    title: "数量是零",
    body: "0",
    next: "写大于 0",
  },
  "curve-short": {
    title: "曲线余额不足",
    body: "枚数超过余额或供给",
    next: "改小",
  },
  balance: {
    title: "余额不够",
    body: "余额不够",
    next: "改小",
  },
  "no-liquidity": {
    title: "池子还没有价",
    body: "储备 0",
    next: "入",
  },
  slippage: {
    title: "未达下限",
    body: "99%",
    next: "重新报价",
  },
  payment: {
    title: "价款不足",
    body: "BNB 少于报价",
    next: "重新报价",
  },
  overflow: {
    title: "数量过大",
    body: "溢出",
    next: "改小",
  },
  "url-empty": {
    title: "不收配对码",
    body: "不代签",
    next: "用 calldata",
  },
  "url-bad": {
    title: "不打开配对地址",
    body: "不收配对码",
    next: "用 calldata",
  },
  "url-host": {
    title: "不打开配对地址",
    body: "不收配对码",
    next: "用 calldata",
  },
  "url-wc": {
    title: "不收配对登录",
    body: "不代登录",
    next: "用 calldata",
  },
  popup: {
    title: "不弹配对页",
    body: "不打开配对窗口",
    next: "用 calldata",
  },
  "bad-hash": {
    title: "哈希无效",
    body: "0x + 32 字节",
    next: "重贴哈希",
  },
  "no-receipt": {
    title: "还没有回执",
    body: "无回执",
    next: "再核",
  },
  "wrong-to": {
    title: "这笔不是打给本册合约的",
    body: "地址不符",
    next: "核对哈希",
  },
  "receipt-fail": {
    title: "退回",
    body: "失败",
    next: "重新报价",
  },
  "page-broke": {
    title: "读数没回来",
    body: "无数字",
    next: "再读",
  },
  "app-only": {
    title: "去签名",
    body: "不代签",
    next: "用 calldata",
  },
  "bad-who": {
    title: "没有这个账户",
    body: "没有送出",
    next: "重填地址",
  },
  "bad-json": {
    title: "请求无效",
    body: "没有送出",
    next: "重提",
  },
  "bad-action": {
    title: "没有这个动作",
    body: "铸 / 卖 / 换 / 入 / 出",
    next: "换动作",
  },
  dust: {
    title: "数量太小，这一笔不提交",
    body: "少于 0.001 枚",
    next: "至少 0.001 枚",
  },
  whole: {
    title: "须整枚",
    body: "至少 1 枚",
    next: "改成整数",
  },
  guard: {
    title: "保护期",
    body: "16 块",
    next: "等开窗",
  },
  taken: {
    title: "本窗已满",
    body: "1 席",
    next: "下一窗",
  },
  seated: {
    title: "已入席",
    body: "一号一席",
    next: "换号",
  },
  "not-owner": {
    title: "不是这个地址的 Agent ID",
    body: "ownerOf 不符",
    next: "改号",
  },
  full: {
    title: "100 席已满",
    body: "100",
    next: "换",
  },
  "stale-quote": {
    title: "报价过期",
    body: "价格已升",
    next: "重新报价",
  },
  sniped: {
    title: "本窗已满",
    body: "席位已写",
    next: "下一窗",
  },
  "seat-revert": {
    title: "退回",
    body: "失败",
    next: "重新报价",
  },
  "no-book": {
    title: "册未开",
    body: "无册",
    next: "签 create",
  },
  "wrong-book": {
    title: "参数不符",
    body: "常量不符",
    next: "核对地址",
  },
};

export function failure(code: string, audit?: string): Failure {
  const row = TABLE[code] ?? TABLE.revert;
  return {
    code: TABLE[code] ? code : "revert",
    title: row.title,
    body: row.body,
    next: row.next,
    audit,
  };
}

export function failureForRevert(name: string | null): Failure {
  switch (name) {
    case "NotAgent":
      return failure("no-agent");
    case "EmptyHandle":
      return failure("empty-handle");
    case "QuotaExceeded":
    case "PrimaryClosed":
      return failure("quota");
    case "NoLiquidity":
    case "InsufficientLiquidity":
      return failure("no-liquidity");
    case "Slippage":
      return failure("slippage");
    case "InsufficientBalance":
      return failure("balance");
    case "ZeroAmount":
      return failure("zero");
    case "WholeTokenOnly":
      return failure("whole");
    case "Guarded":
      return failure("guard");
    case "WindowTaken":
      return failure("sniped");
    case "AlreadySeated":
      return failure("seated");
    case "NotOwner":
      return failure("not-owner");
    case "BookFull":
      return failure("full");
    case "InsufficientPayment":
      return failure("payment");
    case "MathOverflow":
      return failure("overflow");
    case "GAS":
      return failure("gas");
    case "OFFLINE":
      return failure("offline");
    default:
      return failure("revert");
  }
}

export const DISTINCTION = "网页连上普通插件钱包 ≠ Agent 登录。资格只认链上 msg.sender。";
