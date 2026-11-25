import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const path = new URL(request.url).pathname;
  if (path === "/curve") {
    return NextResponse.redirect(new URL("/curve/", request.url), 301);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
