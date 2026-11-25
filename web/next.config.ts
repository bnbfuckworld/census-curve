import type { NextConfig } from "next";

// Same string as web/lib/basePath.ts. Do not set assetPrefix:
// basePath already serves /_next under /curve, and assetPrefix would double it.
const BASE_PATH = "/curve";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  basePath: BASE_PATH,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
