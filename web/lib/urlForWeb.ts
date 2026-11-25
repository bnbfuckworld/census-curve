import { failure } from "./copy";
import type { Failure } from "./types";

export function inspectUrlForWeb(
  raw: string,
): { ok: true; open: string } | { ok: false; failure: Failure } {
  const open = raw.trim();
  if (open.length === 0) return { ok: false, failure: failure("url-empty") };
  if (/\s/.test(open)) return { ok: false, failure: failure("url-bad") };
  let url: URL;
  try {
    url = new URL(open);
  } catch {
    return { ok: false, failure: failure("url-bad") };
  }
  if (url.protocol !== "https:") return { ok: false, failure: failure("url-bad") };
  if (url.username || url.password) return { ok: false, failure: failure("url-bad") };
  const host = url.hostname.toLowerCase();
  const hostOk = host === "binance.com" || host.endsWith(".binance.com");
  if (!hostOk) return { ok: false, failure: failure("url-host") };
  const lower = open.toLowerCase();
  if (lower.includes("walletconnect") || lower.includes("wc:")) {
    return { ok: false, failure: failure("url-wc") };
  }
  return { ok: true, open };
}
