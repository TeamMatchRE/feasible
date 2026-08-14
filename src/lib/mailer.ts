import "server-only";
import nodemailer from "nodemailer";

/**
 * OUTBOUND MAIL.
 *
 * Gmail SMTP with an app password, matching the pattern the other Brooke Team
 * apps already use (see lib/email.ts in solar-roofing-app) — same env var names,
 * so the app password David already generated works here without making another.
 *
 * DESIGN NOTES THAT MATTER FOR INVESTOR MAIL
 *
 * · ONE MESSAGE PER RECIPIENT, never a shared To: or Cc:. Investors in a private
 *   raise should not learn who else is in the deal, or each other's addresses,
 *   because someone reached for a convenient bulk send.
 *
 * · PARTIAL DELIVERY IS THE NORMAL FAILURE. One stale address bounces and the
 *   rest land. `sendMany` therefore returns a result PER ADDRESS and never
 *   throws for a single bad one — the caller records exactly who got it, so
 *   re-sending to the one that failed doesn't mean re-sending to everyone.
 *
 * · Nothing here decides WHETHER to send. That is a human pressing a button
 *   after reading the draft; see the confirm step in UpdateComposer.
 */

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

export const mailConfigured = (): boolean => !!GMAIL_USER && !!GMAIL_APP_PASSWORD;

/** The address mail actually leaves from — shown in the UI so it's never a surprise. */
export const mailFromAddress = (): string | null => GMAIL_USER ?? null;

function transport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

/**
 * Authenticate without sending anything.
 *
 * Lets the UI say "credentials work" before a human commits to mailing real
 * investors, instead of discovering a bad app password halfway through a send.
 */
export async function verifyMail(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailConfigured()) {
    return { ok: false, error: "GMAIL_USER and GMAIL_APP_PASSWORD are not set." };
  }
  try {
    await transport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SMTP verification failed." };
  }
}

export type Addressee = { name: string; email: string | null };

export type DeliveryResult = {
  name: string;
  email: string | null;
  ok: boolean;
  error?: string;
  at: string;
};

export type SendOne = {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string | null;
  replyTo?: string | null;
};

export async function sendOne(msg: SendOne): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailConfigured()) return { ok: false, error: "Email is not configured." };
  try {
    await transport().sendMail({
      from: msg.fromName ? `"${msg.fromName}" <${GMAIL_USER}>` : GMAIL_USER,
      to: msg.to,
      replyTo: msg.replyTo ?? undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed." };
  }
}

/**
 * Send the same update to each addressee individually.
 *
 * `personalize` receives the addressee so the greeting can name them; everything
 * else is identical. An addressee with no email is recorded as a failure rather
 * than skipped silently — "we sent it to everyone" must not be true of a list
 * that quietly dropped two people.
 */
export async function sendMany(
  addressees: Addressee[],
  build: (a: Addressee) => { subject: string; html: string; text: string },
  opts: { fromName?: string | null; replyTo?: string | null } = {},
): Promise<DeliveryResult[]> {
  const out: DeliveryResult[] = [];

  for (const a of addressees) {
    const at = new Date().toISOString();
    if (!a.email) {
      out.push({ name: a.name, email: null, ok: false, error: "No email address on file.", at });
      continue;
    }
    const msg = build(a);
    const res = await sendOne({
      to: a.email,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      fromName: opts.fromName,
      replyTo: opts.replyTo,
    });
    out.push({
      name: a.name,
      email: a.email,
      ok: res.ok,
      error: res.ok ? undefined : res.error,
      at: new Date().toISOString(),
    });
  }

  return out;
}
