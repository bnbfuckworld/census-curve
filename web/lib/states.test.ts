import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { failure } from "./copy.ts";
import { INTEGRAL_FIRST_100, QUOTA0 } from "./economics.ts";

const REQUIRED = [
  "offline",
  "rejected",
  "gas",
  "no-agent",
  "empty-handle",
  "quota",
  "revert",
  "send-lost",
  "unopened",
  "curve-short",
] as const;

const BANNED = ["本机测试分叉", "本机测试网", "现网工厂尚未部署"];

test("first hundred tokens cost 5.1 BNB along the integral", () => {
  assert.equal(QUOTA0, 100n * 10n ** 18n);
  assert.equal(INTEGRAL_FIRST_100, 51n * 10n ** 17n);
});

test("every required failure has a next step and no rehearsal label", () => {
  for (const code of REQUIRED) {
    const row = failure(code);
    assert.equal(row.code, code);
    assert.ok(row.title.length > 0, code);
    assert.ok(row.body.length > 0, code);
    assert.ok(row.next.length > 0, code);
    const text = `${row.title}\n${row.body}\n${row.next}`;
    for (const banned of BANNED) {
      assert.equal(text.includes(banned), false, `${code} contains ${banned}`);
    }
    assert.equal(text.includes("Error:"), false, code);
  }
});

test("refusal does not describe a sent transaction", () => {
  const row = failure("rejected");
  assert.match(row.title, /没有送出/);
  assert.match(row.body, /没有交易/);
});

test("an unregistered book is the honest empty state", () => {
  const row = failure("unopened");
  assert.equal(row.title, "尚未接入现网");
  assert.match(row.next, /不要/);
  for (const code of REQUIRED) {
    if (code === "unopened") continue;
    assert.equal(failure(code).title.includes("尚未接入现网"), false, code);
    assert.equal(failure(code).body.includes("本机测试分叉"), false, code);
  }
});

test("the document title does not say the book is a local fork", () => {
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /title: "身份配额曲线"/);
  assert.equal(layout.includes("本机测试分叉"), false);
  assert.equal(layout.includes("尚未接入现网"), false);
});

test("the unsigned deployment names Jimmy's wallet and no key", () => {
  const script = fs.readFileSync(new URL("../../script/deploy-mainnet.sh", import.meta.url), "utf8");
  assert.equal(script.includes("--private-key"), false);
  assert.equal(script.includes("forge create"), false);
  assert.match(script, /0x1E483aa1351B8C77a0328f34D949f0B396BBc883/);
  const plan = JSON.parse(fs.readFileSync(new URL("../../deploy/unsigned.json", import.meta.url), "utf8")) as {
    chainId: number;
    from: string;
    registry: string;
    creationBytecode: string;
    createCalldata: string;
  };
  assert.equal(plan.chainId, 56);
  assert.equal(plan.from, "0x1E483aa1351B8C77a0328f34D949f0B396BBc883");
  assert.equal(plan.registry, "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F");
  assert.equal(plan.creationBytecode.startsWith("0x"), true);
  assert.equal(plan.createCalldata.startsWith("0x"), true);
  assert.equal(JSON.stringify(plan).includes("private"), false);
});

test("pages do not name the old account", () => {
  const files = [
    "../components/Desk.tsx",
    "../components/Ledger.tsx",
    "../components/Ticket.tsx",
    "../app/layout.tsx",
    "../app/deploy/page.tsx",
    "../app/deploy/DeployClient.tsx",
    "../app/rights/page.tsx",
    "../lib/copy.ts",
    "../lib/plain.ts",
    "../../README.md",
  ];
  for (const file of files) {
    const text = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(text.toLowerCase().includes("lithoforge"), false, file);
  }
  const desk = fs.readFileSync(new URL("../components/Desk.tsx", import.meta.url), "utf8");
  assert.match(desk, /https:\/\/x\.com\/censuscurve/);
});

test("selling does not restore quota in the quota failure", () => {
  const row = failure("quota");
  assert.match(row.body, /不会把铸额还你/);
});

const OLD_RULE = [
  "只让部署钱包签名",
  "这不是部署钱包",
  "签名地址必须是登记的那一个",
  "部署交易和开册交易的 from 都是",
  "两笔都由钱包弹出",
];

test("copy no longer requires the deploy wallet for opening the book", () => {
  const files = [
    "../components/Desk.tsx",
    "../components/Ledger.tsx",
    "../components/Ticket.tsx",
    "../app/layout.tsx",
    "../app/deploy/page.tsx",
    "../app/deploy/DeployClient.tsx",
    "../app/rights/page.tsx",
    "../lib/copy.ts",
    "../lib/plain.ts",
    "../../README.md",
    "../../script/deploy-mainnet.sh",
    "../../deploy/unsigned.json",
    "../../docs/desk.md",
    "../../docs/census-curve-v1.md",
  ];
  for (const file of files) {
    const text = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    for (const phrase of OLD_RULE) {
      assert.equal(text.includes(phrase), false, `${file} still says ${phrase}`);
    }
  }
});
