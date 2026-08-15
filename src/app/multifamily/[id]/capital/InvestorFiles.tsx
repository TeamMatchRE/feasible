"use client";

import { useActionState, useState } from "react";
import { fileInvestorDocument, type FileState } from "../../drive-actions";
import { SubmitButton } from "@/components/SubmitButton";

const KINDS = [
  ["commitment", "Commitment letter"],
  ["subscription", "Subscription agreement"],
  ["operating_agreement", "Operating agreement"],
  ["wire_instructions", "Wire instructions"],
  ["offering", "Offering / pitch deck"],
  ["k1", "K-1"],
  ["other", "Other"],
] as const;

/**
 * File a document into this investor's Drive folder.
 *
 * The destination is stated on screen before you upload — "goes to Equity
 * Raise/Stern" — because the whole risk here is a document landing in the wrong
 * investor's folder, and a silent destination is how that happens unnoticed.
 */
export default function InvestorFiles({
  projectId,
  investmentId,
  investorName,
  surname,
  documents,
}: {
  projectId: string;
  investmentId: string;
  investorName: string;
  surname: string;
  documents: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<FileState, FormData>(fileInvestorDocument, null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted hover:text-ink">
        Files{documents > 0 ? ` (${documents})` : ""}
      </button>
    );
  }

  const field = "mt-1 w-full rounded border border-line px-2 py-1 text-sm";

  return (
    <div className="rounded-lg border border-line bg-white p-4 text-left">
      <p className="text-sm font-medium text-ink">{investorName}</p>
      <p className="mt-0.5 text-[11px] text-muted">
        Files to <span className="font-mono">Equity Raise/{surname}/</span> in Drive — the folder
        Heritage Point already uses. Created if it isn&rsquo;t there yet.
      </p>

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="investmentId" value={investmentId} />

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted">Document</span>
            <select name="kind" defaultValue="commitment" className={field}>
              {KINDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted">Status</span>
            <select name="status" defaultValue="signed" className={field}>
              <option value="signed">Signed</option>
              <option value="sent">Sent, awaiting signature</option>
              <option value="filed">Filed</option>
              <option value="draft">Draft</option>
            </select>
          </label>
        </div>

        <label className="block text-xs">
          <span className="block text-[11px] uppercase tracking-wide text-muted">File</span>
          <input type="file" name="file" required className="mt-1 w-full text-xs" />
          <span className="mt-0.5 block text-[10px] text-muted">Up to 15 MB.</span>
        </label>

        <div className="flex items-center gap-3 pt-1">
          <SubmitButton pendingLabel="Uploading…" className="rounded bg-ink px-3 py-1.5 text-xs text-white">
            File to Drive
          </SubmitButton>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
            Close
          </button>
        </div>
      </form>

      {state?.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-xs text-ink">{state.ok}</p>}
    </div>
  );
}
