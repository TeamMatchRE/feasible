import "server-only";
import { sql } from "@/db";
import { asJson } from "@/lib/mf-queries";
import type { Brand } from "@/lib/investor-update-ai";
import type { InvestmentLike, LotLike } from "@/lib/capital";

/**
 * Reads for the company / capital / lots side of a project.
 *
 * Access is NOT re-derived here — every caller has already resolved the deal's
 * role through src/lib/mf-access.ts, which stays the single place that decides
 * who can see what. These functions take an id that has already been authorised.
 */

export type Company = {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  tagline: string | null;
  website: string | null;
  brand: Brand;
  drive_root_folder_id: string | null;
  email_from_name: string | null;
  email_from_address: string | null;
};

export async function loadCompanyForProject(projectId: string): Promise<Company | null> {
  const [row] = await sql<Record<string, unknown>[]>`
    select c.id, c.slug, c.name, c.legal_name, c.tagline, c.website, c.brand,
           c.drive_root_folder_id, c.email_from_name, c.email_from_address
    from feasible.companies c
    join feasible.mf_deals d on d.company_id = c.id
    where d.id = ${projectId}`;
  if (!row) return null;
  return { ...(row as unknown as Company), brand: asJson<Brand>(row.brand, {}) };
}

// ---------------------------------------------------------------------------
// Investors
// ---------------------------------------------------------------------------

export type InvestorRow = {
  investment_id: string;
  investor_id: string;
  name: string;
  entity_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  fub_person_id: string | null;
  committed_amount: number;
  contributed_amount: number;
  status: InvestmentLike["status"];
  committed_at: string | null;
  funded_at: string | null;
  notes: string | null;
  documents: number;
};

export async function listInvestments(projectId: string): Promise<InvestorRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select i.id as investment_id, v.id as investor_id, v.name, v.entity_name,
           v.email, v.phone, v.address, v.fub_person_id,
           i.committed_amount, i.contributed_amount, i.status,
           i.committed_at, i.funded_at, i.notes,
           (select count(*) from feasible.investment_documents d where d.investment_id = i.id)::int as documents
    from feasible.investments i
    join feasible.investors v on v.id = i.investor_id
    where i.project_id = ${projectId}
    order by i.committed_amount desc, v.name`;
  return rows.map((r) => ({
    ...(r as unknown as InvestorRow),
    committed_amount: Number(r.committed_amount ?? 0),
    contributed_amount: Number(r.contributed_amount ?? 0),
  }));
}

/** The engine's shape, so capital.ts never has to know about the database. */
export const toInvestmentLike = (rows: InvestorRow[]): InvestmentLike[] =>
  rows.map((r) => ({
    investorId: r.investor_id,
    investorName: r.name,
    committedAmount: r.committed_amount,
    contributedAmount: r.contributed_amount,
    status: r.status,
  }));

/** Everyone in the company's book, including people not on this project yet. */
export async function listCompanyInvestors(companyId: string) {
  return sql<{ id: string; name: string; email: string | null }[]>`
    select id, name, email from feasible.investors
    where company_id = ${companyId} order by name`;
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

export type LotRow = {
  id: string;
  lot_number: string;
  style: string | null;
  list_price: number | null;
  sale_price: number | null;
  status: LotLike["status"];
  buyer_name: string | null;
  contract_date: string | null;
  projected_closing: string | null;
  actual_closing: string | null;
  build_cost: number | null;
  notes: string | null;
  sort_order: number;
};

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
/** postgres-js returns `date` as a Date; the UI wants a plain YYYY-MM-DD. */
const dateOrNull = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

export async function listLots(projectId: string): Promise<LotRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select id, lot_number, style, list_price, sale_price, status, buyer_name,
           contract_date, projected_closing, actual_closing, build_cost, notes, sort_order
    from feasible.project_lots
    where project_id = ${projectId}
    order by sort_order, lot_number`;
  return rows.map((r) => ({
    ...(r as unknown as LotRow),
    list_price: numOrNull(r.list_price),
    sale_price: numOrNull(r.sale_price),
    build_cost: numOrNull(r.build_cost),
    contract_date: dateOrNull(r.contract_date),
    projected_closing: dateOrNull(r.projected_closing),
    actual_closing: dateOrNull(r.actual_closing),
  }));
}

export const toLotLike = (rows: LotRow[]): LotLike[] =>
  rows.map((r) => ({
    id: r.id,
    lotNumber: r.lot_number,
    style: r.style,
    listPrice: r.list_price,
    salePrice: r.sale_price,
    status: r.status,
    buyerName: r.buyer_name,
    projectedClosing: r.projected_closing,
    actualClosing: r.actual_closing,
    buildCost: r.build_cost,
  }));

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export type UpdateRow = {
  id: string;
  brief: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  status: "draft" | "approved" | "sent";
  recipients: { name: string; email: string | null }[];
  created_at: string;
  sent_at: string | null;
};

export async function listUpdates(projectId: string): Promise<UpdateRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select id, brief, subject, body_html, body_text, status, recipients, created_at, sent_at
    from feasible.investor_updates
    where project_id = ${projectId}
    order by created_at desc`;
  return rows.map((r) => ({
    ...(r as unknown as UpdateRow),
    recipients: asJson<UpdateRow["recipients"]>(r.recipients, []),
  }));
}

export async function loadUpdate(id: string, projectId: string): Promise<UpdateRow | null> {
  const [r] = await sql<Record<string, unknown>[]>`
    select id, brief, subject, body_html, body_text, status, recipients, created_at, sent_at
    from feasible.investor_updates where id = ${id} and project_id = ${projectId}`;
  if (!r) return null;
  return { ...(r as unknown as UpdateRow), recipients: asJson<UpdateRow["recipients"]>(r.recipients, []) };
}
