import assert from "node:assert/strict";
import test from "node:test";
import { formatRetrievedContext, injectRetrievedContext, patchIsActive, retrieveClaims } from "../src/rag.mjs";

function patch(overrides = {}) {
  return {
    patch_id: "pantry-003",
    desk: "The Pantry",
    title: "The Leftover Ledger",
    scope: "Food safety",
    published_at: "2026-08-28",
    valid_until: "2027-08-28",
    delivery: { status: "delivered", approved: true },
    claims: [
      {
        id: "P-06",
        statement: "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
        status: "verified",
        source_ids: ["P-SRC-1"],
      },
      {
        id: "P-08",
        statement: "Do not rely on smell or taste to decide whether food stored too long is safe; discard it when unsure.",
        status: "verified",
        source_ids: ["P-SRC-1"],
      },
      {
        id: "P-02",
        statement: "Perishable foods left at room temperature longer than 2 hours should be discarded.",
        status: "verified",
        source_ids: ["P-SRC-1"],
      },
      {
        id: "P-07",
        statement: "Fresh fish can be refrigerated for 1 to 2 days.",
        status: "verified",
        source_ids: ["P-SRC-1"],
      },
    ],
    sources: [{ id: "P-SRC-1", publisher: "USDA FSIS", url: "https://example.test/usda" }],
    ...overrides,
  };
}

function benchmarkPatch({ patchId, publishedAt, claimId, statement, supersedes = [] }) {
  return {
    patch_id: patchId,
    desk: "Maker Edition",
    title: "Synthetic supersession fixture",
    scope: "VS-Bench synthetic fixture",
    published_at: publishedAt,
    valid_until: "2027-08-28",
    delivery: { status: "delivered", approved: true },
    claims: [{
      id: claimId,
      statement,
      status: "verified",
      source_ids: ["BENCH-SRC-1"],
      ...(supersedes.length ? { supersedes } : {}),
    }],
    sources: [{ id: "BENCH-SRC-1", publisher: "VS-Bench", url: "https://example.test/fixture" }],
  };
}

test("only delivered, approved, unexpired patches are active", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  assert.equal(patchIsActive(patch(), now), true);
  assert.equal(patchIsActive(patch({ delivery: { status: "locked", approved: false } }), now), false);
  assert.equal(patchIsActive(patch({ valid_until: "2026-08-27" }), now), false);
});

test("lexical retrieval finds the cooked-leftover rule", async () => {
  const result = await retrieveClaims(
    "I cooked chicken five days ago and kept it refrigerated. Can I eat it?",
    [patch()],
    { now: new Date("2026-08-28T12:00:00Z"), limit: 2 },
  );
  assert.equal(result.mode, "lexical");
  assert.equal(result.results[0].claim_id, "P-06");
});

test("retrieval defaults to a focused three-claim context", async () => {
  const result = await retrieveClaims("leftover food safety", [patch()], {
    now: new Date("2026-08-28T12:00:00Z"),
  });
  assert.equal(result.results.length, 3);
});

test("active superseding claims remove replaced claims before ranking", async () => {
  const oldPatch = benchmarkPatch({
    patchId: "bench-shape-001",
    publishedAt: "2026-08-20",
    claimId: "SHAPE-01",
    statement: "The synthetic demo badge uses a square icon.",
  });
  const newPatch = benchmarkPatch({
    patchId: "bench-shape-002",
    publishedAt: "2026-08-28",
    claimId: "SHAPE-02",
    statement: "The synthetic demo badge uses a circle icon.",
    supersedes: ["bench-shape-001:SHAPE-01"],
  });
  const result = await retrieveClaims("What shape does the synthetic demo badge use?", [oldPatch, newPatch], {
    now: new Date("2026-08-28T12:00:00Z"),
    limit: 5,
  });
  assert.equal(result.results.some((item) => item.id === "bench-shape-001:SHAPE-01"), false);
  assert.equal(result.results[0].id, "bench-shape-002:SHAPE-02");
  assert.deepEqual(result.results[0].supersedes, ["bench-shape-001:SHAPE-01"]);
});

test("semantic retrieval can rank a claim through an embedding adapter", async () => {
  const embed = async (input) => input.map((_, index) => index === 0 ? [1, 0] : index === 1 ? [1, 0] : [0, 1]);
  const result = await retrieveClaims("leftover safety", [patch()], {
    now: new Date("2026-08-28T12:00:00Z"),
    embed,
  });
  assert.equal(result.mode, "semantic");
  assert.equal(result.results[0].claim_id, "P-06");
});

test("failed embeddings fall back to lexical retrieval", async () => {
  const result = await retrieveClaims("cooked leftovers refrigerator", [patch()], {
    now: new Date("2026-08-28T12:00:00Z"),
    embed: async () => { throw new Error("embedding model is not installed"); },
  });
  assert.equal(result.mode, "lexical-fallback");
  assert.equal(result.results[0].claim_id, "P-06");
});

test("retrieved context is ranked and injected into user context with provenance", async () => {
  const retrieval = await retrieveClaims("five day cooked chicken", [patch()], {
    now: new Date("2026-08-28T12:00:00Z"),
  });
  const context = formatRetrievedContext(retrieval);
  const messages = injectRetrievedContext([{ role: "user", content: "Can I eat it?" }], context);
  assert.match(messages[0].content, /RANK 1 \| pantry-003 \/ P-06/);
  assert.match(messages[0].content, /ground that part of the answer in the retrieved claim/);
  assert.match(messages[0].content, /Apply quantitative limits literally/);
  assert.match(messages[0].content, /beyond a retrieved maximum/);
  assert.match(messages[0].content, /Do not use sensory cues/);
  assert.match(messages[0].content, /Claims explicitly superseded/);
  assert.match(messages[0].content, /USER MESSAGE\nCan I eat it\?/);
  assert.equal(messages[0].role, "user");
});
