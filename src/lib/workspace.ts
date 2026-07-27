/**
 * Brooke Group Workspace gate.
 *
 * The `hd` parameter on the Google sign-in button is a HINT to Google's account
 * chooser — it decides which accounts get offered, and enforces nothing. A
 * sign-in that bypasses the picker is not stopped by it, so the login screen's
 * "Restricted to @brookegrouprealestate.com accounts" was a promise the client
 * could not keep.
 *
 * Enforcement therefore lives here, server-side, and is applied at BOTH the
 * OAuth callback (reject at the door) and the per-request session helper (so an
 * already-issued cookie can't outlive the rule). That holds the line regardless
 * of how the shared brooke-identity Google provider happens to be configured —
 * which is one setting shared by every app on the hub.
 *
 * Default covers both team domains; all 28 brooke-identity accounts are on
 * brookegrouprealestate.com today, so the second is future-proofing, not
 * current access. Override per-app with ALLOWED_EMAIL_DOMAINS.
 */
export const ALLOWED_EMAIL_DOMAINS = (
  process.env.ALLOWED_EMAIL_DOMAINS || "brookegrouprealestate.com,brooketeamre.com"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** True only for an address inside the Brooke Group Workspace. */
export function emailAllowed(email: string | null | undefined): boolean {
  const domain = (email ?? "").split("@")[1]?.toLowerCase();
  return !!domain && ALLOWED_EMAIL_DOMAINS.includes(domain);
}
