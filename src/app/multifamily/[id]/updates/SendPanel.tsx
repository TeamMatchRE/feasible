"use client";

import { useActionState, useState } from "react";
import {
  sendTestUpdate,
  sendUpdateToInvestors,
  saveUpdateEdits,
  deleteUpdate,
  type SendState,
} from "../../capital-actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { UpdateRow } from "@/lib/hpd-queries";

/**
 * Review, edit, test, then send.
 *
 * The order is the point. Sending investor mail is the only irreversible thing
 * in this app, so the path to it runs through reading the letter and mailing
 * yourself a copy first. The final step names every recipient explicitly —
 * "Send to 3 investors" is a number; a list of three people is a decision.
 */
export default function SendPanel({
  projectId,
  update,
  recipients,
  mailReady,
  mailFrom,
}: {
  projectId: string;
  update: UpdateRow;
  recipients: { name: string; email: string | null }[];
  mailReady: boolean;
  mailFrom: string | null;
}) {
  const [test, testAction] = useActionState<SendState, FormData>(sendTestUpdate, null);
  const [send, sendAction] = useActionState<SendState, FormData>(sendUpdateToInvestors, null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  const sent = update.status === "sent";
  const sendable = recipients.filter((r) => r.email);
  const unreachable = recipients.filter((r) => !r.email);

  if (sent) {
    const delivered = update.delivery?.filter((d) => d.ok) ?? [];
    const failed = update.delivery?.filter((d) => !d.ok) ?? [];
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs text-ink">
          Sent {update.sent_at ? new Date(update.sent_at).toLocaleString() : ""} — delivered to{" "}
          {delivered.length} of {update.delivery?.length ?? 0}.
        </p>
        {failed.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {failed.map((f) => (
              <li key={f.name} className="text-xs text-red-600">
                {f.name} — {f.error}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {/* ---- Edit before it goes ---- */}
      {editing ? (
        <form action={saveUpdateEdits} onSubmit={() => setEditing(false)} className="space-y-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="updateId" value={update.id} />
          <label className="block text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted">Subject</span>
            <input
              name="subject"
              defaultValue={update.subject ?? ""}
              className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted">Letter</span>
            <textarea
              name="body_text"
              rows={12}
              defaultValue={update.body_text ?? ""}
              className="mt-1 w-full rounded border border-line px-3 py-2 text-sm leading-relaxed"
            />
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton className="rounded bg-ink px-3 py-1.5 text-xs text-white">Save edits</SubmitButton>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted hover:text-ink">
          Edit before sending
        </button>
      )}

      {!mailReady ? (
        <p className="rounded border border-line bg-black/[0.02] px-3 py-2 text-xs text-muted">
          <strong className="text-ink">Email isn&rsquo;t connected yet.</strong> Set{" "}
          <code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> in Vercel — the same app
          password the solar app already uses — and this becomes a send button.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {/* ---- Test to self ---- */}
          <form action={testAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="updateId" value={update.id} />
            <SubmitButton
              pendingLabel="Sending test…"
              className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-line/30"
            >
              Send a test to myself
            </SubmitButton>
          </form>

          {/* ---- The real thing ---- */}
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={sendable.length === 0}
              className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Send to {sendable.length} investor{sendable.length === 1 ? "" : "s"}…
            </button>
          ) : null}

          {mailFrom && <span className="text-[11px] text-muted">from {mailFrom}</span>}
        </div>
      )}

      {/* ---- Named confirmation ---- */}
      {confirming && mailReady && (
        <form action={sendAction} onSubmit={() => setConfirming(false)} className="rounded border border-line p-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="updateId" value={update.id} />
          <p className="text-xs text-ink">This sends the letter above to:</p>
          <ul className="mt-1 space-y-0.5">
            {sendable.map((r) => (
              <li key={r.name} className="text-xs text-ink">
                {r.name} <span className="text-muted">— {r.email}</span>
              </li>
            ))}
          </ul>
          {unreachable.length > 0 && (
            <p className="mt-2 text-xs text-red-600">
              {unreachable.map((u) => u.name).join(", ")} will not receive it — no email on file.
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted">
            Each person gets their own message addressed to them; nobody sees the others&rsquo;
            addresses. This can&rsquo;t be undone.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <SubmitButton
              pendingLabel="Sending…"
              className="rounded bg-ink px-4 py-2 text-xs font-medium text-white"
            >
              Send it
            </SubmitButton>
            <button type="button" onClick={() => setConfirming(false)} className="text-xs text-muted hover:text-ink">
              Not yet
            </button>
          </div>
        </form>
      )}

      {test?.ok && <p className="text-xs text-ink">{test.ok}</p>}
      {test?.error && <p className="text-xs text-red-600">{test.error}</p>}
      {send?.ok && <p className="text-xs text-ink">{send.ok}</p>}
      {send?.error && <p className="text-xs text-red-600">{send.error}</p>}
      {send?.results?.filter((r) => !r.ok).map((r) => (
        <p key={r.name} className="text-xs text-red-600">
          {r.name} — {r.error}
        </p>
      ))}

      {/* ---- Discard ---- */}
      <form action={deleteUpdate}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="updateId" value={update.id} />
        <SubmitButton className="text-[11px] text-muted hover:text-red-600">Discard this draft</SubmitButton>
      </form>
    </div>
  );
}
