import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { dealRole, canRead, canWrite } from "@/lib/mf-access";
import { loadCompanyForProject, listInvestments, listUpdates } from "@/lib/hpd-queries";
import { sql } from "@/db";
import ProjectNav from "../ProjectNav";
import UpdateComposer from "./UpdateComposer";
import SendPanel from "./SendPanel";
import { mailConfigured, mailFromAddress } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * INVESTOR UPDATES.
 *
 * You write what happened; the model writes the letter. It is forbidden from
 * inventing dates, distributions and milestones (see investor-update-ai.ts), and
 * everything it could not support comes back as an explicit list rather than
 * being quietly smoothed over.
 *
 * Nothing sends from here. Every update is a draft until a human sends it —
 * this is a communication to people who have given the company money, and the
 * send button is not a place to be clever.
 */
export default async function UpdatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const role = await dealRole(user, id);
  if (!canRead(role)) notFound();
  const editable = canWrite(role);

  const [deal] = await sql<{ name: string; stage: string }[]>`
    select name, stage from feasible.mf_deals where id = ${id}`;
  if (!deal) notFound();

  const company = await loadCompanyForProject(id);
  const investments = await listInvestments(id);
  const updates = await listUpdates(id);
  const mailReady = mailConfigured();
  const mailFrom = mailFromAddress();

  const recipients = investments.filter((i) => i.status !== "prospect");
  const missingEmail = recipients.filter((r) => !r.email);

  return (
    <Shell>
      <div className="mb-5">
        <Link href={`/multifamily/${id}`} className="text-xs uppercase tracking-wide text-muted hover:text-ink">
          ← {deal.name}
        </Link>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">Investor updates</h1>
        <p className="mt-1 text-sm text-muted">
          {recipients.length} investor{recipients.length === 1 ? "" : "s"} on this project
          {company?.name ? ` · ${company.name} branding` : ""}
        </p>
      </div>

      <ProjectNav dealId={id} active="/updates" />

      {missingEmail.length > 0 && (
        <p className="mb-4 rounded border border-line bg-white px-4 py-3 text-xs text-muted">
          <strong className="text-ink">
            {missingEmail.length} investor{missingEmail.length === 1 ? "" : "s"} without an email
          </strong>{" "}
          — {missingEmail.map((m) => m.name).join(", ")}. Their contact details are in Follow Up Boss;
          importing them needs <code>FUB_API_KEY</code>, which isn&rsquo;t set. Add an address on the
          Capital tab in the meantime.
        </p>
      )}

      {editable ? (
        <UpdateComposer projectId={id} recipients={recipients.map((r) => ({ name: r.name, email: r.email }))} />
      ) : (
        <p className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
          You have view access to this project, so you can read past updates but not write new ones.
        </p>
      )}

      {/* ---- History ---- */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-ink">Past updates</h2>
        {updates.length === 0 ? (
          <p className="mt-2 rounded-lg border border-line bg-white p-4 text-sm text-muted">
            Nothing written yet.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {updates.map((u) => (
              <details key={u.id} className="rounded-lg border border-line bg-white p-4">
                <summary className="cursor-pointer text-sm text-ink">
                  <span className="font-medium">{u.subject ?? "Untitled update"}</span>
                  <span className="ml-2 text-xs text-muted">
                    {new Date(u.created_at).toLocaleDateString()} ·{" "}
                    <span className="capitalize">{u.status}</span>
                    {u.status === "sent" && u.sent_at
                      ? ` ${new Date(u.sent_at).toLocaleDateString()}`
                      : ""}{" "}
                    · {u.recipients.length} recipient{u.recipients.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted">What you wrote</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{u.brief}</p>
                  <p className="mt-3 text-[11px] uppercase tracking-wide text-muted">The letter</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{u.body_text}</p>
                  {editable && (
                    <SendPanel
                      projectId={id}
                      update={u}
                      recipients={recipients.map((r) => ({ name: r.name, email: r.email }))}
                      mailReady={mailReady}
                      mailFrom={mailFrom}
                    />
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
