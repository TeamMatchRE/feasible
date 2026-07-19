"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { sql } from "@/db";

/**
 * Create a new feasibility study and jump straight into its map studio.
 * center_lat/lng come from the client-side geocoder (the browser resolves the
 * typed address with the referrer-restricted Maps key), so the studio opens
 * framed on the site. Both are optional — the studio can still geocode later.
 */
export async function createProject(formData: FormData): Promise<void> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const latRaw = formData.get("center_lat");
  const lngRaw = formData.get("center_lng");
  const center_lat = latRaw ? Number(latRaw) : null;
  const center_lng = lngRaw ? Number(lngRaw) : null;

  if (!name) throw new Error("A study name is required.");

  const [row] = await sql<{ id: string }[]>`
    insert into feasible.projects (owner_id, name, address, center_lat, center_lng)
    values (${user.id}, ${name}, ${address},
            ${Number.isFinite(center_lat as number) ? center_lat : null},
            ${Number.isFinite(center_lng as number) ? center_lng : null})
    returning id
  `;

  revalidatePath("/");
  redirect(`/projects/${row.id}`);
}

/** Delete a study (cascades to every parcel, feature, and validation). */
export async function deleteProject(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await sql`
    delete from feasible.projects where id = ${id} and owner_id = ${user.id}
  `;
  revalidatePath("/");
}
