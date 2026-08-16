"use client";

import { useActionState } from "react";
import {
  extractFromDrive,
  applyExtraction,
  type ExtractState,
  type ApplyState,
} from "../../import-actions";
import { SubmitButton } from "@/components/SubmitButton";
// Types erase at build time so they can cross the server/client line; a runtime
// helper cannot, and project-extract.ts is server-only. Hence the local copy.
import type { ExtractedProject, ExtractedField } from "@/lib/project-extract";

const valueOf = (f: ExtractedField): number | null => (f.found ? f.value : null);

type Doc = { id: string; name: string; mimeType: string; size: number | null };
type Current = {
  lotCount: number;
  landCost: number;
  costToBuildPerSqFt: number | null;
  roadLengthFt: number | null;
  totalProjectCost: number;
};

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const plain = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));

const kindOf = (mime: string) =>
  mime.includes("spreadsheet") ? "Sheet" : mime.includes("document") ? "Doc" : mime === "application/pdf" ? "PDF" : "Text";

/**
 * Pick documents → read them → decide what to keep.
 *
 * The current value sits next to every proposal, and a row where they disagree
 * is marked. That is the whole design: this folder holds several passes at the
 * same project, so the useful output is "these two documents say different
 * things", not "here is the answer".
 */
export default function ImportPanel({
  projectId,
  folderLabel,
  docs,
  current,
}: {
  projectId: string;
  folderLabel: string;
  docs: Doc[];
  current: Current;
}) {
  const [extract, extractAction] = useActionState<ExtractState, FormData>(extractFromDrive, null);
  const [applied, applyAction] = useActionState<ApplyState, FormData>(applyExtraction, null);
  const e = extract?.extracted;

  return (
    <div className="space-y-5">
      {/* ---- Pick ---- */}
      <form action={extractAction} className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">Documents in {folderLabel}</h2>
        <p className="mt-0.5 text-xs text-muted">
          Sheets and Docs are read as text; PDFs are read as documents. Start with the underwriting
          workbook and any term sheet — plans and photos add cost without adding figures.
        </p>

        <input type="hidden" name="projectId" value={projectId} />

        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {docs.length === 0 ? (
            <p className="text-sm text-muted">Nothing readable in this folder.</p>
          ) : (
            docs.map((d) => (
              <label key={d.id} className="flex items-baseline gap-2 text-sm">
                <input
                  type="checkbox"
                  name="doc"
                  value={`${d.id}|${d.mimeType}|${d.name}`}
                  defaultChecked={/underwrit|term sheet|quote|budget|proforma/i.test(d.name)}
                  className="mt-1"
                />
                <span className="text-ink">{d.name}</span>
                <span className="text-[11px] text-muted">
                  {kindOf(d.mimeType)}
                  {d.size ? ` · ${prettySizeClient(d.size)}` : ""}
                </span>
              </label>
            ))
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel="Reading… (up to a minute)"
            className="rounded bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90"
          >
            Read these
          </SubmitButton>
          <span className="text-xs text-muted">Nothing is written yet.</span>
        </div>

        {extract?.error && <p className="mt-2 text-xs text-red-600">{extract.error}</p>}
      </form>

      {/* ---- Review ---- */}
      {e && (
        <form action={applyAction} className="rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="extracted" value={JSON.stringify(e)} />

          <h2 className="text-sm font-semibold text-ink">What the documents say</h2>
          <p className="mt-0.5 text-xs text-muted">
            Tick only what you want written. Anything left unticked is still recorded in the
            project notes, so nothing found here is lost.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Apply</th>
                  <th className="pb-2 pr-4 font-medium">Figure</th>
                  <th className="pb-2 pr-4 text-right font-medium">In Feasible now</th>
                  <th className="pb-2 pr-4 text-right font-medium">In the documents</th>
                  <th className="pb-2 font-medium">Where it came from</th>
                </tr>
              </thead>
              <tbody>
                <Row
                  k="landCost" label="Land cost" e={e.landCost}
                  now={money(current.landCost)} proposed={money(valueOf(e.landCost))}
                  differs={valueOf(e.landCost) != null && valueOf(e.landCost) !== current.landCost}
                />
                <Row
                  k="costToBuildPerSqFt" label="Build cost / SF" e={e.costToBuildPerSqFt}
                  now={money(current.costToBuildPerSqFt)} proposed={money(valueOf(e.costToBuildPerSqFt))}
                  differs={valueOf(e.costToBuildPerSqFt) != null && valueOf(e.costToBuildPerSqFt) !== current.costToBuildPerSqFt}
                />
                <Row
                  k="roadLengthFt" label="Road (LF)" e={e.roadLengthFt}
                  now={plain(current.roadLengthFt)} proposed={plain(valueOf(e.roadLengthFt))}
                  differs={valueOf(e.roadLengthFt) != null && valueOf(e.roadLengthFt) !== current.roadLengthFt}
                />
                <Row
                  k="totalProjectCost" label="Total project cost" e={e.totalProjectCost}
                  now={money(current.totalProjectCost)} proposed={money(valueOf(e.totalProjectCost))}
                  differs={valueOf(e.totalProjectCost) != null && valueOf(e.totalProjectCost) !== current.totalProjectCost}
                />
                {/* Lot count is shown but never applied — lots are rows with buyers
                    and closing dates, and rewriting them from a figure in a
                    spreadsheet would delete real records. */}
                <tr className="border-b border-line/50">
                  <td className="py-2 pr-3 text-[11px] text-muted">—</td>
                  <td className="py-2 pr-4 text-muted">Lot count</td>
                  <td className="py-2 pr-4 text-right text-ink">{current.lotCount}</td>
                  <td className={`py-2 pr-4 text-right ${valueOf(e.lotCount) !== current.lotCount ? "font-semibold text-red-600" : "text-ink"}`}>
                    {plain(valueOf(e.lotCount))}
                  </td>
                  <td className="py-2 text-[11px] text-muted">
                    Read only — changing lot count means adding or deleting lots, which is done on
                    the Lots tab.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ---- Home styles ---- */}
          {e.homeStyles.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] uppercase tracking-wide text-muted">Products described</p>
              <ul className="mt-1 space-y-1">
                {e.homeStyles.map((h, i) => (
                  <li key={i} className="text-xs text-ink">
                    {h.name}
                    {h.price ? ` — ${money(h.price)}` : ""}
                    {h.squareFeet ? ` · ${plain(h.squareFeet)} sf` : ""}
                    <span className="block text-[11px] text-muted">{h.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- Conflicts: the point of the exercise ---- */}
          {e.conflicts.length > 0 && (
            <div className="mt-4 rounded border border-red-200 bg-red-50/40 p-3">
              <p className="text-xs font-semibold text-red-700">
                These documents disagree with each other
              </p>
              <p className="mt-0.5 text-[11px] text-red-700/80">
                Read these before ticking anything above — a folder usually holds several passes at
                the same project, and they may describe different plans rather than one truth.
              </p>
              <ul className="mt-2 space-y-1.5">
                {e.conflicts.map((c, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink">
                    · {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {e.notes.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted">
                Everything else it found ({e.notes.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {e.notes.map((n, i) => (
                  <li key={i} className="text-xs leading-relaxed text-muted">
                    · {n}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <SubmitButton pendingLabel="Applying…" className="rounded bg-ink px-4 py-2 text-sm text-white">
              Apply the ticked values
            </SubmitButton>
            <span className="text-xs text-muted">
              Findings, financing terms and conflicts go to the project notes either way.
            </span>
          </div>

          {applied?.error && <p className="mt-2 text-xs text-red-600">{applied.error}</p>}
          {applied?.ok && <p className="mt-2 text-xs text-ink">{applied.ok}</p>}
        </form>
      )}
    </div>
  );
}

function Row({
  k, label, e, now, proposed, differs,
}: {
  k: string;
  label: string;
  e: { found: boolean; confidence: string; source: string };
  now: string;
  proposed: string;
  differs: boolean;
}) {
  return (
    <tr className="border-b border-line/50">
      <td className="py-2 pr-3">
        {e.found ? (
          <input type="checkbox" name="apply" value={k} defaultChecked={false} />
        ) : (
          <span className="text-[11px] text-muted">—</span>
        )}
      </td>
      <td className="py-2 pr-4 text-muted">{label}</td>
      <td className="py-2 pr-4 text-right text-ink">{now}</td>
      <td className={`py-2 pr-4 text-right ${differs ? "font-semibold text-red-600" : "text-ink"}`}>
        {proposed}
        {e.found && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">{e.confidence}</span>
        )}
      </td>
      <td className="py-2 text-[11px] leading-snug text-muted">{e.source || "not found"}</td>
    </tr>
  );
}

/** Local copy — prettySize lives in a server-only module. */
function prettySizeClient(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
