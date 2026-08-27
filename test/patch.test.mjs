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

test("expiry deactivates context without invalidating historical provenance", async () => {
  const catalog = await listIssues();
  const issue = catalog.issues.find((candidate) => candidate.id === "culture-001");
  assert(issue);

  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
  const receipt = createDeliveryReceipt(patch, receiptOptions);
  const afterExpiry = verifyDeliveryReceipt(patch, receipt, {
    ...receiptOptions,
    now: () => new Date("2026-09-11T00:00:00.000Z"),
  });

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
  try {
    assert.equal(receiptSigningConfigured(), true);
  } finally {
    if (previousReceiptSecret === undefined) delete process.env.VELVET_RECEIPT_SECRET;
    else process.env.VELVET_RECEIPT_SECRET = previousReceiptSecret;
    if (previousEditorToken === undefined) delete process.env.VELVET_EDITOR_TOKEN;
    else process.env.VELVET_EDITOR_TOKEN = previousEditorToken;
  }
});
