import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMultiIntentContext,
  retrieveMultiIntentClaims,
  splitQueryIntents,
} from "../src/multi-intent-rag.mjs";

function candidate(id, statement, score, overrides = {}) {
  return {
    id: `bench-intent-001:${id}`,
    patch_id: "bench-intent-001",
    claim_id: id,
    desk: "VS-Bench",
    title: "Synthetic multi-intent fixture",
    scope: "Synthetic retrieval behavior",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    statement,
    status: "verified",
    source_ids: [],
    sources: [],
    relationships: [],
    supersedes: [],
    score,
    lexical_score: score,
    semantic_score: null,
    selection_reason: id === "A" ? "top-relevance" : "relevance-and-coverage",
    ...overrides,
  };
}

function retrieval(results, overrides = {}) {
  return {
    mode: "lexical",
    results,
    selection: {
      strategy: "maximal-marginal-relevance",
      diversity_lambda: 0.72,
      candidates_considered: results.length,
    },
    resolution: { decisions: [], history: [], warnings: [] },
    ...overrides,
  };
}

test("query intent splitting finds compound questions without splitting ordinary conjunctions", () => {
  assert.deepEqual(
    splitQueryIntents(
      "How long can leftovers stay refrigerated, and can I trust smell?",
    ),
    ["How long can leftovers stay refrigerated", "can I trust smell"],
  );
  assert.deepEqual(
    splitQueryIntents("What changed? Why does it matter?"),
    ["What changed", "Why does it matter"],
  );
  assert.deepEqual(
    splitQueryIntents("Compare storage and safety"),
    ["Compare storage and safety"],
  );
});

test("compound retrieval reserves a slot for a distinct uncovered question facet", async () => {
  const base = retrieval([
    candidate("A", "Cooked leftovers can stay refrigerated for 3 to 4 days.", 1),
    candidate("B", "Cooked leftovers remain in the refrigerator for three to four days.", 0.95),
    candidate("C", "Do not rely on smell to decide whether stored food is safe.", 0.68),
  ]);
  let calls = 0;
  const retrieveImpl = async (_query, _patches, options) => {
    calls += 1;
    assert.equal(options.limit, 4);
    return base;
  };

  const result = await retrieveMultiIntentClaims(
    "How long can leftovers stay refrigerated, and can I trust smell?",
    [],
    { limit: 2, retrieveImpl },
  );

  assert.equal(calls, 1);
  assert.deepEqual(
    result.results.map((item) => item.claim_id),
    ["A", "C"],
  );
  assert.equal(result.selection.strategy, "multi-intent-coverage");
  assert.equal(result.selection.intent_count, 2);
  assert.equal(result.selection.intents_covered, 2);
  assert.match(result.results[1].selection_reason, /^intent-coverage:2$/);
  assert.deepEqual(result.selection.intents[1].covered_by, ["bench-intent-001:C"]);
});

test("multi-intent selection covers facets first, then preserves an explicit narrowing companion", async () => {
  const a = candidate(
    "A",
    "Update alerts appear for subscribed desks.",
    1,
  );
  const b = candidate(
    "B",
    "Update alerts are shown to subscribed desks.",
    0.92,
  );
  const c = candidate(
    "C",
    "Unread items are marked with a badge.",
    0.78,
  );
  const d = candidate(
    "D",
    "Update alerts appear only for subscribed desks with new issues.",
    0.74,
    {
      relationships: [
        {
          type: "narrows",
          target_id: a.id,
          reason: "The newer claim adds the new-issue boundary.",
        },
      ],
    },
  );
  const base = retrieval([a, b, c, d]);

  const result = await retrieveMultiIntentClaims(
    "When do update alerts appear for subscribed desks, and how are unread items marked?",
    [],
    { limit: 3, retrieveImpl: async () => base },
  );

  assert.deepEqual(
    result.results.map((item) => item.claim_id),
    ["A", "C", "D"],
  );
  assert.equal(result.results[1].selection_reason, "intent-coverage:2");
  assert.equal(result.results[2].selection_reason, "relationship-companion:narrows");
});

test("the multi-intent layer calls core retrieval once and forwards the existing embedding adapter", async () => {
  const embed = async () => [];
  let calls = 0;
  const retrieveImpl = async (_query, _patches, options) => {
    calls += 1;
    assert.equal(options.embed, embed);
    assert.equal(options.limit, 6);
    return retrieval([
      candidate("A", "Alpha update rule.", 1),
      candidate("B", "Beta boundary rule.", 0.8),
    ]);
  };

  await retrieveMultiIntentClaims(
    "What is the alpha update, and what is the beta boundary?",
    [],
    { limit: 3, embed, retrieveImpl },
  );

  assert.equal(calls, 1);
});

test("simple questions keep the existing core retrieval path unchanged", async () => {
  const base = retrieval([
    candidate("A", "Cooked leftovers can stay refrigerated for 3 to 4 days.", 1),
  ]);
  let calls = 0;
  const retrieveImpl = async (_query, _patches, options) => {
    calls += 1;
    assert.equal(options.limit, 3);
    return base;
  };

  const result = await retrieveMultiIntentClaims(
    "How long can cooked leftovers stay refrigerated?",
    [],
    { limit: 3, retrieveImpl },
  );

  assert.equal(calls, 1);
  assert.equal(result, base);
});

test("formatted context tells the local model which compound facets have support", async () => {
  const base = retrieval([
    candidate("A", "Cooked leftovers can stay refrigerated for 3 to 4 days.", 1),
    candidate("C", "Do not rely on smell to decide whether stored food is safe.", 0.68),
  ]);
  const result = await retrieveMultiIntentClaims(
    "How long can leftovers stay refrigerated, and can I trust smell?",
    [],
    { limit: 2, retrieveImpl: async () => base },
  );
  const context = formatMultiIntentContext(result);

  assert.match(context, /MULTI-INTENT QUERY FACETS/);
  assert.match(context, /\[FACET 1\] How long can leftovers stay refrigerated/);
  assert.match(context, /\[FACET 2\] can I trust smell/);
  assert.match(context, /do not let the first facet crowd out later facets/i);
});