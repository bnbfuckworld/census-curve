/** Published factory constants. Chain id 56 is checked against these. */
export const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
export const RPC = "http://127.0.0.1:18545";
export const BSC_RPC = "https://bsc-dataseed.bnbchain.org";
export const CHAIN_ID = 56;
export const SCALE = 100;

export const SLOPE = 10n ** 15n;
export const BASE = 10n ** 15n;
export const QUOTA0 = 100n * 10n ** 18n;
export const MARGINAL_AT_ZERO = BASE;
export const MARGINAL_AT_100 = SLOPE * 100n + BASE;
export const INTEGRAL_FIRST_100 = 51n * 10n ** 17n;
export const FEE_NUMERATOR = 997;
export const FEE_DENOMINATOR = 1000;

export const PUBLISHED = {
  slope: SLOPE.toString(),
  base: BASE.toString(),
  quota0: QUOTA0.toString(),
  scale: SCALE,
  marginalAtZero: MARGINAL_AT_ZERO.toString(),
  marginalAt100: MARGINAL_AT_100.toString(),
  integralFirst100: INTEGRAL_FIRST_100.toString(),
  feeNumerator: FEE_NUMERATOR,
  feeDenominator: FEE_DENOMINATOR,
};
