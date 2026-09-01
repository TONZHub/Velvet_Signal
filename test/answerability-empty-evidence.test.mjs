import assert from "node:assert/strict";
import test from "node:test";
import { assessRetrievalAnswerability } from "../src/answerability-rag.mjs";

test("zero selected claims do not report an unsourced-current-claim caveat", () => {
  const result = assessRetrievalAnswerability({
    mode: "lexical",
    results: [],
    selection: {
      evidence: {
        status: "unsourced",
        distinct_evidence_count: 0,
        distinct_publisher_count: 0,
        sourced_claim_count: 0,
        unsourced_claim_count: 0,
        shared_evidence_group_count: 0,
        max_claims_on_one_evidence: 0,
        bundles: [],
      },
    },
    resolution: { decisions: [], history: [], warnings: [] },
  });

  assert.equal(result.status, "no-current-context");
  assert.equal(result.current_claim_count, 0);
  assert.equal(result.evidence_status, null);
  assert.deepEqual(result.reasons, []);
});
