import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaimDeltaReport,
  compareClaimContent,
  extractQuantityDetails,
  formatDeltaAwareContext,
  retrieveDeltaAwareClaims,
} from "../src/claim-delta-rag.mjs";

function claim(id, statement, overrides = {}) {
  return {
    id: `pantry-delta:${id}`,
    patch_id: "pantry-delta",
    claim_id: id,
    desk: "The Pantry",
    title: "Synthetic overlap fixture",
    scope: "Food storage",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    statement,
    status: "verified",
    relationships: [],
    source_ids: [`SRC-${id}`],
    sources: [
      {
        id: `SRC-${id}`,
        publisher: `${id.toLowerCase()}.example.test`,
        url: `https://${id.toLowerCase()}.example.test/guidance`,
      },
    ],
    score: 0.9,
    lexical_score: 0.8,
    semantic_score: null,
    ...overrides,
  };
}

function baseRetrieval(results) {
  return {
    mode: "lexical",
    results,
    selection: {
      strategy: "evidence-aware-source-diversity",
      evidence: {
        status: "source-diverse",
        distinct_evidence_count: results.length,
        distinct_publisher_count: results.length,
        sourced_claim_count: results.length,
        unsourced_claim_count: 0,
        shared_evidence_group_count: 0,
        max_claims_on_one_evidence: 1,
        bundles: [],
      },
      answerability: {
        status: "current-context",
        answer_mode: "grounded-current-context",
        can_answer_from_current_publication: true,
        can_answer_entire_query_from_current_publication: true,
        current_claim_count: results.length,
        intent_count: 1,
        covered_intent_count: 1,
        uncovered_intents: [],
        historical_gap_count: 0,
        evidence_status: "source-diverse",
        reasons: [],
        missing_context_policy: "Use selected current claims.",
      },
    },
    resolution: { decisions: [], history: [], warnings: [] },
  };
}

test("quantity extraction preserves materially different time ranges", () => {
  const details = extractQuantityDetails(
    "Cooked leftovers keep for 3 to 4 days; frozen leftovers keep for 3 to 4 months.",
  );
  assert.equal(details.includes("3 to 4 days"), true);
  assert.equal(details.includes("3 to 4 months"), true);
});

