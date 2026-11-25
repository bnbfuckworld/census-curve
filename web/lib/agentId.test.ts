import assert from "node:assert/strict";
import test from "node:test";
import { parseTokenId, tokenIdHex, tokenIdOfHandle } from "./agentId.ts";

test("imrich hashes to the Agent ID token that ownerOf returns on BSC", () => {
  const id = tokenIdOfHandle("imrich");
  assert.equal(tokenIdHex(id), "0x54d33687e4a7a59a56c64a1eaa196135e7a3b91ed40c3c9064915b2efa147e9c");
});

test("token ids accept decimal and hex and reject blanks", () => {
  assert.equal(parseTokenId(""), null);
  assert.equal(parseTokenId("  "), null);
  assert.equal(parseTokenId("1"), 1n);
  assert.equal(parseTokenId("0x10"), 16n);
  assert.equal(parseTokenId("nope"), null);
});
