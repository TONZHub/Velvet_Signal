import assert from "node:assert/strict";
import test from "node:test";
import { compareClaimContent } from "../src/claim-delta-rag.mjs";

function claim(id, statement) {
  return {
    id: `numeric-delta:${id}`,
    patch_id: "numeric-delta",
    claim_id: id,
    statement,
    relationships: [],
  };
}

test("different numbers in overlapping claims are preserved as a delta, not auto-labeled a conflict", () => {
  const olderShape = claim(
    "A",
    "Cooked leftovers in the refrigerator keep for 3 to 4 days.",
  );
  const differentNumber = claim(
    "B",
    "Cooked leftovers in the refrigerator keep for 5 days.",
  );

  const comparison = compareClaimContent(olderShape, differentNumber);
  assert.ok(comparison);
  assert.equal(comparison.classification, "overlap-with-distinct-details");
  assert.equal(comparison.has_explicit_relationship, false);
  assert.deepEqual(comparison.explicit_relationships, []);
  assert.equal(comparison.left_unique.quantities.includes("3 to 4 days"), true);
  assert.equal(comparison.right_unique.quantities.includes("5 days"), true);
  assert.equal("conflict" in comparison, false);
  assert.equal("inferred_relationship" in comparison, false);
});
