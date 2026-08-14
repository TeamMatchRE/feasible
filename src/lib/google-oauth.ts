import "server-only";
import { sql } from "@/db";

/**
 * GOOGLE OAUTH — a second, explicit consent, separate from signing in.
 *
 * Signing into Feasible goes through Supabase's Google provider, and that token
 * carries no Drive scope. Reading Heritage Point's folders therefore needs its
 * own consent, granted once per person and stored as a refresh token in
 * feasible.google_connections (migration 0010).
 *
 * WHY OAUTH AS THE USER, NOT A SERVICE ACCOUNT
 * The Heritage Point folders live in David's "Shared with me" and are mostly
 * OWNED BY NICK. A service account sees nothing until every folder is explicitly
 * re-shared with its address, and files it creates are owned by a robot rather
 * than by a person — awkward inside a Workspace, and a problem the day someone
 * audits ownership. Acting as the signed-in user means the app sees exactly what
 * that person already sees, and anything it writes belongs to them.
 *
 * SCOPE
 * `drive` (full) rather than `drive.file`, because the app must read folders it
 * did not create. That is a restricted scope, which for an EXTERNAL app would
 * need Google verification — but a Workspace app configured as INTERNAL is
 * exempt, which is the configuration these steps assume.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const clientId = () => process.env.GOOGLE_CLIENT_ID ?? null;
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? null;

export const googleConfigured = (): boolean => !!clientId() && !!clientSecret();

/**
 * The redirect Google sends the user back to. Must match an Authorized redirect
 * URI on the OAuth client EXACTLY — trailing slashes included.
 */
export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3010";
  return `${base}/api/google/callback`;
}

/**
 * `access_type=offline` + `prompt=consent` is what actually returns a refresh
 * token. Without them Google issues an access token that expires in an hour and
 * the connection silently dies — and on a re-consent it returns no refresh token
 * at all unless prompt=consent is forced.
 */
export function authUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: clientId() ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: DRIVE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string): Promise<
  { ok: true; refreshToken: string; scope: string } | { ok: false; error: string }
> {
  if (!googleConfigured()) return { ok: false, error: "Google OAuth is not configured." };

  const json = await tokenRequest({
    code,
    client_id: clientId()!,
    client_secret: clientSecret()!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });

  if (json.error) return { ok: false, error: json.error_description ?? json.error };
  if (!json.refresh_token) {
    // Almost always means a previous grant already exists and Google withheld a
    // new refresh token. prompt=consent should prevent it; if it happens, the
    // app's access must be removed at myaccount.google.com/permissions first.
    return {
      ok: false,
      error:
        "Google returned no refresh token. Remove Feasible at myaccount.google.com/permissions and connect again.",
    };
  }
  return { ok: true, refreshToken: json.refresh_token, scope: json.scope ?? DRIVE_SCOPES };
}

export async function saveConnection(profileId: string, email: string | null, refreshToken: string, scope: string) {
  await sql`
    insert into feasible.google_connections (profile_id, email, refresh_token, scopes)
    values (${profileId}, ${email}, ${refreshToken}, ${scope})
    on conflict (profile_id) do update
      set refresh_token = excluded.refresh_token,
          email = excluded.email,
          scopes = excluded.scopes,
          updated_at = now()`;
}

export async function getConnection(profileId: string) {
  const [row] = await sql<{ email: string | null; scopes: string | null; connected_at: string }[]>`
    select email, scopes, connected_at from feasible.google_connections where profile_id = ${profileId}`;
  return row ?? null;
}

export async function disconnect(profileId: string) {
  await sql`delete from feasible.google_connections where profile_id = ${profileId}`;
}

/**
 * A short-lived access token for this person, minted from their stored refresh
 * token on demand.
 *
 * Deliberately not cached: access tokens live an hour, the refresh call is
 * cheap, and a cache would be one more place a credential sits. The refresh
 * token itself never leaves the server.
 */
export async function accessTokenFor(profileId: string): Promise<
  { ok: true; token: string } | { ok: false; error: string; needsReconnect?: boolean }
> {
  if (!googleConfigured()) return { ok: false, error: "Google OAuth is not configured." };

  const [row] = await sql<{ refresh_token: string }[]>`
    select refresh_token from feasible.google_connections where profile_id = ${profileId}`;
  if (!row) return { ok: false, error: "Google Drive isn't connected.", needsReconnect: true };

  const json = await tokenRequest({
    refresh_token: row.refresh_token,
    client_id: clientId()!,
    client_secret: clientSecret()!,
    grant_type: "refresh_token",
  });

  if (json.error || !json.access_token) {
    // invalid_grant means the user revoked access, changed password, or the
    // token expired from disuse. That is a reconnect, not a retry.
    const needsReconnect = json.error === "invalid_grant";
    return {
      ok: false,
      error: json.error_description ?? json.error ?? "Could not refresh Google access.",
      needsReconnect,
    };
  }
  return { ok: true, token: json.access_token };
}

/**
 * What the setup actually needs, reported back to the UI so a misconfiguration
 * is diagnosable without reading Vercel's env list.
 */
export function oauthDiagnostics() {
  const id = clientId();
  return {
    configured: googleConfigured(),
    hasClientId: !!id,
    hasClientSecret: !!clientSecret(),
    /**
     * The client ID's leading segment — enough to check against the console at a
     * glance, and not a secret (client IDs are public; the secret is the secret).
     * This is the fastest way to catch the commonest failure: a redirect URI
     * registered on a NEW client while the deployment still carries an OLD one.
     */
    clientIdPrefix: id ? `${id.split("-")[0]}-${(id.split("-")[1] ?? "").slice(0, 6)}…` : null,
    redirectUri: redirectUri(),
    scopes: DRIVE_SCOPES,
  };
}
