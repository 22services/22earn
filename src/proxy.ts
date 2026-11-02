import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate: bounce visitors without a session cookie away from private areas.
 * The real authorization (valid session + role) happens server-side in every page/action.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("earn_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
