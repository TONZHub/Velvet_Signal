import assert from "node:assert/strict";
import test from "node:test";
import { listIssues } from "../src/catalog.mjs";
import { patchForIssue } from "../src/patch.mjs";
import {
  createDeliveryReceipt,
  receiptSigningConfigured,
  verifyDeliveryReceipt,
} from "../src/receipts.mjs";

const receiptOptions = {
  secret: "test-receipt-secret-at-least-16-characters",
  issuer: "https://velvetsignal.lol",
};

test("every launch issue has the same signed delivery and expiry contract", async () => {
  const catalog = await listIssues();
  assert.equal(catalog.issues.length >= 6, true);
  for (const issue of catalog.issues) {
    const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
    const receipt = createDeliveryReceipt(patch, receiptOptions);
    const verified = verifyDeliveryReceipt(patch, receipt, receiptOptions);
    assert.equal(patch.patch_id, issue.id);
    assert.equal(patch.delivery.status, "delivered");
    assert.equal(patch.delivery.approved, true);
    assert.equal(patch.handling.discard_after, issue.expires);
    assert.match(patch.handling.expiry_effect, /historical provenance/);
    assert.equal(verified.valid, true, issue.id);
    assert.equal(verified.content_hash_valid, true, issue.id);
  }
});

test("delivered patches expose only sources cited by published claims", () => {
  const issue = {
    id: "culture-demo-001",
    desk: "Culture Desk",
    issue: "DEMO",
    title: "Synthetic scouting fixture",
    publishedAt: "2026-09-01T00:00:00.000Z",
    expires: "2026-09-10",
    scope: "Culture signals",
    claims: [
      {
        id: "C-01",
        claim: "The selected story is the one published in source three.",
        status: "verified",
        sourceIds: ["C-SRC-3"],
      },
    ],
    sources: [
      { id: "C-SRC-1", name: "Unrelated scout one", publisher: "one.test", url: "https://one.test/story", checked: "2026-09-01" },
      { id: "C-SRC-2", name: "Unrelated scout two", publisher: "two.test", url: "https://two.test/story", checked: "2026-09-01" },
      { id: "C-SRC-3", name: "Supporting story", publisher: "three.test", url: "https://three.test/story", checked: "2026-09-01" },
    ],
    toneNotes: [],
  };

  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });

  assert.deepEqual(patch.sources.map((source) => source.id), ["C-SRC-3"]);
  assert.deepEqual(patch.source_selection, {
    scouted_count: 3,
    supporting_count: 1,
    excluded_count: 2,
    policy: "Delivered patches include only sources cited by published claims; scouting candidates remain editorial input, not supporting evidence.",
  });
  assert.equal(patch.source_agreement.checked, 1);
  assert.deepEqual(patch.claims[0].source_ids, ["C-SRC-3"]);
});

test("claim status distinguishes source reporting from independent verification", () => {
  const issue = {
    id: "evidence-demo-001",
    desk: "Maker Edition",
    issue: "DEMO",
    title: "Evidence status fixture",
    publishedAt: "2026-09-01T00:00:00.000Z",
    expires: "2026-09-10",
    scope: "Testing",
    sources: [
      { id: "SRC-1", name: "First report", publisher: "one.test", url: "https://one.test", checked: "2026-09-01" },
      { id: "SRC-2", name: "Independent report", publisher: "two.test", url: "https://two.test", checked: "2026-09-01" },
    ],
    claims: [
      { id: "E-01", claim: "One outlet reports this.", status: "verified", sourceIds: ["SRC-1"] },
      { id: "E-02", claim: "Two publishers support this.", status: "verified", verification: "independent", sourceIds: ["SRC-1", "SRC-2"] },
      { id: "E-03", claim: "This remains uncertain.", status: "needs-review", sourceIds: ["SRC-1", "SRC-2"] },
    ],
    toneNotes: [],
  };

  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });

  assert.deepEqual(patch.claims.map((claim) => claim.status), [
    "source-reported",
    "independently-verified",
    "needs-review",
  ]);
  assert.deepEqual(patch.claims[0].evidence, {
    source_count: 1,
    publisher_count: 1,
  });
  assert.deepEqual(patch.claims[1].evidence, {
    source_count: 2,
    publisher_count: 2,
  });
  assert.equal("editorial_status" in patch.claims[0], false);

  const unreviewed = patchForIssue({
    ...issue,
    claims: [{ id: "E-04", claim: "Two publishers, but no explicit independent review.", status: "verified", sourceIds: ["SRC-1", "SRC-2"] }],
  }, { deliveryStatus: "delivered" });
  assert.equal(unreviewed.claims[0].status, "source-reported");
});

