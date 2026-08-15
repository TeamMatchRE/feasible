import Link from "next/link";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import {
  getConnection,
  oauthDiagnostics,
  disconnect,
  testClientCredentials,
} from "@/lib/google-oauth";
import { SubmitButton } from "@/components/SubmitButton";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function probeCredentials() {
  "use server";
  await requireUser();
  const res = await testClientCredentials();
  // Round-trips through the URL so the result survives the redirect, and so the
  // page stays a plain server component with no client state to manage.
  redirect(
    res.ok
      ? "/settings/google?probe=ok"
      : `/settings/google?probe=fail&reason=${encodeURIComponent(res.error)}`,
  );
}

async function disconnectGoogle() {
  "use server";
  const user = await requireUser();
  await disconnect(user.id);
  revalidatePath("/settings/google");
}

/**
 * Connect Google Drive, and diagnose it when it doesn't work.
 *
 * The diagnostics matter more than they look: the single most common setup
 * failure is a redirect URI that doesn't match the OAuth client character for
 * character, and Google's error for that says almost nothing. Printing the exact
 * URI this deployment will send turns a guessing game into a copy-paste.
 */
export default async function GoogleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string; probe?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const conn = await getConnection(user.id);
  const diag = oauthDiagnostics();

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="font-display text-3xl tracking-tight text-ink">Google Drive</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Feasible reads project files as <strong>you</strong> — so folders shared with your account,
          including Heritage Point&rsquo;s, work without re-sharing anything. Signing in doesn&rsquo;t
          grant this; it&rsquo;s a separate one-time consent.
        </p>
      </div>

      {sp.google === "connected" && (
        <p className="mb-4 rounded border border-line bg-white px-4 py-3 text-sm text-ink">
          Connected. Drive folders can now be linked to a project.
        </p>
      )}
      {sp.google === "error" && (
        <p className="mb-4 rounded border border-line bg-white px-4 py-3 text-sm text-red-600">
          Couldn&rsquo;t connect: {sp.reason ?? "unknown error"}
        </p>
      )}

      {sp.probe === "ok" && (
        <p className="mb-4 rounded border border-line bg-white px-4 py-3 text-sm text-ink">
          Client ID and secret authenticate correctly. If connecting still fails, the problem is
          elsewhere.
        </p>
      )}
      {sp.probe === "fail" && (
        <p className="mb-4 rounded border border-line bg-white px-4 py-3 text-sm text-red-600">
          {sp.reason ?? "The credentials were rejected."}
        </p>
      )}

      <div className="rounded-lg border border-line bg-white p-4">
        {conn ? (
          <>
            <p className="text-sm text-ink">
              Connected as <strong>{conn.email ?? "your Google account"}</strong>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              since {new Date(conn.connected_at).toLocaleDateString()}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href="/api/google/connect"
                className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-line/30"
              >
                Reconnect
              </a>
              <form action={disconnectGoogle}>
                <SubmitButton className="text-xs text-muted hover:text-red-600">Disconnect</SubmitButton>
              </form>
            </div>
          </>
        ) : diag.configured ? (
          <>
            <p className="text-sm text-ink">Not connected yet.</p>
            <a
              href="/api/google/connect"
              className="mt-3 inline-block rounded bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90"
            >
              Connect Google Drive
            </a>
          </>
        ) : (
          <p className="text-sm text-muted">
            <strong className="text-ink">Not configured.</strong> The OAuth client credentials
            aren&rsquo;t set on this deployment — see the setup below.
          </p>
        )}
      </div>

      {/* ---- Setup ---- */}
      <div className="mt-5 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">Setup</h2>

        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-40 text-muted">Client ID present</dt>
            <dd className={diag.hasClientId ? "text-ink" : "text-red-600"}>
              {diag.hasClientId ? "yes" : "no — set GOOGLE_CLIENT_ID"}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-40 text-muted">Client secret present</dt>
            <dd className={diag.hasClientSecret ? "text-ink" : "text-red-600"}>
              {diag.hasClientSecret ? "yes" : "no — set GOOGLE_CLIENT_SECRET"}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-40 shrink-0 text-muted">Client ID in use</dt>
            <dd className="break-all font-mono text-ink">{diag.clientIdPrefix ?? "—"}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-40 shrink-0 text-muted">Redirect URI</dt>
            <dd className="break-all font-mono text-ink">{diag.redirectUri}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-40 shrink-0 text-muted">Scopes requested</dt>
            <dd className="break-all font-mono text-ink">{diag.scopes}</dd>
          </div>
        </dl>

        <form action={probeCredentials} className="mt-4 border-t border-line pt-3">
          <SubmitButton
            pendingLabel="Asking Google…"
            className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-line/30"
          >
            Test the client ID and secret
          </SubmitButton>
          <span className="ml-2 text-[11px] text-muted">
            Checks the pair against Google without signing in or granting anything.
          </span>
        </form>

        <p className="mt-4 text-[11px] uppercase tracking-wide text-muted">In Google Cloud console</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
          <li>
            Pick or create a project, then <strong>enable the Google Drive API</strong> (APIs &amp;
            Services → Library → Google Drive API → Enable). Requests fail with a 403 until this is
            done.
          </li>
          <li>
            OAuth consent screen → <strong>User type: Internal</strong>. Internal is what lets this
            use the full Drive scope without Google verification, and it restricts consent to
            @brookegrouprealestate.com accounts.
          </li>
          <li>
            Credentials → Create credentials → <strong>OAuth client ID</strong> → Web application.
          </li>
          <li>
            Under <strong>Authorized redirect URIs</strong> add the redirect URI shown above,{" "}
            <em>exactly</em> — a trailing slash or http/https mismatch is the usual failure, and
            Google&rsquo;s error message for it is unhelpful.
          </li>
          <li>
            Copy the client ID and secret into Vercel as <code>GOOGLE_CLIENT_ID</code> and{" "}
            <code>GOOGLE_CLIENT_SECRET</code>, then redeploy.
          </li>
        </ol>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          <strong className="text-ink">If Google says redirect_uri_mismatch:</strong> the app is
          sending the URI above, so either it isn&rsquo;t registered on the client shown above
          (check the client ID matches the one you edited — a URI added to a <em>different</em>
          client is the usual cause), or it was added but Google hasn&rsquo;t propagated it yet,
          which can take a few minutes.
        </p>
      </div>

      <p className="mt-4 text-xs text-muted">
        <Link href="/multifamily" className="underline underline-offset-2">
          Back to projects
        </Link>
      </p>
    </Shell>
  );
}
