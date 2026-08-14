import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { exchangeCode, saveConnection } from "@/lib/google-oauth";

/**
 * Come back from Google, swap the code for a refresh token, store it.
 *
 * The refresh token is written straight to feasible.google_connections and never
 * leaves the server — it is not put in a cookie, a session, or any response body.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const jar = await cookies();

  const back = (params: string) => {
    const next = jar.get("feasible_google_next")?.value;
    jar.delete("feasible_google_state");
    jar.delete("feasible_google_next");
    const dest = next && next.startsWith("/") ? next : "/settings/google";
    return NextResponse.redirect(new URL(`${dest}${dest.includes("?") ? "&" : "?"}${params}`, req.url));
  };

  const err = url.searchParams.get("error");
  if (err) return back(`google=error&reason=${encodeURIComponent(err)}`);

  // CSRF: the state must match the one we set before leaving.
  const expected = jar.get("feasible_google_state")?.value;
  const got = url.searchParams.get("state");
  if (!expected || !got || expected !== got) {
    return back("google=error&reason=state_mismatch");
  }

  const code = url.searchParams.get("code");
  if (!code) return back("google=error&reason=no_code");

  const res = await exchangeCode(code);
  if (!res.ok) return back(`google=error&reason=${encodeURIComponent(res.error)}`);

  await saveConnection(user.id, user.email, res.refreshToken, res.scope);
  return back("google=connected");
}
