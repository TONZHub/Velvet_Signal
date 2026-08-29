import assert from "node:assert/strict";
import test from "node:test";
import { retrieveClaims } from "../src/rag.mjs";

function patch() {
  return {
    patch_id: "pantry-zero",
    desk: "The Pantry",
    title: "Storage fixture",
    scope: "Food storage",
    published_at: "2026-08-28",
    valid_until: "2027-08-28",
    delivery: { status: "delivered", approved: true },
    claims: [
      {
        id: "P-01",
        statement: "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
        status: "verified",
        source_ids: ["SRC-1"],
      },
      {
        id: "P-02",
        statement: "Fresh fish can be refrigerated for 1 to 2 days.",
        status: "verified",
        source_ids: ["SRC-1"],
      },
    ],
    sources: [{ id: "SRC-1", publisher: "VS-Bench", url: "https://example.test/storage" }],
  };
}

test("unrelated lexical queries return no active claims", async () => {
  const result = await retrieveClaims(
    "Who won the 1998 World Cup?",
    [patch()],
    { now: new Date("2026-08-28T12:00:00Z"), limit: 3 },
  );
  assert.equal(result.mode, "lexical");
  assert.deepEqual(result.results, []);
  assert.equal(result.selection.candidates_considered, 0);
});