test("the corrected Hermes edition narrows the browser LLM claim and advances the version", async () => {
  const catalog = await listIssues();
  const issue = catalog.issues.find((candidate) => candidate.id === "maker-012");
  assert(issue);
  assert.equal(issue.version, "1.0.1");
  assert.match(issue.title, /snapshot summarization/i);
  assert.match(issue.claims.find((claim) => claim.id === "M-02")?.claim ?? "", /still includes LLM-backed visual analysis/i);
  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
  assert.equal(patch.correction.previous_version, "1.0.0");
  assert.match(patch.correction.summary, /browser vision still calls an LLM/i);
  assert.equal(patch.claims.find((claim) => claim.id === "M-01")?.status, "source-reported");
});

test("patch generation preserves explicit supersession references", () => {
  const issue = {
    id: "bench-shape-002", desk: "Maker Edition", issue: "BENCH", title: "Synthetic fixture",
    publishedAt: "2026-08-28T00:00:00.000Z", expires: "2027-08-28", scope: "VS-Bench",
    claims: [{ id: "SHAPE-02", claim: "The synthetic demo badge uses a circle icon.", status: "verified", source: 0, supersedes: ["bench-shape-001:SHAPE-01"] }],
    sources: [{ name: "VS-Bench fixture", publisher: "Velvet Signal", url: "https://example.test", checked: "2026-08-28" }],
    toneNotes: ["Synthetic fixture only."],
  };
  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
  assert.deepEqual(patch.claims[0].supersedes, ["bench-shape-001:SHAPE-01"]);
  assert.deepEqual(patch.claims[0].relationships, [
    {
      type: "replaces",
      target_id: "bench-shape-001:SHAPE-01",
      reason: "Explicit legacy supersession reference.",
    },
  ]);
});

test("patch generation preserves typed claim relationships and compatibility supersession", () => {
  const issue = {
    id: "bench-scope-002", desk: "Maker Edition", issue: "BENCH", title: "Synthetic scope fixture",
    publishedAt: "2026-08-28T12:00:00.000Z", expires: "2027-08-28", scope: "VS-Bench",
    claims: [{
      id: "SCOPE-02",
      claim: "The synthetic notice appears only for new subscribed issues.",
      status: "verified",
      source: 0,
      relationships: [
        { type: "narrows", target_id: "bench-scope-001:SCOPE-01", reason: "The newer claim adds a new-issue boundary." },
        { type: "replaces", target_id: "bench-old-001:OLD-01", reason: "The old fixture was retired." },
      ],
    }],
    sources: [{ name: "VS-Bench fixture", publisher: "Velvet Signal", url: "https://example.test", checked: "2026-08-28" }],
    toneNotes: ["Synthetic fixture only."],
  };
  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
  assert.equal(patch.published_at, "2026-08-28T12:00:00.000Z");
  assert.equal(patch.claims[0].relationships.length, 2);
  assert.deepEqual(patch.claims[0].supersedes, ["bench-old-001:OLD-01"]);
});

test("expiry deactivates context without invalidating historical provenance", async () => {
  const catalog = await listIssues();
  const issue = catalog.issues.find((candidate) => candidate.id === "culture-001");
  assert(issue);
  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
  const receipt = createDeliveryReceipt(patch, receiptOptions);
  const afterExpiry = verifyDeliveryReceipt(patch, receipt, { ...receiptOptions, now: () => new Date("2026-09-11T00:00:00.000Z") });
  assert.equal(afterExpiry.valid, true);
  assert.equal(afterExpiry.signature_valid, true);
  assert.equal(afterExpiry.content_hash_valid, true);
  assert.equal(afterExpiry.patch_active, false);
});

test("existing deployments can derive receipt signing from the server editor token", () => {
  const previousReceiptSecret = process.env.VELVET_RECEIPT_SECRET;
  const previousEditorToken = process.env.VELVET_EDITOR_TOKEN;
  delete process.env.VELVET_RECEIPT_SECRET;
  process.env.VELVET_EDITOR_TOKEN = "existing-render-editor-token-at-least-16";
  try { assert.equal(receiptSigningConfigured(), true); }
  finally {
    if (previousReceiptSecret === undefined) delete process.env.VELVET_RECEIPT_SECRET; else process.env.VELVET_RECEIPT_SECRET = previousReceiptSecret;
    if (previousEditorToken === undefined) delete process.env.VELVET_EDITOR_TOKEN; else process.env.VELVET_EDITOR_TOKEN = previousEditorToken;
  }
});
