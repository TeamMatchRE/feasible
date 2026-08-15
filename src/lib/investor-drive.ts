import "server-only";
import { sql } from "@/db";
import { listFolder, createFolder, findChildFolder, type DriveFile, type DriveResult } from "@/lib/drive";

/**
 * WHERE AN INVESTOR'S DOCUMENTS LIVE.
 *
 * Heritage Point already keeps `…/215 Chamberlain Hill Road/Equity Raise/<Last
 * name>/` — one folder per investor, created before this app existed. So the app
 * adopts that convention rather than inventing a parallel one; a second filing
 * system nobody asked for is worse than no filing system.
 *
 * ⚠️ MATCHING IS EXACT, NEVER FUZZY.
 * The three folders on this project are Stern, Stein and Karpf. "Stern" and
 * "Stein" differ by one character, and a fuzzy or nearest-match lookup would
 * eventually file one investor's signed commitment into another investor's
 * folder — a disclosure of one investor's documents to whoever can see the
 * other's. Exact, case-insensitive equality on the surname, or nothing.
 */

const EQUITY_RAISE = "Equity Raise";

/** The surname, as the folder convention uses it. */
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : fullName.trim();
}

export type FolderMatch =
  | { status: "found"; folder: DriveFile; equityRaiseId: string }
  | { status: "missing"; equityRaiseId: string; expected: string }
  | { status: "no_equity_raise"; rootId: string }
  | { status: "not_linked" }
  | { status: "error"; error: string; needsReconnect?: boolean };

/** The project's linked Drive root, if it has one. */
async function rootFolderId(projectId: string): Promise<string | null> {
  const [row] = await sql<{ folder_id: string }[]>`
    select folder_id from feasible.project_drive_links
    where project_id = ${projectId} order by created_at limit 1`;
  return row?.folder_id ?? null;
}

/**
 * Find this investor's folder under Equity Raise.
 *
 * Returns a DISTINCT state for every failure rather than collapsing them into
 * null, because the right response differs: a missing folder can be created, a
 * missing Equity Raise folder means the wrong root is linked, and a Drive error
 * might just need a reconnect.
 */
export async function findInvestorFolder(
  profileId: string,
  projectId: string,
  investorName: string,
): Promise<FolderMatch> {
  const rootId = await rootFolderId(projectId);
  if (!rootId) return { status: "not_linked" };

  const er = await findChildFolder(profileId, rootId, EQUITY_RAISE);
  if (!er.ok) return { status: "error", error: er.error, needsReconnect: er.needsReconnect };
  if (!er.data) return { status: "no_equity_raise", rootId };

  const surname = surnameOf(investorName);

  // Listed and compared here rather than handed to Drive as a name query, so the
  // equality is ours and provably exact — Drive's `name =` is exact too, but a
  // future change to a `contains` query would silently make Stern match Stein.
  const children = await listFolder(profileId, er.data.id);
  if (!children.ok) {
    return { status: "error", error: children.error, needsReconnect: children.needsReconnect };
  }

  const target = surname.toLowerCase();
  const match = children.data.find((f) => f.isFolder && f.name.trim().toLowerCase() === target);

  return match
    ? { status: "found", folder: match, equityRaiseId: er.data.id }
    : { status: "missing", equityRaiseId: er.data.id, expected: surname };
}

/** Create the surname folder under Equity Raise, following the existing convention. */
export async function createInvestorFolder(
  profileId: string,
  equityRaiseId: string,
  investorName: string,
): Promise<DriveResult<DriveFile>> {
  return createFolder(profileId, equityRaiseId, surnameOf(investorName));
}

/** What's already filed for this investor, straight from Drive. */
export async function listInvestorFiles(
  profileId: string,
  folderId: string,
): Promise<DriveResult<DriveFile[]>> {
  return listFolder(profileId, folderId);
}
