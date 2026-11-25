export function formatUnits(wei: string, decimals = 18, maxFrac = 6): string {
  const v = BigInt(wei);
  const neg = v < 0n;
  const x = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = x / base;
  const fracFull = (x % base).toString().padStart(decimals, "0");
  const frac = fracFull.slice(0, maxFrac).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac ? `${wholeStr}.${frac}` : wholeStr;
  return neg ? `-${body}` : body;
}

export function formatExact(wei: string, decimals = 18): string {
  const v = BigInt(wei);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

export function groupInteger(value: string): string {
  const neg = value.startsWith("-");
  const digits = neg ? value.slice(1) : value;
  const body = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return neg ? `-${body}` : body;
}

export function formatBnb(wei: string): string {
  return `${formatUnits(wei, 18, 6)} BNB`;
}

export function formatToken(wei: string): string {
  return `${formatUnits(wei, 18, 4)} 枚`;
}

export function formatWei(wei: string): string {
  return `${groupInteger(wei)} wei`;
}
