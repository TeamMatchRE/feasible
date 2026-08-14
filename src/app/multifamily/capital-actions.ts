"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { requireUser } from "@/lib/session";
import { dealRole, canWrite } from "@/lib/mf-access";
import {
  loadCompanyForProject,
  listInvestments,
  listLots,
  loadUpdate,
  toInvestmentLike,
  toLotLike,
} from "@/lib/hpd-queries";
import { raiseProgress, summarizeLots } from "@/lib/capital";
import {
  draftInvestorUpdate,
  renderInvestorUpdateHtml,
  type Brand,
} from "@/lib/investor-update-ai";
import {
  mailConfigured,
  mailFromAddress,
  verifyMail,
  sendOne,
  sendMany,
  type DeliveryResult,
} from "@/lib/mailer";

/**
 * Capital-raise, lot, and investor-update writes.
 *
 * Every action gates on canWrite for the DEAL — the same check the underwriting
 * actions use (src/lib/mf-access.ts). A viewer invited to read a project must
 * not be able to add an investor to it or draft a letter that goes out under the
 * company's name.
 */

const num = (v: FormDataEntryValue | null, fallback = 0): number => {
  const n = Number(String(v ?? "").replace(/[$,%\s]/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const dateOrNull = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

async function gate(projectId: string) {
  const user = await requireUser();
  if (!canWrite(await dealRole(user, projectId))) return null;
  return user;
}

// ---------------------------------------------------------------------------
// Investors
// ---------------------------------------------------------------------------

export async function saveInvestor(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const user = await gate(projectId);
  if (!user) return;

  const company = await loadCompanyForProject(projectId);
  if (!company) return;

  const name = str(formData.get("name"));
  if (!name) return;

  const investorId = str(formData.get("investorId"));
  const fields = {
    entity_name: str(formData.get("entity_name")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    address: str(formData.get("address")),
    notes: str(formData.get("notes")),
  };

  let id = investorId;
  if (id) {
    await sql`
      update feasible.investors set
        name = ${name}, entity_name = ${fields.entity_name}, email = ${fields.email},
        phone = ${fields.phone}, address = ${fields.address}, notes = ${fields.notes},
        updated_at = now()
      where id = ${id} and company_id = ${company.id}`;
  } else {
    const [row] = await sql<{ id: string }[]>`
      insert into feasible.investors (company_id, name, entity_name, email, phone, address, notes)
      values (${company.id}, ${name}, ${fields.entity_name}, ${fields.email},
              ${fields.phone}, ${fields.address}, ${fields.notes})
      returning id`;
    id = row.id;
  }

  // Committed and contributed are tracked separately on purpose — a signed
  // commitment is not cash received. See capital.ts.
  const status = String(formData.get("status") || "committed");
  await sql`
    insert into feasible.investments
      (project_id, investor_id, committed_amount, contributed_amount, status, committed_at, funded_at, notes)
    values (${projectId}, ${id}, ${num(formData.get("committed_amount"))},
            ${num(formData.get("contributed_amount"))}, ${status},
            ${dateOrNull(formData.get("committed_at"))}, ${dateOrNull(formData.get("funded_at"))},
            ${str(formData.get("investment_notes"))})
    on conflict (project_id, investor_id) do update set
      committed_amount = excluded.committed_amount,
      contributed_amount = excluded.contributed_amount,
      status = excluded.status,
      committed_at = excluded.committed_at,
      funded_at = excluded.funded_at,
      notes = excluded.notes,
      updated_at = now()`;

  revalidatePath(`/multifamily/${projectId}/capital`);
}

export async function removeInvestment(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  if (!(await gate(projectId))) return;
  // Removes them from THIS project; the investor stays in the company's book.
  await sql`delete from feasible.investments
            where id = ${String(formData.get("investmentId"))} and project_id = ${projectId}`;
  revalidatePath(`/multifamily/${projectId}/capital`);
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

export async function saveLot(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  if (!(await gate(projectId))) return;

  const price = str(formData.get("list_price"));
  const sale = str(formData.get("sale_price"));

  await sql`
    update feasible.project_lots set
      style = ${str(formData.get("style"))},
      list_price = ${price == null ? 0 : num(formData.get("list_price"))},
      sale_price = ${sale == null ? null : num(formData.get("sale_price"))},
      status = ${String(formData.get("status") || "available")},
      buyer_name = ${str(formData.get("buyer_name"))},
      contract_date = ${dateOrNull(formData.get("contract_date"))},
      projected_closing = ${dateOrNull(formData.get("projected_closing"))},
      actual_closing = ${dateOrNull(formData.get("actual_closing"))},
      build_cost = ${str(formData.get("build_cost")) == null ? null : num(formData.get("build_cost"))}
    where id = ${String(formData.get("lotId"))} and project_id = ${projectId}`;

  revalidatePath(`/multifamily/${projectId}/lots`);
}

export async function addLot(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  if (!(await gate(projectId))) return;
  const [{ n }] = await sql<{ n: number }[]>`
    select coalesce(max(sort_order), 0) + 1 as n from feasible.project_lots where project_id = ${projectId}`;
  await sql`
    insert into feasible.project_lots (project_id, lot_number, status, sort_order)
    values (${projectId}, ${`Lot ${n}`}, 'available', ${n})`;
  revalidatePath(`/multifamily/${projectId}/lots`);
}

// ---------------------------------------------------------------------------
// Investor updates
// ---------------------------------------------------------------------------

export type DraftState = { error?: string; id?: string } | null;

/**
 * Turn the partner's brief into a drafted letter.
 *
 * DRAFTS ONLY. This writes a row with status 'draft' and never sends anything —
 * a human reads it, edits it, and sends it. See investor-update-ai.ts for why
 * the model is forbidden from inventing dates, distributions and milestones.
 */
export async function generateUpdate(_prev: DraftState, formData: FormData): Promise<DraftState> {
  const projectId = String(formData.get("projectId"));
  const user = await gate(projectId);
  if (!user) return { error: "You don't have permission to write updates for this project." };

  const brief = String(formData.get("brief") ?? "").trim();
  if (!brief) return { error: "Write a few lines about what's happening first." };

  const company = await loadCompanyForProject(projectId);
  if (!company) return { error: "This project isn't attached to a company yet." };

  const [deal] = await sql<{ name: string; address: string | null; city: string | null; state: string | null; stage: string }[]>`
    select name, address, city, state, stage from feasible.mf_deals where id = ${projectId}`;

  const investments = await listInvestments(projectId);
  const lots = await listLots(projectId);
  const raise = raiseProgress(toInvestmentLike(investments), 0);
  const lotSummary = summarizeLots(toLotLike(lots));

  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  // Only figures that are actually on record. The model may use these and
  // nothing else — see the system prompt in investor-update-ai.ts.
  const figures = [
    { label: "Homes in the community", value: String(lotSummary.total) },
    { label: "Under contract or reserved", value: String(lotSummary.underContract + lotSummary.reserved) },
    { label: "Closed", value: String(lotSummary.closed) },
    { label: "Committed capital", value: money(raise.committed) },
    { label: "Capital called to date", value: money(raise.funded) },
  ].filter((f) => f.value !== "0" || f.label.startsWith("Committed"));

  const result = await draftInvestorUpdate(brief, {
    companyName: company.name,
    companyTagline: company.tagline,
    projectName: deal?.name ?? "the project",
    projectAddress: [deal?.address, deal?.city, deal?.state].filter(Boolean).join(", "),
    stage: (deal?.stage ?? "underwriting").replace(/_/g, " "),
    figures,
  });

  if (!result.ok) return { error: result.error };

  const html = renderInvestorUpdateHtml({
    brand: company.brand,
    companyName: company.name,
    tagline: company.tagline,
    projectName: deal?.name ?? "",
    body: result.draft.body,
    greeting: "Dear investor,",
    signOffName: company.email_from_name ?? "",
    figures,
  });

  const recipients = investments
    .filter((i) => i.status !== "prospect")
    .map((i) => ({ name: i.name, email: i.email }));

  const [row] = await sql<{ id: string }[]>`
    insert into feasible.investor_updates
      (project_id, brief, subject, body_html, body_text, status, recipients, created_by)
    values (${projectId}, ${brief}, ${result.draft.subject}, ${html},
            ${result.draft.body}, 'draft', ${JSON.stringify(recipients)}::jsonb, ${user.id})
    returning id`;

  revalidatePath(`/multifamily/${projectId}/updates`);
  return { id: row.id };
}

export async function saveUpdateEdits(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  if (!(await gate(projectId))) return;
  await sql`
    update feasible.investor_updates
       set subject = ${str(formData.get("subject"))},
           body_text = ${str(formData.get("body_text"))}
     where id = ${String(formData.get("updateId"))} and project_id = ${projectId}
       and status <> 'sent'`;
  revalidatePath(`/multifamily/${projectId}/updates`);
}

export async function deleteUpdate(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  if (!(await gate(projectId))) return;
  await sql`delete from feasible.investor_updates
            where id = ${String(formData.get("updateId"))} and project_id = ${projectId}
              and status <> 'sent'`;
  revalidatePath(`/multifamily/${projectId}/updates`);
}

// ---------------------------------------------------------------------------
// SENDING
//
// The one irreversible action in this app. Four things guard it:
//
//   1. Editor access on the deal, like every other write here.
//   2. An update that has already been sent can never be sent again — the
//      status check is in the SQL, so a double-clicked button or a stale tab
//      cannot mail investors twice.
//   3. The recipient list is re-read from the database at send time, not taken
//      from the form. A hidden field is not where a list of investors to mail
//      should come from.
//   4. Delivery is recorded per address, so a partial send is visible and
//      re-sendable to the ones that failed.
//
// A test send goes to the signed-in user and nobody else, and does not change
// the update's status.
// ---------------------------------------------------------------------------

export type SendState = { error?: string; ok?: string; results?: DeliveryResult[] } | null;

/** The letter, addressed to one person. */
function buildFor(
  a: { name: string },
  update: { subject: string | null; body_text: string | null },
  company: { name: string; tagline: string | null; brand: Brand; email_from_name: string | null },
  projectName: string,
  figures: { label: string; value: string }[],
) {
  const first = a.name.trim().split(/\s+/)[0] || "there";
  const greeting = `Dear ${first},`;
  const text = `${greeting}\n\n${update.body_text ?? ""}\n\n${company.email_from_name ?? ""}\n${company.name}`;
  const html = renderInvestorUpdateHtml({
    brand: company.brand,
    companyName: company.name,
    tagline: company.tagline,
    projectName,
    body: update.body_text ?? "",
    greeting,
    signOffName: company.email_from_name ?? "",
    figures,
  });
  return { subject: update.subject ?? `${projectName} — update`, html, text };
}

async function updateContext(projectId: string, updateId: string) {
  const company = await loadCompanyForProject(projectId);
  const [deal] = await sql<{ name: string }[]>`select name from feasible.mf_deals where id = ${projectId}`;
  const update = await loadUpdate(updateId, projectId);
  if (!company || !deal || !update) return null;

  const investments = await listInvestments(projectId);
  const lots = await listLots(projectId);
  const raise = raiseProgress(toInvestmentLike(investments), 0);
  const lotSummary = summarizeLots(toLotLike(lots));
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  const figures = [
    { label: "Homes in the community", value: String(lotSummary.total) },
    { label: "Under contract or reserved", value: String(lotSummary.underContract + lotSummary.reserved) },
    { label: "Closed", value: String(lotSummary.closed) },
    { label: "Committed capital", value: money(raise.committed) },
    { label: "Capital called to date", value: money(raise.funded) },
  ];

  return { company, deal, update, investments, figures };
}

/** Send the drafted letter to the signed-in user only, so they can see it as an investor will. */
export async function sendTestUpdate(_prev: SendState, formData: FormData): Promise<SendState> {
  const projectId = String(formData.get("projectId"));
  const user = await gate(projectId);
  if (!user) return { error: "You don't have permission to send from this project." };
  if (!mailConfigured()) {
    return { error: "Email isn't configured yet — GMAIL_USER and GMAIL_APP_PASSWORD need to be set." };
  }
  if (!user.email) return { error: "Your account has no email address." };

  const ctx = await updateContext(projectId, String(formData.get("updateId")));
  if (!ctx) return { error: "That update no longer exists." };

  const msg = buildFor(
    { name: user.fullName ?? "there" },
    ctx.update,
    ctx.company,
    ctx.deal.name,
    ctx.figures,
  );
  const res = await sendOne({
    to: user.email,
    subject: `[TEST] ${msg.subject}`,
    html: msg.html,
    text: msg.text,
    fromName: ctx.company.name,
  });

  return res.ok
    ? { ok: `Test sent to ${user.email}. Nothing went to investors.` }
    : { error: res.error };
}

/**
 * Send to the project's investors. Irreversible.
 *
 * Prospects are excluded — they haven't committed, and an update about a raise
 * they aren't in is the wrong letter.
 */
export async function sendUpdateToInvestors(_prev: SendState, formData: FormData): Promise<SendState> {
  const projectId = String(formData.get("projectId"));
  const updateId = String(formData.get("updateId"));
  const user = await gate(projectId);
  if (!user) return { error: "You don't have permission to send from this project." };
  if (!mailConfigured()) {
    return { error: "Email isn't configured yet — GMAIL_USER and GMAIL_APP_PASSWORD need to be set." };
  }

  // Claim the update first: flip it out of 'draft' in one conditional statement
  // so a second click finds nothing to claim and cannot mail anyone twice.
  const claimed = await sql<{ id: string }[]>`
    update feasible.investor_updates
       set status = 'sent', sent_at = now(), sent_by = ${user.id}
     where id = ${updateId} and project_id = ${projectId} and status <> 'sent'
    returning id`;
  if (claimed.length === 0) {
    return { error: "This update has already been sent." };
  }

  const ctx = await updateContext(projectId, updateId);
  if (!ctx) return { error: "That update no longer exists." };

  // Re-read the list from the database rather than trusting the form.
  const addressees = ctx.investments
    .filter((i) => i.status !== "prospect")
    .map((i) => ({ name: i.name, email: i.email }));

  if (addressees.length === 0) {
    await sql`update feasible.investor_updates set status = 'draft', sent_at = null where id = ${updateId}`;
    return { error: "There are no committed investors on this project to send to." };
  }

  const results = await sendMany(
    addressees,
    (a) => buildFor(a, ctx.update, ctx.company, ctx.deal.name, ctx.figures),
    { fromName: ctx.company.name, replyTo: ctx.company.email_from_address },
  );

  const delivered = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  await sql`
    update feasible.investor_updates
       set delivery = ${JSON.stringify(results)}::jsonb,
           send_error = ${delivered === 0 ? "No message was delivered." : null},
           status = ${delivered === 0 ? "draft" : "sent"},
           sent_at = ${delivered === 0 ? null : new Date().toISOString()}
     where id = ${updateId}`;

  revalidatePath(`/multifamily/${projectId}/updates`);

  if (delivered === 0) {
    return { error: `Nothing was delivered. ${failed[0]?.error ?? ""}`.trim(), results };
  }
  return {
    ok:
      failed.length === 0
        ? `Sent to all ${delivered} investors.`
        : `Sent to ${delivered} of ${results.length}. ${failed.length} failed — see below.`,
    results,
  };
}

/** Authenticate against Gmail without sending, so config can be checked safely. */
export async function checkMail(): Promise<{ ok: boolean; error?: string; from?: string | null }> {
  await requireUser();
  const res = await verifyMail();
  return res.ok ? { ok: true, from: mailFromAddress() } : { ok: false, error: res.error };
}
