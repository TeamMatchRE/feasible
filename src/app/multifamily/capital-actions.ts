"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { requireUser } from "@/lib/session";
import { dealRole, canWrite } from "@/lib/mf-access";
import {
  loadCompanyForProject,
  listInvestments,
  listLots,
  toInvestmentLike,
  toLotLike,
} from "@/lib/hpd-queries";
import { raiseProgress, summarizeLots } from "@/lib/capital";
import { draftInvestorUpdate, renderInvestorUpdateHtml } from "@/lib/investor-update-ai";

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
