"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { requireUser } from "@/lib/session";
import { dealRole, canWrite } from "@/lib/mf-access";
import { parseFolderId, getFile } from "@/lib/drive";

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
