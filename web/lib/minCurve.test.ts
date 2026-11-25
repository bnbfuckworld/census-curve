import assert from "node:assert/strict";
import test from "node:test";
import { failure } from "./copy.ts";
import { curveSizeIssue, MIN_CURVE_WEI } from "./minCurve.ts";

test("near-zero curve amounts are refused and one thousandth of a token is allowed", () => {
  assert.equal(MIN_CURVE_WEI, 10n ** 15n);
  assert.equal(curveSizeIssue(0n), "dust");
  assert.equal(curveSizeIssue(1n), "dust");
  assert.equal(curveSizeIssue(999n), "dust");
  assert.equal(curveSizeIssue(MIN_CURVE_WEI - 1n), "dust");
  assert.equal(curveSizeIssue(MIN_CURVE_WEI), null);
  assert.equal(curveSizeIssue(10n ** 18n), null);
});

test("dust failure tells the person to raise the amount", () => {
  const row = failure("dust");
  assert.match(row.title, /不提交/);
  assert.match(row.body, /0\.001/);
  assert.match(row.next, /0\.001/);
  assert.equal(row.body.includes("赚"), false);
});
