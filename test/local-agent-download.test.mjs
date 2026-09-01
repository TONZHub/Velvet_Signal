import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LAUNCH_ISSUES } from "../src/launch-issues.mjs";

const execFileAsync = promisify(execFile);

async function withCatalogServer(handler) {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/api/velvet/issues") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ issues: [LAUNCH_ISSUES[0]] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  try {
    await handler(url);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

test("download-all acquires every catalog patch without releasing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velvet-download-all-"));
  const store = join(directory, "patches.json");

  try {
    await withCatalogServer(async (publicUrl) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [resolve("src/local-agent.mjs"), "download-all"],
        {
          env: {
            ...process.env,
            VELVET_PUBLIC_URL: publicUrl,
            VELVET_LOCAL_STORE: store,
          },
        },
      );

      assert.match(stdout, /Fetched 1 published Velvet Signal patch\(es\)\./);
      assert.match(stdout, /remain locked until you explicitly run release/);

      const saved = JSON.parse(await readFile(store, "utf8"));
      assert.equal(saved.schema_version, 2);
      assert.equal(saved.downloads.length, 1);
      assert.equal(saved.releases.length, 0);
      assert.equal(saved.downloads[0].patch.patch_id, LAUNCH_ISSUES[0].id);
      assert.equal(saved.downloads[0].patch.delivery.status, "locked");
      assert.equal(saved.downloads[0].patch.delivery.approved, false);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
