import { test } from "node:test";
import assert from "node:assert/strict";
import { rollUp, daysSince, toDigest, type Lead } from "./leads";

const AS_OF = new Date("2026-08-19T12:00:00Z");

const lead = (over: Partial<Lead> = {}): Lead => ({
  fubId: 1,
  name: "A Lead",
  stage: "Lead",
  source: "Listing",
  assignedTo: "Nick DeLuca",
  created: "2026-08-01T00:00:00Z",
  lastActivity: "2026-08-17T00:00:00Z",
  hasEmail: true,
  hasPhone: true,
  activity: [{ kind: "note", at: "2026-08-17T00:00:00Z", text: "Followed up." }],
  ...over,
});

test("daysSince is null for missing or unparseable timestamps", () => {
  assert.equal(daysSince(null, AS_OF), null);
  assert.equal(daysSince("not a date", AS_OF), null);
  assert.equal(daysSince("2026-08-12T12:00:00Z", AS_OF), 7);
});

test("rollUp counts leads, not opinions", () => {
  const s = rollUp(
    [
      lead({ fubId: 1 }),
      lead({ fubId: 2, stage: "Hot Prospect", source: "HPD Website", assignedTo: "David Brooke" }),
      lead({ fubId: 3 }),
    ],
    AS_OF,
  );
  assert.equal(s.total, 3);
  assert.deepEqual(s.byStage, [
    ["Lead", 2],
    ["Hot Prospect", 1],
  ]);
  assert.deepEqual(s.byOwner, [
    ["Nick DeLuca", 2],
    ["David Brooke", 1],
  ]);
});

test("a lead with no owner counts as Unassigned rather than vanishing", () => {
  const s = rollUp([lead({ assignedTo: null }), lead({ assignedTo: "  " })], AS_OF);
  assert.deepEqual(s.byOwner, [["Unassigned", 2]]);
  assert.equal(s.total, 2);
});

test("new, quiet, untouched and unreachable are each counted from their own field", () => {
  const s = rollUp(
    [
      // New and active.
      lead({ fubId: 1, created: "2026-08-15T00:00:00Z", lastActivity: "2026-08-18T00:00:00Z" }),
      // Old and quiet: last touch 40 days ago.
      lead({ fubId: 2, created: "2026-05-01T00:00:00Z", lastActivity: "2026-07-10T00:00:00Z" }),
      // Never worked: no timeline at all, so quiet falls back to created.
      lead({ fubId: 3, created: "2026-06-01T00:00:00Z", lastActivity: null, activity: [] }),
      // Reachable by neither channel.
      lead({ fubId: 4, hasEmail: false, hasPhone: false }),
    ],
    AS_OF,
  );
  assert.equal(s.newLast30, 2, "only the 8/15 lead and the always-fresh default one are new");
  assert.equal(s.quiet, 2);
  assert.equal(s.neverTouched, 1);
  assert.equal(s.unreachable, 1);
  assert.equal(s.newestCreated, "2026-08-15T00:00:00Z");
});

test("an empty pipeline rolls up to zeroes, not to NaN", () => {
  const s = rollUp([], AS_OF);
  assert.equal(s.total, 0);
  assert.equal(s.newestCreated, null);
  assert.deepEqual(s.byStage, []);
});

test("the digest leads with the newest lead and truncates long notes", () => {
  const text = toDigest(
    [
      lead({ fubId: 1, name: "Older", created: "2026-07-01T00:00:00Z" }),
      lead({
        fubId: 2,
        name: "Newer",
        created: "2026-08-18T00:00:00Z",
        activity: [{ kind: "note", at: "2026-08-18T00:00:00Z", text: "x".repeat(900) }],
      }),
    ],
    AS_OF,
  );
  assert.ok(text.indexOf("Newer") < text.indexOf("Older"));
  assert.ok(!text.includes("x".repeat(401)), "note bodies are capped at 400 characters");
  assert.ok(text.includes("1d old"));
});

test("the digest flags a lead nobody can contact and one nobody has touched", () => {
  const text = toDigest(
    [lead({ hasEmail: false, hasPhone: false, activity: [], lastActivity: null })],
    AS_OF,
  );
  assert.ok(text.includes("NO CONTACT DETAILS"));
  assert.ok(text.includes("(nothing on the timeline)"));
});
