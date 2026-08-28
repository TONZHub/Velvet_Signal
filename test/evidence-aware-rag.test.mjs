import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalSourceKey,
  evidenceReport,
  formatEvidenceAwareContext,
  retrieveEvidenceAwareClaims,
} from "../src/evidence-aware-rag.mjs";

function evidencePatch({ weakAlternative = false, relationship = false } = {}) {
  return {
    patch_id: "evidence-001",
    desk: "The Pantry",
    title: "Synthetic evidence fixture",
    scope: "Food storage",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    delivery: { status: "delivered", approved: true },
    claims: [
      {
        id: "A",
        statement: "Cooked leftovers in the refrigerator keep for about four days.",
        status: "verified",
        source_ids: ["S1"],
      },
      {
        id: "B",
        statement: "Refrigerated cooked leftovers should be discarded after four days.",
        status: "verified",
        source_ids: ["S1"],
        ...(relationship
          ? {
              relationships: [
                {
                  type: "narrows",
                  target_id: "evidence-001:A",
                  reason: "The newer fixture adds an explicit discard boundary.",
                },
              ],
            }
          : {}),
      },
      {
        id: "C",
        statement: weakAlternative
          ? "Bananas ripen on the kitchen counter."
          : "Cooked refrigerated leftovers are best used within four days.",
        status: "verified",
        source_ids: ["S2"],
      },
    ],
    sources: [
      {
        id: "S1",
        name: "Primary leftovers guidance",
        publisher: "example.test",
        url: "https://www.example.test/food/leftovers?utm_source=scout",
      },
      {
        id: "S2",
        name: "Second leftovers guidance",
        publisher: "second.test",
        url: "https://second.test/storage/leftovers",
      },
    ],
  };
}

function resultRecord(id, source, overrides = {}) {
  return {
    id: `evidence-001:${id}`,
    patch_id: "evidence-001",
    claim_id: id,
    desk: "The Pantry",
    title: "Synthetic evidence fixture",
    scope: "Food storage",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    statement:
      id === "A"
        ? "Cooked leftovers in the refrigerator keep for about four days."
        : "Refrigerated cooked leftovers should be discarded after four days.",
    status: "verified",
    relationships: [],
    source_ids: [source.id],
    sources: [source],
    score: id === "A" ? 1 : 0.92,
    lexical_score: id === "A" ? 1 : 0.9,
    semantic_score: null,
    ...overrides,
  };
}

function concentratedBase(overrides = {}) {
  const shared = {
    id: "S1",
    name: "Primary leftovers guidance",
    publisher: "example.test",
    url: "https://example.test/food/leftovers?utm_medium=packet",
  };
  return {
    mode: "lexical",
    results: [resultRecord("A", shared), resultRecord("B", shared)],
    selection: { strategy: "maximal-marginal-relevance" },
    resolution: { decisions: [], history: [], warnings: [] },
    ...overrides,
  };
}

test("canonical source identity ignores www and tracking parameters", () => {
  const left = canonicalSourceKey({
    url: "https://www.example.com/story/?utm_source=one&x=1#section",
  });
  const right = canonicalSourceKey({
    url: "http://example.com/story?x=1&utm_medium=two",
  });
  assert.equal(left, right);
  assert.equal(left, "url:example.com/story?x=1");
});

test("different URLs from one publisher stay distinct while publisher concentration remains visible", () => {
  const report = evidenceReport([
    resultRecord("A", {
      id: "G1",
      publisher: "github.com",
      url: "https://github.com/alpha/project",
    }),
    resultRecord("B", {
      id: "G2",
      publisher: "github.com",
      url: "https://github.com/beta/project",
    }),
  ]);
  assert.equal(report.distinct_evidence_count, 2);
  assert.equal(report.distinct_publisher_count, 1);
  assert.equal(report.status, "source-diverse");
});

