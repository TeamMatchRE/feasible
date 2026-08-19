import Link from "next/link";
import type { LeadReadRow } from "@/lib/hpd-queries";
import { QUIET_DAYS } from "@/lib/leads";

/**
 * The lead reading, as it appears on the project's profile and again at the top
 * of the Leads tab.
 *
 * The counted figures sit above the written summary on purpose. The numbers are
 * arithmetic over the CRM and the prose is a model's reading of the notes; a
 * layout that opened with the prose would invite the second to be trusted like
 * the first. The date and the tag are always on it for the same reason — this
 * is a reading taken at a moment, not a live view of Follow Up Boss.
 */

const Figure = ({ label, value }: { label: string; value: number | string }) => (
  <div className="rounded border border-line px-3 py-2">
    <div className="font-display text-2xl leading-none text-ink">{value}</div>
    <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">{label}</div>
  </div>
);

export default function LeadSummary({
  read,
  projectId,
  compact = false,
}: {
  read: LeadReadRow;
  projectId: string;
  /** On the profile: figures, headline and the summary — the rest lives on the tab. */
  compact?: boolean;
}) {
  const s = read.stats;
  const when = new Date(read.created_at);

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Leads · <span className="font-normal text-muted">tagged “{read.tag}” in Follow Up Boss</span>
        </h2>
        <p className="text-xs text-muted">
          Read {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          {read.generated_by_name ? ` by ${read.generated_by_name}` : ""}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Leads" value={read.lead_count} />
        <Figure label="New in 30 days" value={s.newLast30} />
        <Figure label={`Quiet ${QUIET_DAYS}+ days`} value={s.quiet} />
        <Figure label="Never touched" value={s.neverTouched} />
      </div>

      {read.headline && (
        <p className="mt-4 font-display text-lg leading-snug text-ink">{read.headline}</p>
      )}

      {read.summary && (
        <div className="mt-2 space-y-2">
          {read.summary.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink">
              {para}
            </p>
          ))}
        </div>
      )}

      {!compact && (
        <>
          {read.themes.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] uppercase tracking-wide text-muted">What keeps coming up</p>
              <dl className="mt-2 space-y-2">
                {read.themes.map((t, i) => (
                  <div key={i}>
                    <dt className="text-sm font-medium text-ink">{t.label}</dt>
                    <dd className="text-sm leading-relaxed text-muted">{t.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {read.attention.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] uppercase tracking-wide text-muted">
                Outstanding, according to the notes
              </p>
              <ul className="mt-2 space-y-1">
                {read.attention.map((a, i) => (
                  <li key={i} className="text-sm text-ink">
                    <span className="font-medium">{a.lead}</span>{" "}
                    <span className="text-muted">— {a.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">
            The figures are counted from the tagged records. The writing is a model&rsquo;s reading of
            the team&rsquo;s own follow-up notes — it summarises what those notes say and is not
            allowed to invent a conversation, a timeline or a number. Follow Up Boss stays the system
            of record; nothing here is written back to it.
          </div>
        </>
      )}

      {compact && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Link
            href={`/multifamily/${projectId}/leads`}
            className="text-xs uppercase tracking-wide text-muted hover:text-ink"
          >
            All leads →
          </Link>
          {read.attention.length > 0 && (
            <span className="text-xs text-muted">
              {read.attention.length} lead{read.attention.length === 1 ? "" : "s"} with something
              outstanding
            </span>
          )}
        </div>
      )}
    </section>
  );
}
