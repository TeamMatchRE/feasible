"use client";

import { useActionState } from "react";
import { refreshLeads, saveLeadTag, type LeadRefreshState } from "../../lead-actions";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Read the leads now, and say which tag counts as "this project's leads".
 *
 * The refresh is a button and not a schedule: it costs CRM calls and a model
 * call, and a pipeline that is checked when someone wants to know is honest
 * about what it is. The tag field defaults to the project's name because that
 * is what the tag already is — it is here for the day the two drift apart.
 */
export default function LeadControls({
  projectId,
  tag,
  explicit,
  projectName,
  fubReady,
  lastReadAt,
}: {
  projectId: string;
  tag: string;
  explicit: boolean;
  projectName: string;
  fubReady: boolean;
  lastReadAt: string | null;
}) {
  const [state, formAction] = useActionState<LeadRefreshState, FormData>(refreshLeads, null);

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Read the leads</h2>
          <p className="mt-0.5 text-xs text-muted">
            Everyone tagged <strong className="text-ink">{tag}</strong> in Follow Up Boss, with the
            team&rsquo;s follow-up notes, counted and summarised.
            {lastReadAt
              ? ` Last read ${new Date(lastReadAt).toLocaleDateString()}.`
              : " Nothing read yet."}
          </p>
        </div>

        <form action={formAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <SubmitButton
            disabled={!fubReady}
            pendingLabel="Reading Follow Up Boss… (up to a minute)"
            className="rounded bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90 disabled:opacity-40"
          >
            Refresh now
          </SubmitButton>
        </form>
      </div>

      {!fubReady && (
        <p className="mt-3 rounded border border-line bg-parchment/60 px-3 py-2 text-xs text-muted">
          <strong className="text-ink">FUB_API_KEY isn&rsquo;t set</strong> — add it to the
          environment (and to Vercel for the deployed app) and this can read the CRM.
        </p>
      )}

      {state?.error && <p className="mt-3 text-xs text-red-600">{state.error}</p>}
      {state?.ok && (
        <p className="mt-3 text-xs text-ink">
          Read {state.count} lead{state.count === 1 ? "" : "s"}. The summary below is the new one;
          the previous readings are kept underneath.
        </p>
      )}

      <details className="mt-3 border-t border-line pt-3">
        <summary className="cursor-pointer text-xs text-muted">
          Which tag? {explicit ? `Set to “${tag}”.` : `Using the project name, “${projectName}”.`}
        </summary>
        <form action={saveLeadTag} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input
            name="tag"
            defaultValue={explicit ? tag : ""}
            placeholder={projectName}
            className="rounded border border-line px-3 py-1.5 text-sm"
          />
          <SubmitButton className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-parchment">
            Save tag
          </SubmitButton>
          <span className="text-xs text-muted">Leave it blank to follow the project name.</span>
        </form>
      </details>
    </div>
  );
}
