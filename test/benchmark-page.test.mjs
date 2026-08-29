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

test("VS-Bench page exposes the completed Dolphin A/B proof and saved-run workflow", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/benchmark`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /11\/11/);
    assert.match(html, /6\/8/);
    assert.match(html, /Five-day chicken/);
    assert.match(html, /Maker Edition/);
    assert.match(html, /Historical update gap/);
    assert.match(html, /caught a real retrieval bug/i);
    assert.match(html, /no-current-context/);
    assert.match(html, /bench:save/);
    assert.match(html, /Retrieval correctness and generation adherence are scored separately/i);
  });
});