test("high-overlap pantry claims retain the unique frozen-storage delta", () => {
  const refrigerated = claim(
    "A",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const refrigeratedAndFrozen = claim(
    "B",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days, while frozen leftovers can be kept for 3 to 4 months.",
  );

  const comparison = compareClaimContent(refrigerated, refrigeratedAndFrozen);
  assert.ok(comparison);
  assert.equal(comparison.classification, "overlap-with-distinct-details");
  assert.equal(comparison.overlap_score >= 0.65, true);
  assert.equal(
    comparison.right_unique.quantities.includes("3 to 4 months"),
    true,
  );
  assert.equal(comparison.right_unique.terms.includes("frozen"), true);
  assert.equal(comparison.has_explicit_relationship, false);
});

test("identical selected claim wording is marked high-overlap with minimal delta", () => {
  const left = claim(
    "A",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const right = claim(
    "B",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const comparison = compareClaimContent(left, right);
  assert.ok(comparison);
  assert.equal(comparison.classification, "high-overlap-minimal-delta");
  assert.equal(comparison.has_distinct_details, false);
});

test("unrelated selected claims are not forced into an overlap group", () => {
  const leftovers = claim(
    "A",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const modelRelease = claim(
    "B",
    "A local inference runtime added a new quantized model loader for GPUs.",
  );
  assert.equal(compareClaimContent(leftovers, modelRelease), null);
  const report = buildClaimDeltaReport([leftovers, modelRelease]);
  assert.equal(report.overlapping_pair_count, 0);
  assert.equal(report.groups.length, 0);
});

test("content similarity does not invent confirmation or any other authority relationship", () => {
  const left = claim(
    "A",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const right = claim(
    "B",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days, while frozen leftovers can be kept for 3 to 4 months.",
  );
  const comparison = compareClaimContent(left, right);
  assert.ok(comparison);
  assert.equal(comparison.descriptive_only, true);
  assert.deepEqual(comparison.explicit_relationships, []);
  assert.equal("inferred_relationship" in comparison, false);
});

test("real explicit relationship metadata is carried beside overlap without being inferred from it", () => {
  const left = claim(
    "A",
    "Update alerts appear for subscribed desks.",
  );
  const right = claim(
    "B",
    "Update alerts appear for subscribed desks only when a new issue exists.",
    {
      relationships: [
        {
          type: "narrows",
          target_id: "pantry-delta:A",
          reason: "The newer claim adds the new-issue boundary.",
        },
      ],
    },
  );
  const comparison = compareClaimContent(left, right, {
    overlapThreshold: 0.3,
  });
  assert.ok(comparison);
  assert.equal(comparison.has_explicit_relationship, true);
  assert.deepEqual(
    comparison.explicit_relationships.map((relationship) => relationship.type),
    ["narrows"],
  );
  assert.equal(comparison.descriptive_only, true);
});

test("report groups connected overlap while preserving per-pair deltas", () => {
  const a = claim(
    "A",
    "Cooked leftovers keep in the refrigerator for 3 to 4 days.",
  );
  const b = claim(
    "B",
    "Cooked leftovers keep in the refrigerator for 3 to 4 days and frozen leftovers keep for 3 to 4 months.",
  );
  const c = claim(
    "C",
    "Frozen leftovers can be stored for 3 to 4 months before quality declines.",
  );
  const report = buildClaimDeltaReport([a, b, c], {
    overlapThreshold: 0.35,
  });
  assert.equal(report.overlapping_pair_count >= 2, true);
  assert.equal(report.groups.length, 1);
  assert.deepEqual(report.groups[0].claim_ids.sort(), [
    "pantry-delta:A",
    "pantry-delta:B",
    "pantry-delta:C",
  ]);
  assert.equal(report.groups[0].contains_distinct_details, true);
});

test("delta wrapper calls the answerability stack once and keeps its status untouched", async () => {
  const a = claim(
    "A",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const b = claim(
    "B",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days, while frozen leftovers can be kept for 3 to 4 months.",
  );
  const base = baseRetrieval([a, b]);
  const embed = async () => [];
  let calls = 0;
  const result = await retrieveDeltaAwareClaims("leftover storage", [], {
    limit: 3,
    embed,
    answerabilityRetrieveImpl: async (query, patches, options) => {
      calls += 1;
      assert.equal(query, "leftover storage");
      assert.deepEqual(patches, []);
      assert.equal(options.limit, 3);
      assert.equal(options.embed, embed);
      assert.equal("answerabilityRetrieveImpl" in options, false);
      assert.equal("overlapThreshold" in options, false);
      return base;
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.selection.answerability.status, "current-context");
  assert.equal(result.selection.content_overlap.overlapping_pair_count, 1);
  assert.equal(result.results[1].content_neighbors.length, 1);
});

test("model context says overlapping claims may carry meaningful deltas and forbids authority inference", async () => {
  const a = claim(
    "A",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const b = claim(
    "B",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days, while frozen leftovers can be kept for 3 to 4 months.",
  );
  const result = await retrieveDeltaAwareClaims("leftover storage", [], {
    answerabilityRetrieveImpl: async () => baseRetrieval([a, b]),
  });
  const context = formatDeltaAwareContext(result);
  assert.match(context, /CONTENT OVERLAP \/ DELTA MAP/);
  assert.match(context, /do not establish confirmation, narrowing, conflict, replacement/);
  assert.match(context, /preserve those details instead of flattening/);
  assert.match(context, /3 to 4 months/);
  assert.match(context, /explicit_relationships=none/);
});
