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
