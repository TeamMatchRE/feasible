"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { requireUser } from "@/lib/session";
import { dealRole, canWrite } from "@/lib/mf-access";
import { parseFolderId, getFile, uploadFile } from "@/lib/drive";
import {
  findInvestorFolder,
  createInvestorFolder,
  surnameOf,
} from "@/lib/investor-drive";

/**
 * Linking a project to its Drive folder.
 *
 * The link is VERIFIED before it is saved: the folder is fetched as the signed-in
 * user, so a mistyped id or a folder nobody shared fails here with a clear reason
 * rather than becoming a dead link discovered later. The folder's real name is
 * stored, not whatever the user typed.
 */

export type LinkState = { error?: string; ok?: string } | null;

export async function linkDriveFolder(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const projectId = String(formData.get("projectId"));
  const user = await requireUser();
  if (!canWrite(await dealRole(user, projectId))) {
    return { error: "You don't have permission to change this project." };
  }

  const folderId = parseFolderId(String(formData.get("folder") ?? ""));
  if (!folderId) {
    return { error: "That doesn't look like a Drive folder link or id." };
  }

  const found = await getFile(user.id, folderId);
  if (!found.ok) {
    return {
      error: found.needsReconnect
        ? "Connect Google Drive first — Settings → Google Drive."
        : found.error,
    };
  }
  if (!found.data.isFolder) {
    return { error: `“${found.data.name}” is a file, not a folder.` };
  }

  await sql`
    insert into feasible.project_drive_links (project_id, label, stage, folder_id, url)
    values (${projectId}, ${found.data.name}, ${String(formData.get("stage") || "") || null},
            ${folderId}, ${found.data.webViewLink})
    on conflict (project_id, folder_id) do update
      set label = excluded.label, url = excluded.url`;

  revalidatePath(`/multifamily/${projectId}/files`);
  return { ok: `Linked “${found.data.name}”.` };
}

export async function unlinkDriveFolder(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const user = await requireUser();
  if (!canWrite(await dealRole(user, projectId))) return;
  await sql`delete from feasible.project_drive_links
            where id = ${String(formData.get("linkId"))} and project_id = ${projectId}`;
  revalidatePath(`/multifamily/${projectId}/files`);
}

// ---------------------------------------------------------------------------
// FILING INVESTOR DOCUMENTS
//
// Uploads land in the folder Heritage Point already uses:
//   …/215 Chamberlain Hill Road/Equity Raise/<Surname>/
//
// The upload is REFUSED unless that folder was resolved by exact surname match
// (see investor-drive.ts). Filing a signed commitment into the wrong investor's
// folder would disclose one investor's documents to whoever can see another's,
// and Stern/Stein on this very project are one character apart — so there is no
// nearest-match fallback and no "file it at the top level instead" path.
// ---------------------------------------------------------------------------

export type FileState = { error?: string; ok?: string } | null;

const MAX_UPLOAD = 15 * 1024 * 1024;

export async function fileInvestorDocument(_prev: FileState, formData: FormData): Promise<FileState> {
  const projectId = String(formData.get("projectId"));
  const investmentId = String(formData.get("investmentId"));
  const user = await requireUser();
  if (!canWrite(await dealRole(user, projectId))) {
    return { error: "You don't have permission to file documents on this project." };
  }

  const [inv] = await sql<{ name: string }[]>`
    select v.name from feasible.investments i
    join feasible.investors v on v.id = i.investor_id
    where i.id = ${investmentId} and i.project_id = ${projectId}`;
  if (!inv) return { error: "That investor isn't on this project." };

  const upload = formData.get("file");
  if (!(upload instanceof File) || upload.size === 0) return { error: "Choose a file first." };
  if (upload.size > MAX_UPLOAD) {
    return { error: `That file is ${(upload.size / 1024 / 1024).toFixed(1)} MB — the limit is 15 MB.` };
  }

  const match = await findInvestorFolder(user.id, projectId, inv.name);

  let folderId: string;
  if (match.status === "found") {
    folderId = match.folder.id;
  } else if (match.status === "missing") {
    // Create it rather than filing somewhere approximate.
    const created = await createInvestorFolder(user.id, match.equityRaiseId, inv.name);
    if (!created.ok) return { error: created.error };
    folderId = created.data.id;
  } else if (match.status === "no_equity_raise") {
    return { error: `No "Equity Raise" folder under the linked Drive folder for this project.` };
  } else if (match.status === "not_linked") {
    return { error: "Link this project's Drive folder first, on the Files tab." };
  } else {
    return { error: match.error };
  }

  const bytes = new Uint8Array(await upload.arrayBuffer());
  const res = await uploadFile(user.id, folderId, {
    name: upload.name,
    mimeType: upload.type || "application/octet-stream",
    bytes,
  });
  if (!res.ok) return { error: res.error };

  const kind = String(formData.get("kind") || "other");
  const status = String(formData.get("status") || "filed");
  await sql`
    insert into feasible.investment_documents
      (investment_id, kind, name, status, drive_file_id, drive_url, signed_at)
    values (${investmentId}, ${kind}, ${res.data.name}, ${status},
            ${res.data.id}, ${res.data.webViewLink},
            ${status === "signed" || status === "filed" ? new Date().toISOString() : null})`;

  revalidatePath(`/multifamily/${projectId}/capital`);
  return { ok: `Filed “${res.data.name}” to ${surnameOf(inv.name)}.` };
}
