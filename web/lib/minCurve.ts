/** Book 1 mints below this size can round the integral down to zero. */
export const MIN_CURVE_WEI = 10n ** 15n;

export function curveSizeIssue(wei: bigint): "dust" | null {
  if (wei < MIN_CURVE_WEI) return "dust";
  return null;
}
