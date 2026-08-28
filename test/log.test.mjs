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

test("homepage exposes the Signal Log as a first-class destination", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /href="\/log">Log</);
    assert.match(html, /Read the Signal Log/);
  });
});

test("serves the Signal Log website page", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/log`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /The <em>Signal Log\.<\/em>/);
    assert.match(html, /data-kind="benchmark"/);
    assert.match(html, /fetch\('\/api\/velvet\/log'\)/);
  });
});

test("serves a machine-readable chronological product log", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/velvet/log`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const log = await response.json();
    assert.equal(log.schema_version, 1);
    assert.equal(Array.isArray(log.entries), true);
    assert.equal(log.entries.length >= 7, true);
    assert.equal(log.entries[0].date >= log.entries.at(-1).date, true);
    assert.equal(log.entries.some((entry) => entry.kind === "benchmark"), true);
    assert.equal(log.entries.some((entry) => entry.kind === "publication"), true);
    assert.equal(log.entries.some((entry) => entry.id === "2026-08-28-local-rag-merged"), true);
    assert.equal(log.entries.some((entry) => entry.id === "2026-08-28-relationship-aware-rag"), true);
  });
});
