"use client";

import { useActionState, useState } from "react";
import { linkDriveFolder, unlinkDriveFolder, type LinkState } from "../../drive-actions";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Paste a Drive folder link to attach it to the project.
 *
 * Accepts a browser URL, a share URL, or a bare id — people paste whichever is
 * in their clipboard, and rejecting two of the three would be a pointless
 * failure. The server verifies the folder resolves before saving it.
 */
export default function LinkFolder({
  projectId,
  links,
}: {
  projectId: string;
  links: { id: string; label: string; folder_id: string }[];
}) {
  const [state, action] = useActionState<LinkState, FormData>(linkDriveFolder, null);
  const [open, setOpen] = useState(links.length === 0);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted hover:text-ink">
        Link another folder
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="min-w-[18rem] flex-1 text-xs">
          <span className="block text-[11px] uppercase tracking-wide text-muted">
            Drive folder link
          </span>
          <input
            name="folder"
            required
            placeholder="https://drive.google.com/drive/folders/…"
            className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
          />
        </label>
        <SubmitButton pendingLabel="Checking…" className="rounded bg-ink px-3 py-1.5 text-xs text-white">
          Link folder
        </SubmitButton>
        {links.length > 0 && (
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
            Cancel
          </button>
        )}
      </form>

      {state?.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-xs text-ink">{state.ok}</p>}

      {links.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-ink">{l.label}</span>
              <form action={unlinkDriveFolder}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="linkId" value={l.id} />
                <SubmitButton className="text-[11px] text-muted hover:text-red-600">Unlink</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
