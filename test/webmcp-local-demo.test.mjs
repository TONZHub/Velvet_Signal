import assert from "node:assert/strict";
import test from "node:test";
import { runLocalModelMcpDemo } from "../src/webmcp-local-demo.mjs";

test("a local-model tool request is executed through the discovered MCP contract", async () => {
  const calls = [];
  const traces = [];
  const client = {
    async listTools() {
      return {
        tools: [{
          name: "inspect_memory_patch",
          description: "Inspect a patch",
          inputSchema: {
            type: "object",
            properties: { patchId: { type: "string" } },
            required: ["patchId"],
          },
        }],
      };
    },
    async callTool(call) {
      calls.push(call);
      return {
        structuredContent: {
          patch_id: call.arguments.patchId,
          title: "Fixture patch",
        },
      };
    },
  };
  let turn = 0;
  const chat = async (messages, options) => {
    turn += 1;
    assert.equal(options.tools[0].function.name, "inspect_memory_patch");
    if (turn === 1) {
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            function: {
              name: "inspect_memory_patch",
              arguments: { patchId: "maker-012" },
            },
          }],
        },
      };
    }
    assert.equal(messages.at(-1).role, "tool");
    assert.match(messages.at(-1).content, /Fixture patch/);
    return { message: { role: "assistant", content: "I inspected maker-012." } };
  };

  const result = await runLocalModelMcpDemo({
    client,
    chat,
    model: "fixture",
    prompt: "Inspect maker-012",
    trace: (event) => traces.push(event),
  });

  assert.equal(result.answer, "I inspected maker-012.");
  assert.equal(result.callsMade, 1);
  assert.deepEqual(calls, [{
    name: "inspect_memory_patch",
    arguments: { patchId: "maker-012" },
  }]);
  assert.deepEqual(
    traces.map((event) => event.type),
    ["discovery", "tool_call", "tool_result"],
  );
});


