import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { findIssue } from "../src/catalog.mjs";
import { patchForIssue } from "../src/patch.mjs";
import { createDeliveryReceipt } from "../src/receipts.mjs";
import { createVelvetServer } from "../src/server.mjs";

async function withMcpClient(run) {
  const server = createVelvetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "velvet-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
  );
  try {
    await run(client, baseUrl);
  } finally {
    await client.close();
    server.close();
    await once(server, "close");
  }
}

test("the HTTP MCP endpoint exposes the four WebMCP counterparts", async () => {
  await withMcpClient(async (client) => {
    const listing = await client.listTools();
    assert.deepEqual(
      listing.tools.map((tool) => tool.name),
      [
        "list_velvet_signal_issues",
        "inspect_memory_patch",
        "apply_memory_patch",
        "verify_delivery_receipt",
      ],
    );
    assert.equal(listing.tools[0].annotations.readOnlyHint, true);

    const issues = await client.callTool({
      name: "list_velvet_signal_issues",
      arguments: { desk: "maker" },
    });
    assert.equal(issues.isError, undefined);
    assert.equal(issues.structuredContent.transport, "mcp-over-http");
    assert.equal(
      issues.structuredContent.issues.every((issue) => issue.human_approved === null),
      true,
    );

    const inspected = await client.callTool({
      name: "inspect_memory_patch",
      arguments: { patchId: "maker-012" },
    });
    assert.equal(inspected.structuredContent.patch_id, "maker-012");
    assert.equal(inspected.structuredContent.delivery.approved, false);
    assert.equal(inspected.structuredContent.transport_consent.status, "locked");
  });
});

test("the MCP apply tool cannot manufacture approval", async () => {
  await withMcpClient(async (client) => {
    const result = await client.callTool({
      name: "apply_memory_patch",
      arguments: { patchId: "maker-012" },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.delivered, false);
    assert.equal(result.structuredContent.status, "awaiting_human_consent");
    assert.match(result.structuredContent.reason, /does not mint approval/);
  });
});

test("the MCP apply tool accepts only a signed current delivery artifact", async () => {
  const previousSecret = process.env.VELVET_RECEIPT_SECRET;
  process.env.VELVET_RECEIPT_SECRET = "test-receipt-secret-at-least-16-characters";
  try {
    const issue = await findIssue("maker-012");
    const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
    const receipt = createDeliveryReceipt(patch);
    await withMcpClient(async (client) => {
      const accepted = await client.callTool({
        name: "apply_memory_patch",
        arguments: {
          patchId: "maker-012",
          delivery: { patch, receipt },
        },
      });
      assert.equal(accepted.structuredContent.delivered, true);
      assert.equal(accepted.structuredContent.verification.valid, true);

      const tampered = structuredClone(patch);
      tampered.title = "Tampered";
      const rejected = await client.callTool({
        name: "apply_memory_patch",
        arguments: {
          patchId: "maker-012",
          delivery: { patch: tampered, receipt },
        },
      });
      assert.equal(rejected.structuredContent.delivered, false);
      assert.equal(rejected.structuredContent.status, "invalid_delivery");
    });
  } finally {
    if (previousSecret === undefined) delete process.env.VELVET_RECEIPT_SECRET;
    else process.env.VELVET_RECEIPT_SECRET = previousSecret;
  }
});

test("the MCP endpoint rejects a cross-site browser origin", async () => {
  const server = createVelvetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      headers: { origin: "https://untrusted.example" },
    });
    assert.equal(response.status, 403);
  } finally {
    server.close();
    await once(server, "close");
  }
});


