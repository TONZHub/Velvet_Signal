import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createVelvetServer } from "../src/server.mjs";

async function withServer(run) {
  const server = createVelvetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("serves the six-issue newsstand with security headers", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /frame-ancestors 'none'/,
    );
    const html = await response.text();
    assert.match(html, /Six desks/);
    assert.match(html, /Culture Desk/);
    assert.match(html, /Maker Edition/);
    assert.match(html, /Your People/);
  });
});

test("reports the pinned editor model without exposing secrets", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/velvet/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.model, "z-ai/glm-5.3-flash");
    assert.deepEqual(status.desks, ["culture", "maker", "your-people"]);
    assert.equal("api_key" in status, false);
  });
});

test("compose remains closed until server-side secrets are configured", async () => {
  const previousEditorToken = process.env.VELVET_EDITOR_TOKEN;
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  delete process.env.VELVET_EDITOR_TOKEN;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/velvet/compose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desk: "culture", sources: [] }),
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "editor_auth_not_configured");
    });
  } finally {
    if (previousEditorToken === undefined)
      delete process.env.VELVET_EDITOR_TOKEN;
    else process.env.VELVET_EDITOR_TOKEN = previousEditorToken;
    if (previousOpenRouterKey === undefined)
      delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
});
