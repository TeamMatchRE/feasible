import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { loadMfDeal, DEFAULT_ASSUMPTIONS } from "@/lib/mf-queries";
import Underwriter from "./Underwriter";
import CompsPanel from "./CompsPanel";
import SharePanel from "./SharePanel";
import { canWrite, canManage, listCollaborators, dealOwner } from "@/lib/mf-access";
import ScenarioBar from "./ScenarioBar";
import ProjectNav from "./ProjectNav";
import { listScenarios } from "@/lib/mf-scenarios";

export const dynamic = "force-dynamic";

export default async function MfDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const loaded = await loadMfDeal(user, id);
  if (!loaded) notFound();
  const { deal, units, comps, role, scenarioId } = loaded;

  // Only the owner manages sharing, so only the owner pays for these queries.
  const collaborators = canManage(role) ? await listCollaborators(id) : [];
  const owner = role === "owner" ? null : await dealOwner(id);
  const editable = canWrite(role);
  const scenarios = await listScenarios(id);

  // postgres-js returns numerics as strings; normalize once here so the client
  // component never has to wonder which fields are numbers.
  const initial = {
    id: deal.id,
    name: deal.name,
    address: deal.address ?? "",
    city: deal.city ?? "",
    state: deal.state ?? "CT",
    postalCode: deal.postal_code ?? "",
    grossSqft: Number(deal.gross_sqft ?? 0),
    commercialSqft: Number(deal.commercial_sqft ?? 0),
    heightStories: Number(deal.height_stories ?? 0),
    garageSpaces: Number(deal.garage_spaces ?? 0),
    surfaceSpaces: Number(deal.surface_spaces ?? 0),
    storageSpaces: Number(deal.storage_spaces ?? 0),
    totalProjectCost: Number(deal.total_project_cost ?? 0),
    notes: deal.notes ?? "",
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...(deal.assumptions ?? {}) },
    // Already merged over DEFAULT_COST_PROGRAM in loadMfDeal, including the
    // fallback that keeps a pre-budget deal on its hand-typed total.
    costProgram: deal.cost_program,
    lineDetails: deal.line_details ?? {},
    units: units.map((u) => ({
      tier: u.tier,
      label: u.label,
      unit_count: Number(u.unit_count),
      rent_monthly: Number(u.rent_monthly),
      sqft: Number(u.sqft),
      sell_price: u.sell_price != null ? Number(u.sell_price) : null,
      // NULL means "follow the cost program" — preserve it rather than
      // collapsing it to 0, which would build the product for free.
      cost_per_sf: u.cost_per_sf != null ? Number(u.cost_per_sf) : null,
      gross_factor: u.gross_factor != null ? Number(u.gross_factor) : null,
      disposition: u.disposition ?? null,
    })),
  };

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/multifamily" className="text-xs uppercase tracking-wide text-muted hover:text-ink">
            ← Multi-family
          </Link>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">{deal.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[deal.address, deal.city, deal.state].filter(Boolean).join(", ") || "No address set"}
          </p>
          {owner && (
            <p className="mt-1 text-xs text-muted">
              Shared with you by {owner.full_name ?? owner.email ?? "the owner"} ·{" "}
              {editable ? "you can edit" : "view only"}
            </p>
          )}
        </div>
        {canManage(role) && <SharePanel dealId={deal.id} collaborators={collaborators} />}
      </div>

      <ProjectNav dealId={deal.id} active="" />

      <ScenarioBar
        dealId={deal.id}
        scenarios={scenarios}
        activeId={scenarioId}
        canEdit={editable}
      />

      {/* key forces a fresh editor when the scenario changes — otherwise React
          keeps the old useState(initial) and shows the previous case's numbers. */}
      <Underwriter key={scenarioId} initial={initial} canEdit={editable} />

      <CompsPanel dealId={deal.id} comps={comps} canEdit={editable} />
    </Shell>
  );
}
