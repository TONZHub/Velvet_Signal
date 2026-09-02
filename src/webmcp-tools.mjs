import { createHash } from "node:crypto";
import { findIssue, listIssues } from "./catalog.mjs";
import { canonicalJson, patchForIssue } from "./patch.mjs";
import { verifyDeliveryReceipt } from "./receipts.mjs";

function patchContentHash(patch) {
  return createHash("sha256").update(canonicalJson(patch)).digest("hex");
}

function response(data, options = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    ...(options.isError ? { isError: true } : {}),
  };
}

export async function verifyCanonicalDelivery(patch, receipt) {
  const result = verifyDeliveryReceipt(patch, receipt);
  const patchId = typeof receipt?.patch_id === "string"
    ? receipt.patch_id
    : null;
  const issue = patchId ? await findIssue(patchId) : null;
  const canonicalPatch = issue
    ? patchForIssue(issue, { deliveryStatus: "delivered" })
    : null;
  const canonicalContentValid = Boolean(
    canonicalPatch &&
    typeof receipt?.content_sha256 === "string" &&
    receipt.content_sha256 === patchContentHash(canonicalPatch),
  );
  const valid = result.valid && canonicalContentValid;
  return {
    ...result,
    valid,
    canonical_content_valid: canonicalContentValid,
    patch_active: result.patch_active && canonicalContentValid,
    reason: valid
      ? null
      : canonicalContentValid
        ? result.reason
        : "The signed receipt is historical and no longer matches the current canonical patch.",
  };
}

export async function listVelvetSignalIssues({ desk } = {}) {
  const catalog = await listIssues();
  return {
    publication: "Velvet Signal",
    transport: "mcp-over-http",
    approval_visibility:
      "Browser approvals remain in that browser. This endpoint reports them as unknown and cannot approve a patch.",
    issues: catalog.issues
      .filter((issue) => !desk || issue.deskId === desk)
      .map((issue) => ({
        patch_id: issue.id,
        desk: issue.desk,
        title: issue.title,
        version: issue.version ?? "1.0.0",
        valid_until: issue.expires,
        scope: issue.scope,
        human_approved: null,
        approval_status: "unknown_to_remote_bridge",
        editor_model: issue.editor ? "z-ai/glm-5.3-flash" : null,
        input_policy: issue.inputPolicy ?? "curated launch issue",
      })),
  };
}

export async function inspectMemoryPatch({ patchId }) {
  const issue = await findIssue(patchId);
  if (!issue) {
    const catalog = await listIssues();
    return {
      error: "Unknown patch ID",
      available: catalog.issues.map((item) => item.id),
    };
  }
  return {
    ...patchForIssue(issue),
    transport_consent: {
      status: "locked",
      rule:
        "The remote MCP bridge can inspect this patch but cannot approve it. Activation requires a signed delivery artifact from an explicit release flow.",
    },
  };
}

export async function applyMemoryPatch({ patchId, delivery } = {}) {
  const issue = await findIssue(patchId);
  if (!issue) {
    return {
      error: "Unknown patch ID",
      delivered: false,
      patch_id: patchId,
    };
  }
  if (!delivery?.patch || !delivery?.receipt) {
    return {
      status: "awaiting_human_consent",
      delivered: false,
      patch_id: patchId,
      reason:
        "The MCP bridge does not mint approval. Supply the signed delivery artifact created by an explicit human release flow.",
      next_step:
        `Ask the person to inspect and release ${patchId}, then pass that exact patch-and-receipt artifact with the next call.`,
      agent_must_not:
        "Do not retry in a loop, fabricate a receipt, or treat this status as approval.",
    };
  }
  if (
    delivery.patch.patch_id !== patchId ||
    delivery.receipt.patch_id !== patchId
  ) {
    return {
      status: "invalid_delivery",
      delivered: false,
      patch_id: patchId,
      reason: "The supplied patch or receipt belongs to a different patch ID.",
    };
  }
  const verification = await verifyCanonicalDelivery(
    delivery.patch,
    delivery.receipt,
  );
  if (!verification.valid || !verification.patch_active) {
    return {
      status: verification.valid ? "expired_delivery" : "invalid_delivery",
      delivered: false,
      patch_id: patchId,
      verification,
      reason: verification.valid
        ? "The signed delivery is no longer active."
        : verification.reason,
    };
  }
  return {
    delivered: true,
    status: "delivered",
    patch: delivery.patch,
    receipt: delivery.receipt,
    verification,
  };
}

export async function verifyMemoryPatchDelivery({ patch, receipt } = {}) {
  return {
    patch_id: receipt?.patch_id ?? patch?.patch_id ?? null,
    ...(await verifyCanonicalDelivery(patch, receipt)),
  };
}

export const velvetToolExecutors = {
  list_velvet_signal_issues: async (args) => response(await listVelvetSignalIssues(args)),
  inspect_memory_patch: async (args) => response(await inspectMemoryPatch(args)),
  apply_memory_patch: async (args) => response(await applyMemoryPatch(args)),
  verify_delivery_receipt: async (args) => response(await verifyMemoryPatchDelivery(args)),
};

