import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMultiIntentContext,
  retrieveMultiIntentClaims,
} from "../src/multi-intent-rag.mjs";

function activeCandidate() {
  return {
    id: "bench-intent-001:A",
    patch_id: "bench-intent-001",
    claim_id: "A",
    desk: "VS-Bench",
    title: "Synthetic multi-intent fixture",
    scope: "Synthetic retrieval behavior",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    statement: "Cooked leftovers can stay refrigerated for 3 to 4 days.",
    status: "verified",
    source_ids: [],
    sources: [],
    relationships: [],
    supersedes: [],
    score: 1,
    lexical_score: 1,
    semantic_score: null,
    selection_reason: "top-relevance",
  };
}

test("compound selection keeps a historical tombstone for an uncovered second facet", async () => {
  const decision = {
    type: "replaces",
    source_id: "bench-name-002:NAME-02",
    target_id: "bench-name-001:NAME-01",
    source_active: false,
    target_was_active: true,
    action: "target_withheld_by_historical_tombstone",
    reason: "The newer marigold replacement expired.",
    explanation: "Neither statement is active until fresh evidence resolves the gap.",
  };
  const base = {
    mode: "lexical",
    results: [activeCandidate()],
    selection: { strategy: "relevance", candidates_considered: 1 },
    resolution: {
      decisions: [decision],
      history: [
        { id: decision.source_id, statement: "The newer historical name." },
        { id: decision.target_id, statement: "The older marigold name." },
      ],
      warnings: [],
    },
  };

  const result = await retrieveMultiIntentClaims(
    "How long can leftovers stay refrigerated, and what is the marigold policy?",
    [],
    { limit: 2, retrieveImpl: async () => base },
  );

  assert.equal(result.selection.strategy, "multi-intent-coverage");
  assert.equal(result.selection.intents[1].covered_by.length, 0);
  assert.equal(result.resolution.decisions.length, 1);
  assert.equal(
    result.resolution.decisions[0].action,
    "target_withheld_by_historical_tombstone",
  );
  assert.deepEqual(
    result.resolution.history.map((item) => item.id).sort(),
    [decision.source_id, decision.target_id].sort(),
  );

  const context = formatMultiIntentContext(result);
  assert.match(context, /covered_by=none/);
  assert.match(context, /current publication context is unavailable/i);
  assert.match(context, /target_withheld_by_historical_tombstone/);
});