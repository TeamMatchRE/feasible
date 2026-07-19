/**
 * Sanitise a `?next=` redirect target. Require a single leading slash; reject
 * `//` and `/\` (protocol-relative / normalised open-redirect vectors). Runs on
 * freshly-authenticated requests — the worst moment to hand someone off-site.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
