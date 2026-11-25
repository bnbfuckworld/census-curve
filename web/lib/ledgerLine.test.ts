import assert from "node:assert/strict";
import test from "node:test";
import { PUBLISHED } from "./economics.ts";
import { ledgerLine } from "./ledgerLine.ts";
import type { Book, DeskPayload, LocalMarket } from "./types.ts";

const local: LocalMarket = {
  factory: "0x08A7FB944d16a9f8cb7031e0D756d7B5Be13B87c",
  token: "0x69043d39ad5D8F2Bb5Bc16b913B0526E444bdB18",
  curve: "0xa298EA6d338a923e452A84A77a584852cD37308B",
  pool: "0x586AfadF10f101B8C7E2Fc0eee33103EC649f418",
  name: "配额曲线第一册",
  symbol: "QTA",
  createTx: "0xb13cfff563aecb21afa85befe760f710b4c7fd8c6883aa15a3acfa836952f2c2",
  createTxFound: true,
  registryCodeBytes: 1,
  economicsMatch: true,
  chainSlope: PUBLISHED.slope,
  chainBase: PUBLISHED.base,
  chainQuota0: PUBLISHED.quota0,
};

function book(partial: Partial<Book>): Book {
  return {
    supply: "0",
    reserve: "0",
    n: "0",
    marginal: "1000000000000000",
    redeemWei: null,
    redeemAmount: null,
    nextQuota: "100000000000000000000",
    remaining: "0",
    mintedOf: "0",
    quotaOf: "0",
    started: false,
    tokenReserve: "0",
    bnbReserve: "0",
    poolPrice: "0",
    poolOpen: false,
    tokenBal: "0",
    lp: "0",
    bnb: "0",
    agentBalance: "0",
    handle: "",
    eligible: false,
    ...partial,
  };
}

function desk(partial: Partial<DeskPayload> & { book?: Book | null }): DeskPayload {
  return {
    live: false,
    chainId: 56,
    rpc: "https://bsc-dataseed.bnbchain.org",
    attached: true,
    personal: false,
    registry: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
    published: PUBLISHED,
    local,
    identities: [],
    who: "lin",
    book: partial.book ?? book({}),
    probes: [],
    ...partial,
  };
}

test("an opened book with no looked-up address does not say the quota is exhausted", () => {
  const line = ledgerLine(desk({ identities: [], book: book({ remaining: "0", supply: "0" }) }), "live");
  assert.match(line, /供给 0/);
  assert.equal(line.includes("铸额已尽"), false);
  assert.equal(line.includes("尚未接入现网"), false);
});

test("a looked-up wallet without Agent ID gets the refusal line", () => {
  const line = ledgerLine(
    desk({
      identities: [{ id: "lin", title: "查阅", address: "0x1E483aa1351B8C77a0328f34D949f0B396BBc883", handle: "", agentBalance: "0", bnb: "0", eligible: false }],
      book: book({ remaining: "100000000000000000000", agentBalance: "0", handle: "", eligible: false }),
    }),
    "live",
  );
  assert.match(line, /这个地址没有 Agent ID/);
  assert.equal(line.includes("铸额已尽"), false);
});

test("an eligible agent with unused quota shows the remaining amount", () => {
  const line = ledgerLine(
    desk({
      identities: [{ id: "lin", title: "查阅", address: "0x8c3b6ED81CD80E9FB617e40B146709fb5d978309", handle: "imrich", agentBalance: "1", bnb: "0", eligible: true }],
      book: book({ remaining: "100000000000000000000", agentBalance: "1", handle: "imrich", eligible: true }),
    }),
    "live",
  );
  assert.match(line, /铸额 100 枚/);
  assert.equal(line.includes("铸额已尽"), false);
});
