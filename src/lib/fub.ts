import "server-only";

/**
 * FOLLOW UP BOSS — READ ONLY.
 *
 * Feasible reads a project's leads out of the CRM and never writes back. Dash,
 * Lily and SOI Giant own the write paths into FUB; a land-feasibility app
 * quietly tagging or re-staging someone's lead would be a surprise nobody
 * asked for. Every function here is a GET.
 *
 * Auth is HTTP Basic with the API key as the username and an empty password.
 * FUB also asks integrations to identify themselves with X-System /
 * X-System-Key; ours are optional (an unregistered system just gets a lower
 * rate limit and a `notice` in the payload), so they are sent only when set.
 *
 * Verified against the live BGRE account on 2026-08-19:
 *   · `/people?tags=…` filters, but see searchByTag — it is not exact.
 *   · `/notes`, `/calls`, `/textMessages` all honour `personId`. (`/calls` is
 *     the endpoint that silently ignores `userId` — see KEEL — but personId is
 *     applied. Do not extend that trust to other filters without checking.)
 *   · `/emails?personId=` works but returns marketing sends — 1,334 rows on one
 *     past client — so it is deliberately not fetched here.
 */

const BASE = "https://api.followupboss.com/v1";

export const fubConfigured = (): boolean => !!process.env.FUB_API_KEY?.trim();

function headers(): Record<string, string> {
  const key = process.env.FUB_API_KEY?.trim();
  if (!key) throw new Error("FUB_API_KEY is not set.");
  const h: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    Accept: "application/json",
  };
  if (process.env.FUB_X_SYSTEM) h["X-System"] = process.env.FUB_X_SYSTEM;
  if (process.env.FUB_X_SYSTEM_KEY) h["X-System-Key"] = process.env.FUB_X_SYSTEM_KEY;
  return h;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    method: "GET",
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Follow Up Boss GET ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export type FubPerson = {
  id: number;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  stage?: string | null;
  source?: string | null;
  assignedTo?: string | null;
  assignedUserId?: number | null;
  created?: string | null;
  lastActivity?: string | null;
  price?: number | null;
  tags?: string[];
  emails?: { value: string; isPrimary?: number | boolean }[];
  phones?: { value: string; isPrimary?: number | boolean }[];
};

type PeoplePage = {
  _metadata?: { total?: number; nextLink?: string | null };
  people?: FubPerson[];
};

/**
 * Everyone carrying a tag.
 *
 * FUB's `tags` filter is OR-matching and matches loosely, so the exact tag is
 * re-checked here (case-insensitive) on every person the server returns. A
 * fuzzy server-side match must not be able to pull an unrelated lead into a
 * project's pipeline — the count on the page is the answer to "how many leads
 * do we have", and it has to be the real one.
 *
 * Follows `nextLink` rather than paging by offset: FUB's cursor is stable while
 * offsets shift under you when someone adds a lead mid-read (which happened
 * during development — a 16th lead arrived the morning this was written).
 */
export async function peopleByTag(tag: string, max = 500): Promise<FubPerson[]> {
  const want = tag.trim().toLowerCase();
  if (!want) return [];

  let url: string | null =
    `${BASE}/people?tags=${encodeURIComponent(tag.trim())}&limit=100&includeTrash=false&sort=created`;
  const out: FubPerson[] = [];

  while (url && out.length < max) {
    const page: PeoplePage = await get<PeoplePage>(url);
    for (const p of page.people ?? []) {
      if ((p.tags ?? []).some((t) => t.trim().toLowerCase() === want)) out.push(p);
    }
    url = page._metadata?.nextLink ?? null;
  }
  return out.slice(0, max);
}

export type FubNote = { created?: string | null; subject?: string | null; body?: string | null };
export type FubCall = {
  created?: string | null;
  outcome?: string | null;
  duration?: number | null;
  note?: string | null;
};
export type FubText = { created?: string | null; message?: string | null; isIncoming?: boolean };

/**
 * One lead's recent conversation, as far as FUB records it.
 *
 * Notes are where the substance lives on this account — the follow-up log an
 * agent types after a call ("still on the fence, may move out of state"). Calls
 * and texts are included because they show whether anyone actually reached the
 * person, which a note alone does not settle. Most recent first, capped: the
 * last handful of touches describe where a lead stands, and the twentieth is
 * paying for context nobody reads.
 */
export async function personActivity(
  personId: number,
  perKind = 8,
): Promise<{ notes: FubNote[]; calls: FubCall[]; texts: FubText[] }> {
  const limit = Math.min(Math.max(perKind, 1), 25);
  const [notes, calls, texts] = await Promise.all([
    get<{ notes?: FubNote[] }>(`/notes?personId=${personId}&limit=${limit}&sort=-created`),
    get<{ calls?: FubCall[] }>(`/calls?personId=${personId}&limit=${limit}&sort=-created`),
    get<{ textmessages?: FubText[] }>(
      `/textMessages?personId=${personId}&limit=${limit}&sort=-created`,
    ),
  ]);
  return {
    notes: notes.notes ?? [],
    calls: calls.calls ?? [],
    // Note the lowercase collection key — FUB returns `textmessages`, not the
    // camelCase it accepts on the way in.
    texts: texts.textmessages ?? [],
  };
}

/**
 * Run `work` over `items` a few at a time.
 *
 * Sixteen leads is three round trips each; fired all at once that is a burst
 * FUB rate-limits (unregistered systems get a low per-second ceiling), and run
 * one at a time it is a minute of staring at a spinner. Four is the compromise.
 */
export async function inBatches<T, R>(
  items: T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return out;
}
