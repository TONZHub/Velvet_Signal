import assert from "node:assert/strict";
import test from "node:test";
import { ollamaChat } from "../src/ollama.mjs";

test("chat requests cap Ollama context instead of inheriting a model's huge window", async () => {
  let body;
  const fetchImpl = async (_url, request) => {
    body = JSON.parse(request.body);
    return new Response(JSON.stringify({ message: { content: "ok" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await ollamaChat([{ role: "user", content: "hello" }], {
    model: "fixture",
    fetchImpl,
  });

  assert.equal(result.content, "ok");
  assert.equal(body.options.num_ctx, 8192);
});

test("chat context can be overridden explicitly for larger or smaller local machines", async () => {
  let body;
  const fetchImpl = async (_url, request) => {
    body = JSON.parse(request.body);
    return new Response(JSON.stringify({ message: { content: "ok" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await ollamaChat([{ role: "user", content: "hello" }], {
    model: "fixture",
    numCtx: 4096,
    fetchImpl,
  });

  assert.equal(body.options.num_ctx, 4096);
});

test("chat forwards MCP-derived tools and accepts a tool-call-only turn", async () => {
  let body;
  const fetchImpl = async (_url, request) => {
    body = JSON.parse(request.body);
    return new Response(JSON.stringify({
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
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const tools = [{
    type: "function",
    function: {
      name: "inspect_memory_patch",
      description: "Inspect a patch",
      parameters: { type: "object", properties: {} },
    },
  }];

  const result = await ollamaChat([{ role: "user", content: "inspect" }], {
    model: "fixture",
    tools,
    fetchImpl,
  });

  assert.deepEqual(body.tools, tools);
  assert.equal(result.message.tool_calls[0].function.name, "inspect_memory_patch");
});

