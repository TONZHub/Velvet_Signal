import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBudgetedContext,
  CONTEXT_BUDGET_DEFAULTS,
  formatBudgetedContext,
} from "../src/context-budget.mjs";

function claim(id, statement, overrides = {}) {
  return {
    id: `budget:${id}`,
    patch_id: "budget",
    claim_id: id,
    desk: "VS-Bench",
    title: "Context budget fixture",
    scope: "Synthetic packing",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    statement,
    relationships: [],
    source_ids: [`SRC-${id}`],
    sources: [
      {
        id: `SRC-${id}`,
        publisher: `${id.toLowerCase()}.example.test`,
        url: `https://${id.toLowerCase()}.example.test/guidance`,
      },
    ],
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const first = claim(
    "A",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
  );
  const second = claim(
    "B",
    "Cooked leftovers can be kept in the refrigerator for 3 to 4 days, while frozen leftovers can be kept for 3 to 4 months.",
  );
  return {
    mode: "lexical",
    results: [first, second],
    selection: {
      intent_count: 2,
      intents_covered: 2,
      intents: [
        { id: 1, text: "How long refrigerated leftovers keep", covered_by: [first.id, second.id] },
        { id: 2, text: "How long frozen leftovers keep", covered_by: [second.id] },
      ],
      evidence: {
        status: "mixed-source-diversity",
        distinct_evidence_count: 2,
        distinct_publisher_count: 2,
        sourced_claim_count: 2,
        unsourced_claim_count: 0,
        shared_evidence_group_count: 1,
        max_claims_on_one_evidence: 2,
        bundles: [
          {
            id: "E1",
            supports: [first.id, second.id],
            publishers: ["a.example.test"],
            shared_by_multiple_claims: true,
          },
        ],
      },
      answerability: {
        status: "current-context",
        answer_mode: "grounded-current-context",
        can_answer_from_current_publication: true,
        can_answer_entire_query_from_current_publication: true,
        current_claim_count: 2,
        intent_count: 2,
        covered_intent_count: 2,
        uncovered_intents: [],
        historical_gap_count: 0,
        evidence_status: "mixed-source-diversity",
        reasons: [],
        missing_context_policy: "Use the selected current claims for the factual parts they cover.",
      },
      content_overlap: {
        overlapping_pair_count: 1,
        distinct_detail_pair_count: 1,
        pairs: [
          {
            left_id: first.id,
            right_id: second.id,
            overlap_score: 1,
            has_distinct_details: true,
            left_unique: { terms: [], quantities: [] },
            right_unique: {
              terms: ["frozen", "months"],
              quantities: ["3 to 4 months"],
            },
          },
        ],
      },
    },
    resolution: { decisions: [], history: [], warnings: [] },
    ...overrides,
  };
}

test("default compact packet keeps critical policies, current claims, answerability, and evidence summary", () => {
  const packed = buildBudgetedContext(fixture());
  assert.equal(packed.diagnostics.budget_chars, CONTEXT_BUDGET_DEFAULTS.default_chars);
  assert.match(packed.text, /VELVET SIGNAL COMPACT CURRENT CONTEXT/);
  assert.match(packed.text, /PATCH POLICY/);
  assert.match(packed.text, /\[STATUS\] current-context/);
  assert.match(packed.text, /budget\/A \| CURRENT/);
  assert.match(packed.text, /3 to 4 days/);
  assert.match(packed.text, /budget\/B \| CURRENT/);
  assert.match(packed.text, /3 to 4 months/);
  assert.match(packed.text, /\[SUMMARY\] status=mixed-source-diversity/);
  assert.match(packed.text, /do not by themselves prove consensus/);
});

test("ample budget includes delta, covered-facet, and shared-evidence diagnostics", () => {
  const packed = buildBudgetedContext(fixture(), { maxChars: 10000 });
  assert.match(packed.text, /MEANINGFUL OVERLAP DELTAS/);
  assert.match(packed.text, /\[DELTA budget:A <-> budget:B\]/);
  assert.match(packed.text, /quantities=3 to 4 months/);
  assert.match(packed.text, /QUERY FACETS/);
  assert.match(packed.text, /\[FACET 2\]/);
  assert.match(packed.text, /\[SHARED E1\]/);
  assert.equal(packed.diagnostics.omitted_optional_count, 0);
});

test("a tight budget drops optional diagnostics before any selected fact", () => {
  const roomy = buildBudgetedContext(fixture(), { maxChars: 10000 });
  const tight = buildBudgetedContext(fixture(), {
    maxChars: roomy.diagnostics.mandatory_chars,
  });
  assert.equal(tight.diagnostics.hard_minimum_exceeded, false);
  assert.equal(tight.diagnostics.omitted_optional_count > 0, true);
  assert.match(tight.text, /Cooked leftovers can be kept in the refrigerator for 3 to 4 days/);
  assert.match(tight.text, /frozen leftovers can be kept for 3 to 4 months/);
  assert.doesNotMatch(tight.text, /MEANINGFUL OVERLAP DELTAS/);
  assert.doesNotMatch(tight.text, /QUERY FACETS/);
  assert.doesNotMatch(tight.text, /\[SHARED E1\]/);
  assert.equal(tight.diagnostics.used_chars <= tight.diagnostics.budget_chars, true);
});

test("if mandatory facts alone exceed the budget, facts remain whole and every optional item stays out", () => {
  const uniqueTail = "MANDATORY-TAIL-MUST-SURVIVE";
  const veryLong = claim(
    "LONG",
    `${"Current claim detail. ".repeat(140)}${uniqueTail}`,
  );
  const retrieval = fixture({
    results: [veryLong],
  });
  retrieval.selection.content_overlap = {
    pairs: [
      {
        left_id: veryLong.id,
        right_id: "budget:OTHER",
        overlap_score: 0.9,
        has_distinct_details: true,
        left_unique: { terms: ["detail"], quantities: [] },
        right_unique: { terms: ["other"], quantities: [] },
      },
    ],
  };
  const packed = buildBudgetedContext(retrieval, { maxChars: 800 });
  assert.equal(packed.diagnostics.hard_minimum_exceeded, true);
  assert.equal(packed.diagnostics.used_chars > packed.diagnostics.budget_chars, true);
  assert.match(packed.text, new RegExp(uniqueTail));
  assert.doesNotMatch(packed.text, /MEANINGFUL OVERLAP DELTAS/);
  assert.equal(packed.diagnostics.included_optional_count, 0);
  assert.equal(packed.diagnostics.omitted_optional_count > 0, true);
});

test("explicit relationship decisions are mandatory even under a tight soft budget", () => {
  const retrieval = fixture();
  retrieval.resolution.decisions = [
    {
      type: "narrows",
      source_id: "budget:B",
      target_id: "budget:A",
      action: "both_active",
      reason: "The newer claim adds the frozen-storage boundary.",
    },
  ];
  const roomy = buildBudgetedContext(retrieval, { maxChars: 10000 });
  const tight = buildBudgetedContext(retrieval, {
    maxChars: roomy.diagnostics.mandatory_chars,
  });
  assert.match(tight.text, /EXPLICIT RELATIONSHIPS/);
  assert.match(tight.text, /\[REL NARROWS\] budget:B -> budget:A action=both_active/);
  assert.match(tight.text, /frozen-storage boundary/);
});

test("no-current-context still produces an explicit compact negative-capability packet", () => {
  const empty = {
    mode: "empty",
    results: [],
    selection: {
      answerability: {
        status: "no-current-context",
        answer_mode: "no-current-patch-guidance",
        can_answer_from_current_publication: false,
        can_answer_entire_query_from_current_publication: false,
        current_claim_count: 0,
        intent_count: 1,
        covered_intent_count: 0,
        uncovered_intents: [],
        historical_gap_count: 0,
        evidence_status: null,
        reasons: [],
        missing_context_policy: "Do not imply Velvet Signal supplied a current update. General model knowledge may be used only if clearly identified as outside current Velvet Signal context.",
      },
    },
    resolution: { decisions: [], history: [], warnings: [] },
  };
  const text = formatBudgetedContext(empty);
  assert.match(text, /\[STATUS\] no-current-context/);
  assert.match(text, /No active publication claim was selected/);
  assert.match(text, /outside current Velvet Signal context/);
});

test("packing diagnostics report approximate token size and included sections without claiming tokenizer precision", () => {
  const packed = buildBudgetedContext(fixture(), { maxChars: 10000 });
  assert.equal(packed.diagnostics.approximate_tokens, Math.ceil(packed.text.length / 4));
  assert.equal(packed.diagnostics.sections_included.includes("claims"), true);
  assert.equal(packed.diagnostics.sections_included.includes("answerability"), true);
  assert.equal("exact_tokens" in packed.diagnostics, false);
});

test("context budget input is clamped to supported bounds", () => {
  const tiny = buildBudgetedContext(fixture(), { maxChars: 1 });
  const huge = buildBudgetedContext(fixture(), { maxChars: 999999 });
  assert.equal(tiny.diagnostics.budget_chars, CONTEXT_BUDGET_DEFAULTS.min_chars);
  assert.equal(huge.diagnostics.budget_chars, CONTEXT_BUDGET_DEFAULTS.max_chars);
});
