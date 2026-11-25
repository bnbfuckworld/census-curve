import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { encodeFunctionData } from "viem";
import { curveAbi } from "./abi";
import { agentPrompt, bawExecuteHint, bawInstruction, bawPreviewCommand, isZeroAddress, TRADE_RISK } from "./sign";
import type { QuoteDTO } from "./types";

const AGENT = "0x8c3b6ED81CD80E9FB617e40B146709fb5d978309";
const CURVE = "0xa298EA6d338a923e452A84A77a584852cD37308B";
const MINT_ONE = encodeFunctionData({ abi: curveAbi, functionName: "mint", args: [10n ** 18n] });
const VALUE = "1500000000000000";

function mintQuote(overrides: Partial<QuoteDTO> = {}): QuoteDTO {
  return {
    action: "mint",
    who: "lin",
    from: AGENT,
    to: CURVE,
    calldata: MINT_ONE,
    valueWei: VALUE,
    tokenWei: (10n ** 18n).toString(),
    bnbWei: VALUE,
    minOutWei: null,
    outUnit: "token",
    needApprove: false,
    approveTo: null,
    approveCalldata: null,
    notes: [],
    blocked: null,
    marginal: "1000000000000000",
    poolPrice: null,
    poolOpen: false,
    remaining: (100n * 10n ** 18n).toString(),
    mintedOf: "0",
    n: "0",
    supply: "0",
    baw: bawPreviewCommand({ from: AGENT, to: CURVE, valueWei: VALUE, data: MINT_ONE }),
    fn: "mint(uint256)",
    ...overrides,
  };
}

test("baw preview for a 1 QTA mint from the Agent ID wallet", () => {
  const command = bawPreviewCommand({ from: AGENT, to: CURVE, valueWei: VALUE, data: MINT_ONE });
  assert.equal(
    command,
    `baw contract-call preview --binanceChainId 56 --from ${AGENT} --to ${CURVE} --value ${VALUE} --inputData ${MINT_ONE} --json`,
  );
  assert.equal(MINT_ONE, "0xa0712d680000000000000000000000000000000000000000000000000de0b6b3a7640000");
  assert.equal(command.includes("execute"), false);
  const instruction = bawInstruction(mintQuote());
  assert.match(instruction, /本页不会代跑/);
  assert.match(instruction, /baw wallet settings --json/);
  assert.equal(instruction.includes(command), true);
  assert.equal(instruction.includes(bawExecuteHint()), true);
  const prompt = agentPrompt(mintQuote());
  assert.match(prompt, /不要改参数/);
  assert.match(prompt, /PENDING_CONFIRMATION/);
  assert.equal(prompt.includes(command), true);
});

test("baw command leaves --from blank until a payment address is known", () => {
  const command = bawPreviewCommand({
    from: "0x0000000000000000000000000000000000000000",
    to: CURVE,
    valueWei: VALUE,
    data: MINT_ONE,
  });
  assert.match(command, /--from <你的付款地址>/);
  assert.equal(isZeroAddress("0x0000000000000000000000000000000000000000"), true);
  assert.equal(isZeroAddress(AGENT), false);
});

test("blocked quotes tell the user not to execute", () => {
  const quote = mintQuote({
    blocked: { code: "no-agent", title: "这个地址没有 Agent ID", body: "没有资格。", next: "先领取。" },
  });
  assert.match(bawInstruction(quote), /不要预览，也不要执行/);
  assert.match(agentPrompt(quote), /不要执行这笔交易/);
});

const COPY_FILES = [
  "../components/Desk.tsx",
  "../components/Ledger.tsx",
  "../components/Ticket.tsx",
  "../components/Foot.tsx",
  "../app/layout.tsx",
  "../app/page.tsx",
  "../app/rights/page.tsx",
  "../app/deploy/page.tsx",
  "../app/deploy/DeployClient.tsx",
  "../lib/copy.ts",
  "../lib/plain.ts",
  "../lib/sign.ts",
  "../lib/ledgerLine.ts",
];

test("pages and desk copy never collect a pairing code", () => {
  for (const file of COPY_FILES.filter((item) => item.includes("components/") || item.includes("app/"))) {
    const text = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/aria-label="配对码"/.test(text), false, file);
    assert.equal(/aria-label="配对地址"/.test(text), false, file);
    assert.equal(text.includes('kind: "pairing"'), false, file);
    assert.equal(text.includes("inspectUrlForWeb"), false, file);
    assert.equal(/<input[^>]*配对/.test(text), false, file);
  }
  const desk = fs.readFileSync(new URL("../components/Desk.tsx", import.meta.url), "utf8");
  const ticket = fs.readFileSync(new URL("../components/Ticket.tsx", import.meta.url), "utf8");
  assert.equal(desk.includes("pairCode"), false);
  assert.equal(ticket.includes("配对地址"), false);
  assert.match(ticket, /去签名/);
  assert.match(ticket, /我签好了/);
  assert.match(ticket, /本站不会代跑/);
});

test("user-facing copy does not imply yield", () => {
  const allowed = /不承诺收益|没有收益|不是承诺的/;
  for (const file of COPY_FILES) {
    const text = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(text.includes("赚"), false, `${file} still has 赚`);
    assert.equal(text.includes("被动"), false, `${file} still has 被动`);
    const hits = [...text.matchAll(/收益/g)];
    for (const hit of hits) {
      const start = Math.max(0, hit.index! - 8);
      const window = text.slice(start, hit.index! + 12);
      assert.equal(allowed.test(window), true, `${file} has bare 收益 near: ${window}`);
    }
  }
  assert.match(TRADE_RISK, /不承诺收益/);
  assert.match(TRADE_RISK, /没有 owner/);
  assert.match(TRADE_RISK, /可能亏损/);
});

test("permissions page states the verified claims", () => {
  const text = fs.readFileSync(new URL("../app/rights/page.tsx", import.meta.url), "utf8");
  for (const phrase of [
    "没有 owner",
    "没有暂停",
    "没有改参数",
    "不能升级",
    "只允许曲线调用",
    "没有管理员提款",
    "不承诺收益",
  ]) {
    assert.equal(text.includes(phrase), true, `missing ${phrase}`);
  }
});

test("trade risk sits beside the action and in the footer", () => {
  const desk = fs.readFileSync(new URL("../components/Desk.tsx", import.meta.url), "utf8");
  const seat = fs.readFileSync(new URL("../components/SeatDesk.tsx", import.meta.url), "utf8");
  const ledger = fs.readFileSync(new URL("../components/Ledger.tsx", import.meta.url), "utf8");
  const ticket = fs.readFileSync(new URL("../components/Ticket.tsx", import.meta.url), "utf8");
  const foot = fs.readFileSync(new URL("../components/Foot.tsx", import.meta.url), "utf8");
  assert.match(desk, /可能亏损、不承诺收益/);
  assert.match(desk, /权限说明/);
  assert.match(seat, /溢价不退、可能亏损、不承诺收益/);
  assert.match(seat, /权限说明/);
  assert.equal(ledger.includes("TRADE_RISK"), false);
  assert.match(ticket, /TRADE_RISK/);
  assert.match(foot, /TRADE_RISK/);
  assert.match(foot, /权限说明/);
});
