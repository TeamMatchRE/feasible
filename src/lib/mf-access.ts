import "server-only";
import { sql } from "@/db";
import type { SessionUser } from "@/lib/session";

/**
 * WHO CAN DO WHAT TO A MULTI-FAMILY DEAL.
 *
 * This module is the whole authorization story for shared deals. The app talks to
 * Postgres through a privileged role that bypasses RLS, so there is no database
 * policy underneath this as a second line of defence — if a call site forgets to
 * ask, the row is simply returned. Every read and write path therefore goes
 * through `dealRole` or one of the `require*` helpers below, and no query outside
 * this file should compare owner_id itself.
 *
 * Three levels, deliberately few:
 *
 *   owner   Created the deal. Reads, writes, deletes, and manages sharing.
 *   editor  Reads and writes. Cannot delete the deal or change who it is shared
 *           with — a collaborator must never be able to lock the owner out.
 *   viewer  Reads. Nothing else.
 *
 * Grants are keyed by EMAIL rather than profile id, because the person may not
 * have signed into Feasible yet and so may have no profile row. That means the
 * match happens against the session's email, which is issued by Google through
 * Supabase and gated to the Workspace domain before it ever reaches us
 * (lib/workspace.emailAllowed, applied in lib/session). We compare it lowercased
 * on both sides.
 */

export type DealRole = "owner" | "editor" | "viewer";

/** Everyone who can open the deal at all. */
const READ_ROLES: DealRole[] = ["owner", "editor", "viewer"];
/** Everyone who can save it. */
const WRITE_ROLES: DealRole[] = ["owner", "editor"];

/**
 * The caller's role on a deal, or null if they have none.
 *
 * A missing session email can never match a grant — returning null rather than
 * falling through to a broader query is the point.
 */
export async function dealRole(user: SessionUser, dealId: string): Promise<DealRole | null> {
  if (!dealId) return null;

  const email = user.email?.trim().toLowerCase() ?? null;

  const rows = await sql<{ role: DealRole }[]>`
    select case
             when d.owner_id = ${user.id} then 'owner'
             else a.role
           end as role
    from feasible.mf_deals d
    left join feasible.mf_deal_access a
      on a.deal_id = d.id
     and ${email}::text is not null
     and lower(a.email) = ${email}
    where d.id = ${dealId}
      and (d.owner_id = ${user.id} or a.id is not null)
    limit 1`;

  return rows[0]?.role ?? null;
}

export const canRead = (role: DealRole | null): boolean => role != null && READ_ROLES.includes(role);
export const canWrite = (role: DealRole | null): boolean => role != null && WRITE_ROLES.includes(role);
export const canManage = (role: DealRole | null): boolean => role === "owner";

/**
 * Assert a role for a write path. Returns the role so callers can branch further;
 * throws rather than returning a boolean nobody checks.
 */
export async function requireDealWrite(user: SessionUser, dealId: string): Promise<DealRole> {
  const role = await dealRole(user, dealId);
  if (!canWrite(role)) throw new Error("Not allowed to edit this deal.");
  return role as DealRole;
}

export async function requireDealOwner(user: SessionUser, dealId: string): Promise<DealRole> {
  const role = await dealRole(user, dealId);
  if (!canManage(role)) throw new Error("Only the deal's owner can do that.");
  return role as DealRole;
}

// ---------------------------------------------------------------------------
// Collaborator management — owner only, enforced by the callers above.
// ---------------------------------------------------------------------------

export type Collaborator = {
  id: string;
  email: string;
  role: Exclude<DealRole, "owner">;
  created_at: string;
  /** Filled in once the person has signed into Feasible at least once. */
  full_name: string | null;
  /** False until their first sign-in — the UI says "invited, hasn't signed in yet". */
  has_signed_in: boolean;
};

export async function listCollaborators(dealId: string): Promise<Collaborator[]> {
  return sql<Collaborator[]>`
    select a.id, a.email, a.role, a.created_at,
           p.full_name,
           (p.id is not null) as has_signed_in
    from feasible.mf_deal_access a
    left join feasible.profiles p on lower(p.email) = lower(a.email)
    where a.deal_id = ${dealId}
    order by a.created_at`;
}

/** The deal's owner, for the "shared with you by…" line. */
export async function dealOwner(dealId: string): Promise<{ email: string | null; full_name: string | null } | null> {
  const rows = await sql<{ email: string | null; full_name: string | null }[]>`
    select p.email, p.full_name
    from feasible.mf_deals d
    join feasible.profiles p on p.id = d.owner_id
    where d.id = ${dealId}`;
  return rows[0] ?? null;
}

/**
 * Add or update a grant. Idempotent on (deal, email) so re-inviting someone
 * changes their role instead of erroring or silently duplicating.
 */
export async function grantAccess(
  dealId: string,
  email: string,
  role: Exclude<DealRole, "owner">,
  invitedBy: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await sql`
    insert into feasible.mf_deal_access (deal_id, email, role, invited_by)
    values (${dealId}, ${normalized}, ${role}, ${invitedBy})
    on conflict (deal_id, lower(email))
      do update set role = excluded.role, invited_by = excluded.invited_by`;
}

export async function revokeAccess(dealId: string, accessId: string): Promise<void> {
  await sql`
    delete from feasible.mf_deal_access
    where id = ${accessId} and deal_id = ${dealId}`;
}
