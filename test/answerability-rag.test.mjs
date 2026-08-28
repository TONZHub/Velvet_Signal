import assert from "node:assert/strict";
import test from "node:test";
import {
  assessRetrievalAnswerability,
  formatAnswerabilityContext,
  retrieveAnswerableClaims,
} from "../src/answerability-rag.mjs";

function claim(id = "A", overrides = {}) {
  return {
    id: `answer-${id}:${id}`,
    patch_id: `answer-${id}`,
    claim_id: id,
    desk: "VS-Bench",
    title: "Answerability fixture",
    scope: "Synthetic current context",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    statement: `Synthetic current claim ${id}.`,
    status: "verified",
    relationships: [],
    source_ids: [`SRC-${id}`],
    sources: [
      {
        id: `SRC-${id}`,
        name: `Synthetic source ${id}`,
        publisher: `${id.toLowerCase()}.example.test`,
        url: `https://${id.toLowerCase()}.example.test/report`,
      },
    ],
    score: 0.9,
    lexical_score: 0.8,
    semantic_score: null,
    ...overrides,
  };
}

function evidence(status = "source-diverse", overrides = {}) {
  return {
    status,
    distinct_evidence_count: status === "single-evidence-lineage" ? 1 : 2,
    distinct_publisher_count: status === "single-evidence-lineage" ? 1 : 2,
    sourced_claim_count: 1,
    unsourced_claim_count: 0,
    shared_evidence_group_count: 0,
    max_claims_on_one_evidence: 1,
    bundles: [],
    ...overrides,
  };
}

function retrieval(overrides = {}) {
  return {
    mode: "lexical",
    results: [claim()],
    selection: {
      strategy: "maximal-marginal-relevance",
      evidence: evidence(),
    },
    resolution: { decisions: [], history: [], warnings: [] },
    ...overrides,
  };
}

test("a fully covered current retrieval is answerable without inventing a numeric confidence score", () => {
  const result = assessRetrievalAnswerability(retrieval());
  assert.equal(result.status, "current-context");
  assert.equal(result.answer_mode, "grounded-current-context");
  assert.equal(result.can_answer_from_current_publication, true);
  assert.equal(result.can_answer_entire_query_from_current_publication, true);
  assert.equal(result.current_claim_count, 1);
  assert.equal(result.intent_count, 1);
  assert.equal(result.covered_intent_count, 1);
  assert.equal("confidence" in result, false);
});

test("an uncovered compound-query facet produces partial-current-context", () => {
  const first = claim("A", {
    matched_intents: [0],
    intent_scores: [1, 0],
  });
  const result = assessRetrievalAnswerability(
    retrieval({
      results: [first],
      selection: {
        strategy: "multi-intent-coverage",
        intent_count: 2,
        intents_covered: 1,
        intents: [
          { id: 1, text: "What is the current storage limit", covered_by: [first.id] },
          { id: 2, text: "Can smell override it", covered_by: [] },
        ],
        evidence: evidence("single-evidence-lineage"),
      },
    }),
  );
  assert.equal(result.status, "partial-current-context");
  assert.equal(result.can_answer_entire_query_from_current_publication, false);
  assert.deepEqual(result.uncovered_intents, [
    { id: 2, text: "Can smell override it" },
  ]);
  assert.equal(
    result.reasons.some((reason) => reason.code === "uncovered-query-facet"),
    true,
  );
});

test("a historical tombstone with no active result becomes an explicit update gap", () => {
  const result = assessRetrievalAnswerability({
    mode: "lexical-relationship-only",
    results: [],
    selection: {},
    resolution: {
      decisions: [
        {
          type: "replaces",
          source_id: "new:NEW",
          target_id: "old:OLD",
          action: "target_withheld_by_historical_tombstone",
        },
      ],
      history: [{ id: "new:NEW" }, { id: "old:OLD" }],
      warnings: [],
    },
  });
  assert.equal(result.status, "update-gap");
  assert.equal(result.answer_mode, "abstain-on-current-patch");
  assert.equal(result.can_answer_from_current_publication, false);
  assert.equal(result.historical_gap_count, 1);
  assert.match(result.missing_context_policy, /Do not reconstruct/);
});