test("source-concentrated results can be supplemented from a distinct active evidence lineage", async () => {
  let calls = 0;
  const embed = async () => [];
  const result = await retrieveEvidenceAwareClaims(
    "How long do cooked leftovers last in the refrigerator?",
    [evidencePatch()],
    {
      limit: 2,
      embed,
      retrieveImpl: async (_query, _patches, options) => {
        calls += 1;
        assert.equal(options.limit, 2);
        assert.equal(options.embed, embed);
        return concentratedBase();
      },
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(
    result.results.map((item) => item.id),
    ["evidence-001:A", "evidence-001:C"],
  );
  assert.equal(result.results[1].supplemental_retrieval, "local-lexical-active-ledger");
  assert.equal(result.selection.strategy, "evidence-aware-source-diversity");
  assert.equal(result.selection.evidence_replacements.length, 1);
  assert.equal(result.selection.evidence.distinct_evidence_count, 2);
});

test("a weak unrelated source is not substituted just to manufacture diversity", async () => {
  const result = await retrieveEvidenceAwareClaims(
    "How long do cooked leftovers last in the refrigerator?",
    [evidencePatch({ weakAlternative: true })],
    {
      limit: 2,
      retrieveImpl: async () => concentratedBase(),
    },
  );
  assert.deepEqual(
    result.results.map((item) => item.id),
    ["evidence-001:A", "evidence-001:B"],
  );
  assert.equal(result.selection.evidence_replacements.length, 0);
  assert.equal(result.selection.evidence.status, "single-evidence-lineage");
});

test("explicit narrowing companions are not sacrificed for source diversity", async () => {
  const patch = evidencePatch({ relationship: true });
  const base = concentratedBase();
  base.results[1].relationships = [
    {
      type: "narrows",
      target_id: "evidence-001:A",
      reason: "The newer fixture adds an explicit discard boundary.",
    },
  ];
  const result = await retrieveEvidenceAwareClaims(
    "How long do cooked leftovers last in the refrigerator?",
    [patch],
    { limit: 2, retrieveImpl: async () => base },
  );
  assert.deepEqual(
    result.results.map((item) => item.id),
    ["evidence-001:A", "evidence-001:B"],
  );
  assert.equal(result.selection.evidence_replacements.length, 0);
});

test("the only claim covering a compound-query facet cannot be displaced by a source-diverse claim for another facet", async () => {
  const patch = {
    ...evidencePatch(),
    claims: [
      {
        id: "A",
        statement: "Cooked leftovers in the refrigerator keep for about four days.",
        status: "verified",
        source_ids: ["S1"],
      },
      {
        id: "B",
        statement: "Smell cannot reliably determine whether old leftovers are safe.",
        status: "verified",
        source_ids: ["S1"],
      },
      {
        id: "C",
        statement: "Refrigerated cooked leftovers are best used within four days.",
        status: "verified",
        source_ids: ["S2"],
      },
    ],
  };
  const shared = patch.sources[0];
  const base = {
    mode: "lexical",
    results: [
      resultRecord("A", shared, {
        statement: patch.claims[0].statement,
        matched_intents: [0],
        intent_scores: [1, 0],
      }),
      resultRecord("B", shared, {
        statement: patch.claims[1].statement,
        matched_intents: [1],
        intent_scores: [0, 1],
      }),
    ],
    selection: {
      strategy: "multi-intent-coverage",
      intent_count: 2,
      intents: [
        { id: 1, text: "How long do cooked leftovers keep", covered_by: ["evidence-001:A"] },
        { id: 2, text: "Can smell tell whether old leftovers are safe", covered_by: ["evidence-001:B"] },
      ],
      intents_covered: 2,
    },
    resolution: { decisions: [], history: [], warnings: [] },
  };
  const result = await retrieveEvidenceAwareClaims(
    "How long do cooked leftovers keep, and can smell tell whether old leftovers are safe?",
    [patch],
    { limit: 2, retrieveImpl: async () => base },
  );
  assert.deepEqual(
    result.results.map((item) => item.id),
    ["evidence-001:A", "evidence-001:B"],
  );
  assert.equal(result.selection.intents_covered, 2);
});

test("historical tombstones survive evidence supplementation", async () => {
  const base = concentratedBase({
    resolution: {
      decisions: [
        {
          type: "replaces",
          source_id: "old-new:NEW",
          target_id: "old-old:OLD",
          action: "target_withheld_by_historical_tombstone",
        },
      ],
      history: [
        { id: "old-new:NEW" },
        { id: "old-old:OLD" },
      ],
      warnings: [],
    },
  });
  const result = await retrieveEvidenceAwareClaims(
    "How long do cooked leftovers last in the refrigerator?",
    [evidencePatch()],
    { limit: 2, retrieveImpl: async () => base },
  );
  assert.equal(
    result.resolution.decisions.some(
      (decision) => decision.action === "target_withheld_by_historical_tombstone",
    ),
    true,
  );
  assert.deepEqual(
    result.resolution.history.map((item) => item.id).sort(),
    ["old-new:NEW", "old-old:OLD"],
  );
});

test("model context explicitly distinguishes source diversity from independent confirmation", async () => {
  const result = await retrieveEvidenceAwareClaims(
    "How long do cooked leftovers last in the refrigerator?",
    [evidencePatch()],
    { limit: 2, retrieveImpl: async () => concentratedBase() },
  );
  const context = formatEvidenceAwareContext(result);
  assert.match(context, /EVIDENCE MAP/);
  assert.match(context, /not independent confirmation/);
  assert.match(context, /do not by themselves prove consensus/);
  assert.match(context, /distinct_evidence=2/);
});
