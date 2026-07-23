"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { sql } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { analyzeDesign, type AnalyzeResult, type PlanFile, type DesignAnalysis } from "@/lib/design-ai";

export type { AnalyzeResult, DesignAnalysis } from "@/lib/design-ai";

/** Read plan file(s) → specs + takeoff. Proposal only; does not save. */
export async function analyze(files: PlanFile[]): Promise<AnalyzeResult> {
  await requireUser();
  return analyzeDesign(files);
}

export interface CreateDesignInput {
  name: string;
  meta: DesignAnalysis["meta"];
  takeoff: { category: string; description: string | null; quantity: number; unit: string }[];
  storagePath: string | null;
  fileKind: "pdf" | "image" | null;
  parsedMeta: Record<string, unknown>;
}

/** Persist a reviewed design: building_template + plan file + takeoff. */
export async function createDesign(input: CreateDesignInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const user = await requireUser();
    const name = input.name.trim();
    if (!name) return { ok: false, error: "A design name is required." };
    const m = input.meta;

    const [tpl] = await sql<{ id: string }[]>`
      insert into feasible.building_templates
        (owner_id, name, model_type, living_area_sf, bedrooms, bathrooms,
         footprint_width_ft, footprint_depth_ft, attributes)
      values (${user.id}, ${name}, ${m.model_type}, ${m.living_area_sf}, ${m.bedrooms}, ${m.bathrooms},
              ${m.footprint_width_ft}, ${m.footprint_depth_ft}, ${JSON.stringify({ stories: m.stories, notes: m.notes })}::jsonb)
      returning id`;

    if (input.storagePath) {
      const [file] = await sql<{ id: string }[]>`
        insert into feasible.project_files (owner_id, template_id, storage_path, kind, parse_status, parsed_meta)
        values (${user.id}, ${tpl.id}, ${input.storagePath}, ${input.fileKind ?? "other"}::feasible.file_kind,
                'parsed'::feasible.parse_status, ${JSON.stringify(input.parsedMeta)}::jsonb)
        returning id`;
      await sql`update feasible.building_templates set source_file_id = ${file.id} where id = ${tpl.id}`;
    }

    const [to] = await sql<{ id: string }[]>`
      insert into feasible.takeoffs (owner_id, scope, template_id, status)
      values (${user.id}, 'template'::feasible.takeoff_scope, ${tpl.id}, 'parsed'::feasible.parse_status)
      returning id`;

    for (const it of input.takeoff) {
      if (!it.category || !Number.isFinite(it.quantity)) continue;
      await sql`
        insert into feasible.takeoff_items (takeoff_id, category, description, quantity, unit)
        values (${to.id}, ${it.category}, ${it.description}, ${it.quantity}, ${it.unit}::feasible.unit_of_measure)`;
    }

    revalidatePath("/designs");
    return { ok: true, id: tpl.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the design." };
  }
}

/** Delete a design (cascades to its files + takeoff) and its stored plan. */
export async function deleteDesign(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [file] = await sql<{ storage_path: string }[]>`
    select storage_path from feasible.project_files where template_id = ${id} and owner_id = ${user.id}`;
  await sql`delete from feasible.building_templates where id = ${id} and owner_id = ${user.id}`;
  if (file?.storage_path) {
    const supabase = await createClient();
    await supabase.storage.from("feasible-designs").remove([file.storage_path]);
  }
  revalidatePath("/designs");
}
