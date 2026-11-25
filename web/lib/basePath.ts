// Keep this identical to BASE_PATH in next.config.ts.
// assetPrefix is intentionally unset: basePath already prefixes /_next.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/curve";

/** Absolute path under the public mount. Leading slash in, trailing slash out. */
export function withBase(path: string): string {
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? "" : path.slice(queryAt);
  let normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (!normalized.endsWith("/")) normalized += "/";
  return `${BASE_PATH}${normalized}${query}`;
}