test("an empty retrieval without a tombstone is no-current-context", () => {
  const result = assessRetrievalAnswerability({
    mode: "empty",
    results: [],
    selection: {},
    resolution: { decisions: [], history: [], warnings: [] },
  });
  assert.equal(result.status, "no-current-context");
  assert.equal(result.can_answer_from_current_publication, false);
  assert.match(result.missing_context_policy, /outside current Velvet Signal context/);
});

test("current claims plus a matched historical gap remain partial rather than being called complete", () => {
  const result = assessRetrievalAnswerability(
    retrieval({
      resolution: {
        decisions: [
          {
            type: "replaces",
            source_id: "new:NEW",
            target_id: "old:OLD",
            action: "target_withheld_by_historical_tombstone",
          },
        ],
        history: [{ id: "new:NEW" }, { id: "old:OLD" }],
        warnings: [],
      },
    }),
  );
  assert.equal(result.status, "partial-current-context");
  assert.equal(result.can_answer_from_current_publication, true);
  assert.equal(result.can_answer_entire_query_from_current_publication, false);
  assert.equal(
    result.reasons.some((reason) => reason.code === "historical-update-gap"),
    true,
  );
});

test("single evidence lineage is a caveat, not an automatic refusal to answer", () => {
  const result = assessRetrievalAnswerability(
    retrieval({
      selection: {
        strategy: "maximal-marginal-relevance",
        evidence: evidence("single-evidence-lineage"),
      },
    }),
  );
  assert.equal(result.status, "current-context");
  assert.equal(result.evidence_status, "single-evidence-lineage");
  assert.equal(
    result.reasons.some((reason) => reason.code === "single-evidence-lineage"),
    true,
  );
});

test("the wrapper calls the evidence-aware retriever once and preserves its adapter options", async () => {
  let calls = 0;
  const embed = async () => [];
  const result = await retrieveAnswerableClaims("synthetic question", [], {
    limit: 3,
    embed,
    evidenceRetrieveImpl: async (query, patches, options) => {
      calls += 1;
      assert.equal(query, "synthetic question");
      assert.deepEqual(patches, []);
      assert.equal(options.limit, 3);
      assert.equal(options.embed, embed);
      assert.equal("evidenceRetrieveImpl" in options, false);
      return retrieval();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.selection.answerability.status, "current-context");
});

test("no-current-context still injects an explicit status block instead of disappearing", () => {
  const empty = {
    mode: "empty",
    results: [],
    selection: {},
    resolution: { decisions: [], history: [], warnings: [] },
  };
  const context = formatAnswerabilityContext(empty);
  assert.match(context, /VELVET SIGNAL RETRIEVED CONTEXT/);
  assert.match(context, /\[STATUS\] no-current-context/);
  assert.match(context, /No active publication claim was selected/);
  assert.match(context, /prior knowledge is current/);
});

test("partial context names the uncovered facet inside the model packet", () => {
  const first = claim("A", {
    matched_intents: [0],
    intent_scores: [1, 0],
  });
  const partial = retrieval({
    results: [first],
    selection: {
      strategy: "multi-intent-coverage",
      intent_count: 2,
      intents_covered: 1,
      intents: [
        { id: 1, text: "What is current", covered_by: [first.id] },
        { id: 2, text: "What is missing", covered_by: [] },
      ],
      evidence: evidence("single-evidence-lineage"),
    },
  });
  partial.selection.answerability = assessRetrievalAnswerability(partial);
  const context = formatAnswerabilityContext(partial);
  assert.match(context, /\[STATUS\] partial-current-context/);
  assert.match(context, /\[UNCOVERED FACET 2\] What is missing/);
  assert.match(context, /historical gaps must not be filled from stale claims/);
});
