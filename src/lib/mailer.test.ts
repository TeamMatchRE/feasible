import test from "node:test";
import assert from "node:assert/strict";
import { sendMany, mailConfigured } from "./mailer";

/**
 * These run without credentials on purpose. What they pin is the accounting —
 * that every addressee produces a result — not the SMTP conversation.
 */

const letter = () => ({ subject: "s", html: "<p>h</p>", text: "t" });

test("an addressee with no email is recorded as a failure, not skipped", async () => {
  // The dangerous version of this bug is silent: "sent to everyone" reported
  // over a list that quietly dropped the two people without addresses.
  const results = await sendMany(
    [
      { name: "Has Email", email: "someone@example.com" },
      { name: "No Email", email: null },
    ],
    letter,
  );

  assert.equal(results.length, 2, "every addressee must produce a result");
  const missing = results.find((r) => r.name === "No Email")!;
  assert.equal(missing.ok, false);
  assert.match(missing.error!, /No email address/);
});

test("with no credentials nothing is reported as delivered", async () => {
  assert.equal(mailConfigured(), false, "test env must not carry real credentials");
  const results = await sendMany([{ name: "A", email: "a@example.com" }], letter);
  assert.equal(results[0].ok, false);
  assert.equal(results.filter((r) => r.ok).length, 0);
});

test("every result carries a timestamp, so a partial send is reconstructable", async () => {
  const results = await sendMany(
    [{ name: "A", email: "a@example.com" }, { name: "B", email: null }],
    letter,
  );
  for (const r of results) assert.ok(!Number.isNaN(Date.parse(r.at)), `bad timestamp for ${r.name}`);
});
