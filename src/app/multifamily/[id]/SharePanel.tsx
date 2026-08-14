"use client";

import { useActionState, useState } from "react";
import { shareDeal, unshareDeal, type ShareState } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { Collaborator } from "@/lib/mf-access";

/**
 * SHARING — the owner's control over who else can open this deal.
 *
 * Rendered only for the owner. That is a UI convenience, not the security
 * boundary: every action re-checks ownership on the server (see requireDealOwner
 * in src/lib/mf-access.ts), because a hidden button is not an access control.
 *
 * Collapsed by default so it stays out of the way of underwriting, which is what
 * the page is actually for.
 */
export default function SharePanel({
  dealId,
  collaborators,
}: {
  dealId: string;
  collaborators: Collaborator[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ShareState, FormData>(shareDeal, null);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-line/30"
      >
        Share
        {collaborators.length > 0 && (
          <span className="ml-1.5 rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {collaborators.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-line bg-white p-4 shadow-lg">
          <h3 className="text-sm font-semibold text-ink">Share this deal</h3>
          <p className="mt-0.5 text-xs text-muted">
            Anyone you add sees the same deal and the same numbers. Only you can delete it or change
            who it&rsquo;s shared with.
          </p>

          <form action={formAction} className="mt-3 space-y-2">
            <input type="hidden" name="dealId" value={dealId} />
            <input
              name="email"
              type="email"
              required
              placeholder="name@brookegrouprealestate.com"
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
            />
            <div className="flex items-center gap-2">
              <select name="role" defaultValue="viewer" className="rounded border border-line px-2 py-1.5 text-xs">
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
              </select>
              <SubmitButton
                className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-white"
                pendingLabel="Sharing…"
              >
                Share
              </SubmitButton>
            </div>
          </form>

          {state?.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
          {state?.ok && <p className="mt-2 text-xs text-ink">{state.ok}</p>}

          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs uppercase tracking-wide text-muted">Shared with</p>
            {collaborators.length === 0 ? (
              <p className="mt-1 text-xs text-muted">No one yet — this deal is private to you.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {collaborators.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 text-xs">
                      <span className="block truncate text-ink">{c.full_name ?? c.email}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {c.full_name ? `${c.email} · ` : ""}
                        {c.role === "editor" ? "can edit" : "can view"}
                        {!c.has_signed_in && " · invited, hasn't signed in yet"}
                      </span>
                    </span>
                    <form action={unshareDeal}>
                      <input type="hidden" name="dealId" value={dealId} />
                      <input type="hidden" name="accessId" value={c.id} />
                      <SubmitButton
                        className="text-[11px] text-muted hover:text-red-600"
                        pendingLabel="Removing…"
                      >
                        Remove
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
