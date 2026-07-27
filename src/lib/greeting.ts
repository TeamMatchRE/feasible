// The signed-in greeting. Rendered on the server, so the hour has to come from
// a fixed zone — Vercel's runtime is UTC, and an unpinned `new Date().getHours()`
// would tell a Hartford agent "Good evening" at 3pm.
//
// Shared verbatim across the Brooke Team apps (Dash, LilyPad, KEEL, Ledger,
// SOI Giant, Feasible). No shared package exists, so this file is copied; keep
// the copies in sync by hand if the wording changes.
const TZ = "America/New_York";

// Placeholders the various session helpers fall back to when the identity
// provider gives us no name. They are not people, so they must never be greeted
// as one ("Good morning, Agent").
const NOT_A_NAME = new Set(["team member", "agent", "user", "unknown", "there"]);

/**
 * "David Brooke" -> "David". Also handles the shapes a session helper can hand
 * us that aren't really names: a placeholder (-> no name) and an email
 * local-part like "david" or "david.brooke" (-> "David").
 */
export function firstName(name?: string | null): string {
  const source = (name ?? "").trim();
  if (!source || NOT_A_NAME.has(source.toLowerCase())) return "";

  // "Brooke, David" -> "David"; "david.brooke" -> "david"; "David Brooke" -> "David"
  const head = source.includes(",") ? source.split(",").pop()!.trim() : source;
  const first = head.split(/[\s._-]+/).filter(Boolean)[0] ?? "";
  if (!first) return "";

  // Email-derived names arrive lowercase; a greeting that says "good morning,
  // david" reads like a mail merge that didn't finish.
  return first[0].toUpperCase() + first.slice(1);
}

export function timeOfDay(now: Date = new Date()): "morning" | "afternoon" | "evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(now),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/**
 * "Good morning, David." — or a plain "Good morning." when we have no real name.
 * Never renders a greeting with a hole in it.
 */
export function greeting(name?: string | null, now?: Date): string {
  const first = firstName(name);
  const part = `Good ${timeOfDay(now)}`;
  return first ? `${part}, ${first}.` : `${part}.`;
}
