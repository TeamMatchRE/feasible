"use client";

import { useState } from "react";
import { saveInvestor, removeInvestment } from "../../capital-actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { InvestorRow } from "@/lib/hpd-queries";

/**
 * Add or edit one investor's participation.
 *
 * Inline, not a modal — the surrounding table is the context you need while
 * typing, and a modal would hide the other commitments you're reconciling
 * against. No native confirm() anywhere (see ScenarioBar for why).
 */
export default function InvestorEditor({
  projectId,
  investor,
}: {
  projectId: string;
  investor: InvestorRow | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editing = investor != null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          editing
            ? "text-xs text-muted hover:text-ink"
            : "rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-line/30"
        }
      >
        {editing ? "Edit" : "+ Add an investor"}
      </button>
    );
  }

  const field = "mt-1 w-full rounded border border-line px-2 py-1 text-sm";
  const label = "block text-[11px] uppercase tracking-wide text-muted";

  return (
    <div className="rounded-lg border border-line bg-white p-4 text-left">
      <form action={saveInvestor} onSubmit={() => setOpen(false)} className="space-y-3">
        <input type="hidden" name="projectId" value={projectId} />
        {editing && <input type="hidden" name="investorId" value={investor.investor_id} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <span className={label}>Name</span>
            <input name="name" required defaultValue={investor?.name ?? ""} className={field} />
          </label>
          <label className="text-xs">
            <span className={label}>Investing entity (optional)</span>
            <input
              name="entity_name"
              defaultValue={investor?.entity_name ?? ""}
              placeholder="LLC or trust that signs"
              className={field}
            />
          </label>
          <label className="text-xs">
            <span className={label}>Email</span>
            <input name="email" type="email" defaultValue={investor?.email ?? ""} className={field} />
          </label>
          <label className="text-xs">
            <span className={label}>Phone</span>
            <input name="phone" defaultValue={investor?.phone ?? ""} className={field} />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className={label}>Address</span>
            <input name="address" defaultValue={investor?.address ?? ""} className={field} />
          </label>
        </div>

        <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-4">
          <label className="text-xs">
            <span className={label}>Committed</span>
            <input
              name="committed_amount"
              inputMode="numeric"
              defaultValue={investor ? String(investor.committed_amount) : "0"}
              className={field}
            />
          </label>
          <label className="text-xs">
            <span className={label}>Received</span>
            <input
              name="contributed_amount"
              inputMode="numeric"
              defaultValue={investor ? String(investor.contributed_amount) : "0"}
              className={field}
            />
            <span className="mt-0.5 block text-[10px] text-muted">cash actually wired</span>
          </label>
          <label className="text-xs">
            <span className={label}>Status</span>
            <select name="status" defaultValue={investor?.status ?? "committed"} className={field}>
              <option value="prospect">Prospect</option>
              <option value="soft_circle">Soft circle</option>
              <option value="committed">Committed</option>
              <option value="funded">Funded</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="text-xs">
            <span className={label}>Committed on</span>
            <input
              name="committed_at"
              type="date"
              defaultValue={investor?.committed_at?.slice(0, 10) ?? ""}
              className={field}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <SubmitButton className="rounded bg-ink px-3 py-1.5 text-xs text-white">
            {editing ? "Save" : "Add investor"}
          </SubmitButton>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-muted hover:text-ink"
          >
            Cancel
          </button>
          <span className="text-[11px] text-muted">
            A prospect isn&rsquo;t counted as committed.
          </span>
        </div>
      </form>

      {editing && (
        <div className="mt-3 border-t border-line pt-3">
          {confirming ? (
            <form action={removeInvestment} onSubmit={() => setOpen(false)} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="investmentId" value={investor.investment_id} />
              <span className="text-xs text-ink">
                Remove {investor.name} from this project? They stay in the company&rsquo;s investor
                book.
              </span>
              <SubmitButton className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white">
                Remove
              </SubmitButton>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs text-muted hover:text-ink"
              >
                Keep
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs text-muted hover:text-red-600"
            >
              Remove from project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
