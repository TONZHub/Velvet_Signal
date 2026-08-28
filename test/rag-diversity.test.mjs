import assert from "node:assert/strict";
import test from "node:test";
import { retrieveClaims } from "../src/rag.mjs";

function patchFromClaims(claims, overrides = {}) {
  return {
    patch_id: "bench-diversity-001",
    desk: "VS-Bench",
    title: "Synthetic retrieval diversity fixture",
    scope: "VS-Bench synthetic fixture",
    published_at: "2026-08-28T10:00:00.000Z",
    valid_until: "2027-08-28",
    delivery: { status: "delivered", approved: true },
    claims: claims.map((claim) => ({
      status: "verified",
      source_ids: ["BENCH-SRC-1"],
      ...claim,
    })),
    sources: [
      {
        id: "BENCH-SRC-1",
        publisher: "VS-Bench",
        url: "https://example.test/diversity-fixture",
      },
    ],
    ...overrides,
  };
}

function relationshipPatch({ patchId, publishedAt, claimId, statement, relationships = [] }) {
  return patchFromClaims(
    [{ id: claimId, statement, relationships }],
    { patch_id: patchId, published_at: publishedAt },
  );
}

test("diversity-aware selection keeps a distinct relevant rule from being crowded out by a near duplicate", async () => {
  const fixture = patchFromClaims([
    {
      id: "A",
      statement: "Cooked leftovers refrigerator storage lasts 3 to 4 days.",
    },
    {
      id: "B",
      statement: "Cooked leftovers refrigerator storage lasts three to four days.",
    },
    {
      id: "C",
      statement: "Smell should not decide whether stored food is safe.",
    },
  ]);

  const result = await retrieveClaims(
    "stored leftovers refrigerator smell",
    [fixture],
    { now: new Date("2026-08-28T12:00:00Z"), limit: 2 },
  );

  assert.equal(result.selection.strategy, "maximal-marginal-relevance");
  assert.deepEqual(
    result.results.map((item) => item.id),
    ["bench-diversity-001:A", "bench-diversity-001:C"],
  );
  assert.equal(result.results[1].selection_reason, "relevance-and-coverage");
  assert.equal(
    result.results.some((item) => item.id === "bench-diversity-001:B"),
    false,
  );
});

test("explicit narrowing companions remain eligible even when their wording overlaps", async () => {
  const broad = relationshipPatch({
    patchId: "bench-alert-001",
    publishedAt: "2026-08-20T00:00:00.000Z",
    claimId: "ALERT-01",
    statement: "Update alerts appear for subscribed desks.",
  });
  const narrow = relationshipPatch({
    patchId: "bench-alert-002",
    publishedAt: "2026-08-28T00:00:00.000Z",
    claimId: "ALERT-02",
    statement: "Update alerts appear only for subscribed desks with new issues.",
    relationships: [
      {
        type: "narrows",
        target_id: "bench-alert-001:ALERT-01",
        reason: "The newer fixture adds the new-issue boundary.",
      },
    ],
  });
  const distractor = relationshipPatch({
    patchId: "bench-alert-003",
    publishedAt: "2026-08-27T00:00:00.000Z",
    claimId: "ALERT-03",
    statement: "The dashboard highlights unread items with a badge.",
  });

  const result = await retrieveClaims(
    "when do update alerts appear for subscribed desks new issues",
    [broad, narrow, distractor],
    { now: new Date("2026-08-28T12:00:00Z"), limit: 2 },
  );

  assert.deepEqual(
    result.results.map((item) => item.id),
    ["bench-alert-002:ALERT-02", "bench-alert-001:ALERT-01"],
  );
  assert.equal(
    result.results[1].selection_reason,
    "relationship-companion:narrows",
  );
});

test("semantic diversity selection reuses the existing embedding batch", async () => {
  const fixture = patchFromClaims([
    { id: "A", statement: "Alpha update rule." },
    { id: "B", statement: "Alpha update guidance." },
    { id: "C", statement: "Beta boundary rule." },
  ]);
  let calls = 0;
  const embed = async (input) => {
    calls += 1;
    assert.equal(input.length, 4);
    return [
      [1, 0, 0],
      [1, 0, 0],
      [0.98, 0.2, 0],
      [0.72, 0, 0.7],
    ];
  };

  const result = await retrieveClaims("alpha beta update rule", [fixture], {
    now: new Date("2026-08-28T12:00:00Z"),
    limit: 2,
    embed,
  });

  assert.equal(calls, 1);
  assert.equal(result.mode, "semantic");
  assert.equal(result.selection.strategy, "maximal-marginal-relevance");
  assert.equal(result.results.length, 2);
});
