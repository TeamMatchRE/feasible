import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { dealRole, canRead, canWrite } from "@/lib/mf-access";
import { loadCompanyForProject, listInvestments, toInvestmentLike } from "@/lib/hpd-queries";
import { raiseProgress } from "@/lib/capital";
import { sql } from "@/db";
import ProjectNav from "../ProjectNav";
import InvestorEditor from "./InvestorEditor";

export const dynamic = "force-dynamic";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * THE CAPITAL RAISE.
 *
 * The one thing this page refuses to do is add committed and contributed
 * together. A signed commitment is a promise; cash in the account is cash. They
 * are shown side by side, and "still to collect" is given its own number,
 * because that is the figure that tells you who to call.
 */
export default async function CapitalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const role = await dealRole(user, id);
  if (!canRead(role)) notFound();
  const editable = canWrite(role);

  const [deal] = await sql<{ name: string; stage: string }[]>`
    select name, stage from feasible.mf_deals where id = ${id}`;
  if (!deal) notFound();

  const company = await loadCompanyForProject(id);
  const investments = await listInvestments(id);

  // The raise target is the equity the budget actually needs. Until someone sets
  // one explicitly, total committed IS the target — so the bar reads 100% rather
  // than dividing by zero and claiming 0%.
  const target = investments.reduce((s, i) => s + i.committed_amount, 0);
  const raise = raiseProgress(toInvestmentLike(investments), target);

  return (
    <Shell>
      <div className="mb-5">
        <Link href={`/multifamily/${id}`} className="text-xs uppercase tracking-wide text-muted hover:text-ink">
          ← {deal.name}
        </Link>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">Capital raise</h1>
        {company && (
          <p className="mt-1 text-sm text-muted">
            {company.name}
            {company.legal_name && company.legal_name !== company.name ? ` · ${company.legal_name}` : ""}
          </p>
        )}
      </div>

      <ProjectNav dealId={id} active="/capital" />

      {/* ---- The three numbers that matter ---- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Committed</p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">{money(raise.committed)}</p>
          <p className="text-xs text-muted">
            {raise.investors.filter((i) => i.status !== "prospect").length} investors
            {raise.target > 0 && ` · ${pct(raise.pctCommitted)} of target`}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Received</p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">{money(raise.funded)}</p>
          <p className="text-xs text-muted">cash actually in the account</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Still to collect</p>
          <p
            className={`mt-0.5 text-2xl font-semibold ${raise.outstanding > 0 ? "text-red-600" : "text-ink"}`}
          >
            {money(raise.outstanding)}
          </p>
          <p className="text-xs text-muted">committed but not yet wired</p>
        </div>
      </div>

      {raise.oversubscribed > 0 && (
        <p className="mt-3 text-xs text-muted">
          Oversubscribed by {money(raise.oversubscribed)} against the current target.
        </p>
      )}

      {/* ---- The book ---- */}
      <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b border-line bg-black/[0.02] text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="p-3 font-medium">Investor</th>
              <th className="p-3 font-medium">Contact</th>
              <th className="p-3 text-right font-medium">Committed</th>
              <th className="p-3 text-right font-medium">Received</th>
              <th className="p-3 text-right font-medium">Outstanding</th>
              <th className="p-3 text-right font-medium">Share</th>
              <th className="p-3 font-medium">Status</th>
              {editable && <th className="p-3" />}
            </tr>
          </thead>
          <tbody>
            {investments.length === 0 ? (
              <tr>
                <td colSpan={editable ? 8 : 7} className="p-6 text-center text-sm text-muted">
                  No investors on this project yet.
                </td>
              </tr>
            ) : (
              investments.map((inv) => {
                const outstanding = Math.max(0, inv.committed_amount - inv.contributed_amount);
                const share = raise.investors.find((r) => r.investorId === inv.investor_id)?.shareOfRaise ?? 0;
                return (
                  <tr key={inv.investment_id} className="border-b border-line/60 last:border-0 align-top">
                    <td className="p-3">
                      <span className="block font-medium text-ink">{inv.name}</span>
                      {inv.entity_name && (
                        <span className="block text-[11px] text-muted">via {inv.entity_name}</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted">
                      {inv.email ?? <span className="text-red-600">no email</span>}
                      {inv.phone && <span className="block">{inv.phone}</span>}
                      {!inv.email && !inv.phone && inv.fub_person_id == null && (
                        <span className="block text-[11px]">in Follow Up Boss — not imported</span>
                      )}
                    </td>
                    <td className="p-3 text-right text-ink">{money(inv.committed_amount)}</td>
                    <td className="p-3 text-right text-ink">{money(inv.contributed_amount)}</td>
                    <td className={`p-3 text-right ${outstanding > 0 ? "text-red-600" : "text-muted"}`}>
                      {outstanding > 0 ? money(outstanding) : "—"}
                    </td>
                    <td className="p-3 text-right text-muted">{pct(share)}</td>
                    <td className="p-3 text-xs capitalize text-muted">{inv.status.replace(/_/g, " ")}</td>
                    {editable && (
                      <td className="p-3 text-right">
                        <InvestorEditor projectId={id} investor={inv} />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="mt-4">
          <InvestorEditor projectId={id} investor={null} />
        </div>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-muted">
        Share is a share of the <strong>raise</strong>, not of the project — ownership and any
        preferred return come from the operating agreement, which this tool does not model. Nothing
        here is an offer to sell or a solicitation of an offer to buy a security. Subscription and
        commitment documents should be reviewed by counsel before they go to an investor.
      </p>
    </Shell>
  );
}
