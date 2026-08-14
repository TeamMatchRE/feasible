import { SubmitButton } from "@/components/SubmitButton";
import type { MfComp } from "@/lib/mf-queries";
import { searchComps, confirmComp, deleteComp, applyCompToMix } from "../actions";

/**
 * Rent comps and for-sale comps, side by side against the subject — the same two
 * questions the workbook's Rent Comps sheet answers, plus the sale side the
 * sell-out exit needs.
 *
 * AI-proposed comps arrive UNCONFIRMED and are labelled as drafts. Only a
 * confirmed comp can be pushed onto the subject's mix.
 */

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

function CompCard({ comp, dealId, canEdit }: { comp: MfComp; dealId: string; canEdit: boolean }) {
  const detail = Array.isArray(comp.detail) ? comp.detail : [];
  return (
    <div className={`rounded border p-3 ${comp.confirmed ? "border-line" : "border-dashed border-line"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">
            {comp.property_name ?? "Unnamed"}
            {!comp.confirmed && (
              <span className="ml-2 rounded-full bg-black/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                unverified draft
              </span>
            )}
          </p>
          <p className="text-xs text-muted">
            {[comp.address, comp.city].filter(Boolean).join(", ") || "—"}
            {comp.year_built ? ` · built ${comp.year_built}` : ""}
            {comp.units ? ` · ${comp.units} units` : ""}
            {comp.distance_mi != null ? ` · ${Number(comp.distance_mi)} mi` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && !comp.confirmed && (
            <form action={confirmComp}>
              <input type="hidden" name="dealId" value={dealId} />
              <input type="hidden" name="compId" value={comp.id} />
              <SubmitButton className="rounded border border-ink/30 px-2 py-0.5 text-xs text-ink hover:bg-ink hover:text-white">
                Confirm
              </SubmitButton>
            </form>
          )}
          {canEdit && comp.confirmed && (
            <form action={applyCompToMix}>
              <input type="hidden" name="dealId" value={dealId} />
              <input type="hidden" name="compId" value={comp.id} />
              <SubmitButton className="rounded border border-ink/30 px-2 py-0.5 text-xs text-ink hover:bg-ink hover:text-white">
                {comp.kind === "rent" ? "Apply rents" : "Apply prices"}
              </SubmitButton>
            </form>
          )}
          {canEdit && (
            <form action={deleteComp}>
              <input type="hidden" name="dealId" value={dealId} />
              <input type="hidden" name="compId" value={comp.id} />
              <SubmitButton className="text-xs text-muted hover:text-ink">Remove</SubmitButton>
            </form>
          )}
        </div>
      </div>

      {detail.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="font-medium">Type</th>
              <th className="text-right font-medium">Count</th>
              <th className="text-right font-medium">SF</th>
              <th className="text-right font-medium">{comp.kind === "rent" ? "Rent" : "Price"}</th>
              <th className="text-right font-medium">$/SF</th>
            </tr>
          </thead>
          <tbody>
            {detail.map((r, i) => {
              const v = comp.kind === "rent" ? r.rent : r.price;
              return (
                <tr key={i} className="border-t border-line/40">
                  <td className="py-0.5 text-ink">{r.label}</td>
                  <td className="py-0.5 text-right text-muted">{r.count ?? "—"}</td>
                  <td className="py-0.5 text-right text-muted">{r.sqft ?? "—"}</td>
                  <td className="py-0.5 text-right text-ink">{money(v)}</td>
                  <td className="py-0.5 text-right text-muted">
                    {v != null && r.sqft ? (v / r.sqft).toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {(comp.note || comp.source) && (
        <p className="mt-1.5 text-[11px] text-muted">
          {comp.note}
          {comp.note && comp.source ? " · " : ""}
          {comp.source ? `Source: ${comp.source}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * `canEdit` is false for a viewer on a shared deal. Comp search writes rows and
 * spends an AI call, and confirm/apply mutate the deal, so those controls are
 * hidden — the server refuses them regardless (see actions.ts).
 */
export default function CompsPanel({
  dealId, comps, canEdit = true,
}: { dealId: string; comps: MfComp[]; canEdit?: boolean }) {
  const rent = comps.filter((c) => c.kind === "rent");
  const sale = comps.filter((c) => c.kind === "sale");

  return (
    <section className="mt-5 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Comps</h2>
          <p className="mt-0.5 text-xs text-muted">
            Rents decide the build-to-rent side; sale prices decide the sell-out side. Proposed comps are
            drafts until you confirm them — check the figures before applying anything to the mix.
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
          <>
          <form action={searchComps}>
            <input type="hidden" name="dealId" value={dealId} />
            <input type="hidden" name="kind" value="rent" />
            <SubmitButton
              pendingLabel="Searching…"
              className="rounded border border-ink/30 px-3 py-1.5 text-sm text-ink hover:bg-ink hover:text-white"
            >
              Find rent comps
            </SubmitButton>
          </form>
          <form action={searchComps}>
            <input type="hidden" name="dealId" value={dealId} />
            <input type="hidden" name="kind" value="sale" />
            <SubmitButton
              pendingLabel="Searching…"
              className="rounded border border-ink/30 px-3 py-1.5 text-sm text-ink hover:bg-ink hover:text-white"
            >
              Find for-sale comps
            </SubmitButton>
          </form>
          </>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">Rent comps</p>
          {rent.length === 0 ? (
            <p className="rounded border border-dashed border-line p-3 text-xs text-muted">
              None yet. Save the deal with a city and unit mix, then search.
            </p>
          ) : (
            <div className="space-y-2">
              {rent.map((c) => (
                <CompCard key={c.id} comp={c} dealId={dealId} canEdit={canEdit} />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">For-sale comps</p>
          {sale.length === 0 ? (
            <p className="rounded border border-dashed border-line p-3 text-xs text-muted">
              None yet. These price the sell-out exit, which stays unpriced without them.
            </p>
          ) : (
            <div className="space-y-2">
              {sale.map((c) => (
                <CompCard key={c.id} comp={c} dealId={dealId} canEdit={canEdit} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
