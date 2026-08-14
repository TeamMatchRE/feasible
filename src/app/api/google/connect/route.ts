import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { authUrl, googleConfigured } from "@/lib/google-oauth";

/**
 * Start the Drive consent.
 *
 * The `state` is a random value stored in an httpOnly cookie and compared on the
 * way back — without it, anyone could hand the signed-in user a crafted callback
 * URL and bind THEIR Google account's refresh token to this user's profile.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/settings/google?error=not_configured", req.url));
  }

  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set("feasible_google_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  // Where to land afterwards, so connecting from a project returns to it.
  const next = new URL(req.url).searchParams.get("next");
  if (next && next.startsWith("/")) {
    jar.set("feasible_google_next", next, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  }

  void user;
  return NextResponse.redirect(authUrl(state));
}
