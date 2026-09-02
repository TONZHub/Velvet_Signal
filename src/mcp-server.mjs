import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import { velvetToolExecutors } from "./webmcp-tools.mjs";

const jsonObject = z.record(z.string(), z.unknown());

function createVelvetMcpServer() {
  const server = new McpServer(
    { name: "velvet-signal-webmcp-bridge", version: "1.0.0" },
    {
      instructions:
        "These are the server-side counterparts of Velvet Signal's browser WebMCP tools. Inspection is public. Applying a patch requires a signed delivery artifact; this server cannot grant or manufacture human consent.",
    },
  );

  server.registerTool(
    "list_velvet_signal_issues",
    {
      title: "List Velvet Signal issues",
      description:
        "List current Velvet Signal issues and their patch IDs, scopes, validity dates, and remote approval visibility.",
      inputSchema: z.object({
        desk: z.string().optional().describe(
          "Optional desk ID: model-watch, pantry, wellbeing, culture, maker, or your-people.",
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    velvetToolExecutors.list_velvet_signal_issues,
  );

  server.registerTool(
    "inspect_memory_patch",
    {
      title: "Inspect a memory patch",
      description:
        "Inspect the complete claims, provenance, handling rules, validity window, and consent boundary of a Velvet Signal memory patch. This does not apply or store the patch.",
      inputSchema: z.object({
        patchId: z.string().min(1).describe("The Velvet Signal patch ID."),
      }),
      annotations: { readOnlyHint: true },
    },
    velvetToolExecutors.inspect_memory_patch,
  );

  server.registerTool(
    "apply_memory_patch",
    {
      title: "Deliver an approved memory patch",
      description:
        "Deliver an exact Velvet Signal memory patch after verifying its signed, content-bound approval artifact. Without that artifact this returns awaiting_human_consent; the tool cannot approve a patch or rewrite hidden model memory.",
      inputSchema: z.object({
        patchId: z.string().min(1).describe("The Velvet Signal patch ID."),
        delivery: z.object({
          patch: jsonObject,
          receipt: jsonObject,
        }).optional().describe(
          "The exact signed patch-and-receipt artifact produced by an explicit human release flow.",
        ),
      }),
      annotations: { readOnlyHint: false },
    },
    velvetToolExecutors.apply_memory_patch,
  );

  server.registerTool(
    "verify_delivery_receipt",
    {
      title: "Verify a delivery receipt",
      description:
        "Verify that a delivered patch matches its Velvet Signal Ed25519 receipt and current canonical content, and report whether it is still active. This does not apply or store the patch.",
      inputSchema: z.object({
        patch: jsonObject.describe("The delivered Velvet Signal patch."),
        receipt: jsonObject.describe("Its signed Velvet Signal delivery receipt."),
      }),
      annotations: { readOnlyHint: true },
    },
    velvetToolExecutors.verify_delivery_receipt,
  );

  return server;
}

const handler = createMcpHandler(createVelvetMcpServer, {
  responseMode: "auto",
  onerror(error) {
    console.error("Velvet Signal MCP error", error);
  },
});
const nodeHandler = toNodeHandler(handler);

function configuredHostnames() {
  const values = new Set([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "velvetsignal.lol",
    "www.velvetsignal.lol",
  ]);
  for (const candidate of [
    process.env.RENDER_EXTERNAL_HOSTNAME,
    process.env.VELVET_PUBLIC_URL,
  ]) {
    if (!candidate) continue;
    try {
      values.add(new URL(candidate.includes("://") ? candidate : `https://${candidate}`).hostname);
    } catch {
      // Ignore malformed optional deployment configuration.
    }
  }
  return [...values];
}

export async function handleMcpRequest(request, response) {
  const hostnames = configuredHostnames();
  if (!hostHeaderValidation(hostnames)(request, response)) return;
  if (!originValidation(hostnames)(request, response)) return;
  await nodeHandler(request, response);
}

export { createVelvetMcpServer };

