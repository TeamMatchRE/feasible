import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { dealRole, canRead, canWrite } from "@/lib/mf-access";
import { listLots, toLotLike } from "@/lib/hpd-queries";
import { summarizeLots, closingSchedule } from "@/lib/capital";
import { sql } from "@/db";
import ProjectNav from "../ProjectNav";
import LotRowEditor, { AddLotButton } from "./LotRowEditor";

export const dynamic = "force-dynamic";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * LOTS — the revenue side, one row per home.
 *
 * Banked and forecast are never summed into a single "revenue" figure. A closed
 * lot is history; a projected closing is a guess with a date on it, and the
 * schedule marks which is which per lot.
 */
export default async function LotsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const role = await dealRole(user, id);
  if (!canRead(role)) notFound();
  const editable = canWrite(role);

  const [deal] = await sql<{ name: string }[]>`select name from feasible.mf_deals where id = ${id}`;
  if (!deal) notFound();

  const lots = await listLots(id);
  const summary = summarizeLots(toLotLike(lots));
  const schedule = closingSchedule(toLotLike(lots));

  return (
    <Shell>
      <div className="mb-5">
        <Link href={`/multifamily/${id}`} className="text-xs uppercase tracking-wide text-muted hover:text-ink">
          ← {deal.name}
        </Link>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">Lots</h1>
        <p className="mt-1 text-sm text-muted">
          {summary.total} homes · {summary.closed} closed · {summary.underContract} under contract ·{" "}
          {summary.reserved} reserved · {summary.available} available
        </p>
      </div>

      <ProjectNav dealId={id} active="/lots" />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Closed proceeds</p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">{money(summary.closedProceeds)}</p>
          <p className="text-xs text-muted">banked</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Under contract</p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">{money(summary.pipelineProceeds)}</p>
          <p className="text-xs text-muted">expected, not banked</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Still to sell</p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">{money(summary.unsoldValue)}</p>
          <p className="text-xs text-muted">
            {summary.unpriced > 0
              ? `${summary.unpriced} lot${summary.unpriced === 1 ? "" : "s"} not yet priced`
              : "all lots priced"}
          </p>
        </div>
      </div>

      {summary.unpriced > 0 && (
        <p className="mt-3 rounded border border-line bg-white px-4 py-3 text-xs text-muted">
          {summary.unpriced} lot{summary.unpriced === 1 ? " has" : "s have"} no style or price yet.
          Pick a style below and the price follows it — Ranch $699,900, Cape $769,900. Nothing was
          assumed about which lot is which.
        </p>
      )}

      <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-line bg-black/[0.02] text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="p-3 font-medium">Lot</th>
              <th className="p-3 font-medium">Style</th>
              <th className="p-3 text-right font-medium">List</th>
              <th className="p-3 text-right font-medium">Sale</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Buyer</th>
              <th className="p-3 font-medium">Projected closing</th>
              <th className="p-3 font-medium">Closed</th>
              {editable && <th className="p-3" />}
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <LotRowEditor key={l.id} projectId={id} lot={l} editable={editable} />
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="mt-4">
          <AddLotButton projectId={id} />
        </div>
      )}

      {/* ---- Schedule ---- */}
      <div className="mt-6 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">Closing schedule</h2>
        <p className="mt-0.5 text-xs text-muted">
          Money in by month. A lot appears in the month it actually closed if it has, otherwise the
          month it&rsquo;s projected to close — forecast rows are marked. Lots with no date stay off
          the calendar rather than being guessed onto it.
        </p>

        {schedule.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No closing dates set yet, so there&rsquo;s nothing to schedule.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Month</th>
                  <th className="pb-2 pr-4 font-medium">Lots</th>
                  <th className="pb-2 pl-4 text-right font-medium">Proceeds</th>
                  <th className="pb-2 pl-4 text-right font-medium">Running total</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.month} className="border-b border-line/50">
                    <td className="py-2 pr-4 text-ink">{row.label}</td>
                    <td className="py-2 pr-4 text-xs text-muted">
                      {row.lots.map((l) => (
                        <span key={l.lotNumber} className="mr-2 inline-block">
                          {l.lotNumber}
                          {l.buyer ? ` · ${l.buyer}` : ""}
                          {l.projected && (
                            <span className="ml-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                              projected
                            </span>
                          )}
                        </span>
                      ))}
                    </td>
                    <td className="py-2 pl-4 text-right text-ink">{money(row.proceeds)}</td>
                    <td className="py-2 pl-4 text-right text-muted">{money(row.cumulativeNet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
