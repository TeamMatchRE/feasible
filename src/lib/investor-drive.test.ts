import test from "node:test";
import assert from "node:assert/strict";
import { surnameOf } from "./investor-drive";

/**
 * The Enclave's three folders are Stern, Stein and Karpf. Two of those are one
 * character apart, so surname extraction has to be boring and exact — these
 * tests exist to keep it that way.
 */

test("the surname is the folder name Heritage Point already uses", () => {
  assert.equal(surnameOf("Paul Stern"), "Stern");
  assert.equal(surnameOf("Ishay Stein"), "Stein");
  assert.equal(surnameOf("Steven Karpf"), "Karpf");
});

test("Stern and Stein never collapse to the same folder", () => {
  // The failure this guards against files one investor's signed commitment
  // where another investor can read it.
  assert.notEqual(surnameOf("Paul Stern"), surnameOf("Ishay Stein"));
});

test("extra names and untidy spacing still resolve to the last word", () => {
  assert.equal(surnameOf("  Mary  Anne   Whitfield "), "Whitfield");
  assert.equal(surnameOf("David Brooke Jr"), "Jr"); // documented: suffixes are not special-cased
});

test("a single-word name is used as-is rather than becoming empty", () => {
  assert.equal(surnameOf("Cher"), "Cher");
  assert.equal(surnameOf("   "), "");
});
