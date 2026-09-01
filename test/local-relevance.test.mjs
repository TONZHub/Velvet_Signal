import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLocalRelevanceGate,
  DEFAULT_MIN_SEMANTIC_RELEVANCE,
  LOCAL_AGENT_SYSTEM_MESSAGE,
  normalizeLocalRetrievalQuery,
} from "../src/local-relevance.mjs";

function retrieval(result) {
  return {
    mode: "semantic",
    results: [result],
    selection: {
      candidates_considered: 1,
      intents: [{ id: 1, text: "What is Velvet Signal?", covered_by: [result.id] }],
      content_overlap: {
        analyzed_claim_count: 1,
        candidate_pair_count: 0,
        overlapping_pair_count: 0,
        distinct_detail_pair_count: 0,
        explicit_relationship_pair_count: 0,
        pairs: [],
        groups: [],
      },
    },
    resolution: { decisions: [], history: [], warnings: [] },
  };
}

test("weak semantic-only matches are dropped from local context", () => {
  const result = {
    id: "pantry-003:P-01",
    patch_id: "pantry-003",
    claim_id: "P-01",
    statement: "Cooked leftovers can be refrigerated for 3 to 4 days.",
    lexical_score: 0,
    semantic_score: 0.31,
    score: 0.2542,
  };
  const gated = applyLocalRelevanceGate(retrieval(result));

  assert.deepEqual(gated.results, []);
  assert.equal(gated.selection.relevance_gate.minimum_semantic_score, DEFAULT_MIN_SEMANTIC_RELEVANCE);
  assert.equal(gated.selection.relevance_gate.dropped_count, 1);
  assert.equal(gated.selection.answerability.status, "no-current-context");
  assert.deepEqual(gated.selection.intents[0].covered_by, []);
});

test("strong semantic matches remain available", () => {
  const result = {
    id: "pantry-003:P-01",
    patch_id: "pantry-003",
    claim_id: "P-01",
    statement: "Cooked leftovers can be refrigerated for 3 to 4 days.",
    lexical_score: 0,
    semantic_score: 0.78,
    score: 0.6396,
  };
  const gated = applyLocalRelevanceGate(retrieval(result));

  assert.equal(gated.results.length, 1);
  assert.equal(gated.selection.relevance_gate.kept_count, 1);
});

test("lexical evidence can keep a claim below the semantic floor", () => {
  const result = {
    id: "pantry-003:P-01",
    patch_id: "pantry-003",
    claim_id: "P-01",
    statement: "Cooked leftovers can be refrigerated for 3 to 4 days.",
    lexical_score: 0.4,
    semantic_score: 0.2,
    score: 0.236,
  };
  const gated = applyLocalRelevanceGate(retrieval(result));

  assert.equal(gated.results.length, 1);
});

test("pure Velvet Signal identity questions do not become patch retrieval queries", () => {
  assert.equal(normalizeLocalRetrievalQuery("What is Velvet Signal?"), "");
  assert.equal(normalizeLocalRetrievalQuery("Tell me about Velvet Signal"), "");
});

test("Velvet Signal attribution is stripped while substantive query terms remain", () => {
  assert.equal(
    normalizeLocalRetrievalQuery(
      "According to Velvet Signal, can I eat chicken that has been refrigerated for five days?",
    ),
    "According to , can I eat chicken that has been refrigerated for five days?",
  );
});

test("ordinary retrieval questions are preserved", () => {
  assert.equal(
    normalizeLocalRetrievalQuery("Can I eat chicken after five refrigerated days?"),
    "Can I eat chicken after five refrigerated days?",
  );
});

test("local system identity tells the model what Velvet Signal is", () => {
  assert.match(LOCAL_AGENT_SYSTEM_MESSAGE, /AI publication and local context bridge/i);
  assert.match(LOCAL_AGENT_SYSTEM_MESSAGE, /not a consumer-product brand/i);
  assert.match(LOCAL_AGENT_SYSTEM_MESSAGE, /rather than guessing from the name/i);
});
