import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { blocksToSeconds, PHASE_BODY, seatPhase } from "./seatPhase.ts";

const openBook = {
  attached: true,
  open: true,
  windowFree: true,
  bookFull: false,
  alreadySeated: false,
  lookedUp: true,
  eligible: true,
  ownerMatches: true,
  emptyHandle: false,
};

test("block countdown uses 0.45 seconds and does not invent a clock", () => {
  assert.equal(blocksToSeconds(0n), "0.00");
  assert.equal(blocksToSeconds(1n), "0.45");
  assert.equal(blocksToSeconds(16n), "7.20");
  assert.equal(blocksToSeconds(160n), "72.00");
  assert.equal(blocksToSeconds(159n), "71.55");
});

test("seat phase distinguishes guard, open, taken, seated and no agent", () => {
  assert.equal(seatPhase({ ...openBook, open: false, windowFree: false }), "guard");
  assert.equal(seatPhase(openBook), "open");
  assert.equal(seatPhase({ ...openBook, windowFree: false }), "taken");
  assert.equal(seatPhase({ ...openBook, alreadySeated: true }), "seated");
  assert.equal(seatPhase({ ...openBook, eligible: false }), "no-agent");
  assert.equal(seatPhase({ ...openBook, ownerMatches: false }), "not-owner");
  assert.equal(seatPhase({ ...openBook, bookFull: true, windowFree: false }), "full");
  assert.equal(seatPhase({ ...openBook, attached: false, reason: "unopened" }), "unopened");
  assert.equal(seatPhase({ ...openBook, lookedUp: false, eligible: false }), "open");
});

test("second-book copy does not promise a payout", () => {
  const files = [
    "components/SeatDesk.tsx",
    "lib/seatPhase.ts",
    "lib/sign.ts",
    "lib/copy.ts",
    "app/rights/page.tsx",
    "app/seat/page.tsx",
  ];
  for (const file of files) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(text.includes("赚"), false, file);
    assert.equal(text.includes("被动"), false, file);
    const stripped = text.replaceAll("不承诺收益", "");
    assert.equal(stripped.includes("收益"), false, file);
  }
  for (const body of Object.values(PHASE_BODY)) {
    assert.equal(body.includes("赚"), false);
  }
});
