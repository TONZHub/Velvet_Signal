import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LAUNCH_ISSUES } from "../src/launch-issues.mjs";
import { patchForIssue } from "../src/patch.mjs";

const execFileAsync = promisify(execFile);
const TEST_ISSUE = {
  ...LAUNCH_ISSUES[0],
  id: "test-current-001",
  title: "Test current patch",
  publishedAt: "2026-08-31",
  expires: "2099-12-31",
};

async function withCatalogServer(handler) {
  const releaseRequests = [];
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/api/velvet/issues") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ issues: [TEST_ISSUE] }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/velvet/release") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        releaseRequests.push(body.patch_id);
        if (body.patch_id !== TEST_ISSUE.id) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "unknown_patch" }));
          return;
        }
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          delivered: true,
          patch: patchForIssue(TEST_ISSUE, { deliveryStatus: "delivered" }),
          receipt: { test: true, patch_id: TEST_ISSUE.id },
        }));
      });
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
    await handler(url, releaseRequests);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function cliEnv(publicUrl, store) {
  return {
    ...process.env,
    VELVET_PUBLIC_URL: publicUrl,
    VELVET_LOCAL_STORE: store,
  };
}

async function runCli(publicUrl, store, ...args) {
  return execFileAsync(
    process.execPath,
    [resolve("src/local-agent.mjs"), ...args],
    { env: cliEnv(publicUrl, store) },
  );
}

test("download-all acquires every catalog patch without releasing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velvet-download-all-"));
  const store = join(directory, "patches.json");

  try {
    await withCatalogServer(async (publicUrl) => {
      const { stdout } = await runCli(publicUrl, store, "download-all");

      assert.match(stdout, /Fetched 1 published Velvet Signal patch\(es\)\./);
      assert.match(stdout, /remain locked until you explicitly run release/);

      const saved = JSON.parse(await readFile(store, "utf8"));
      assert.equal(saved.schema_version, 2);
      assert.equal(saved.downloads.length, 1);
      assert.equal(saved.releases.length, 0);
      assert.equal(saved.downloads[0].patch.patch_id, TEST_ISSUE.id);
      assert.equal(saved.downloads[0].patch.delivery.status, "locked");
      assert.equal(saved.downloads[0].patch.delivery.approved, false);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release-all requires an explicit confirmation flag", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velvet-release-all-gate-"));
  const store = join(directory, "patches.json");

  try {
    await withCatalogServer(async (publicUrl, releaseRequests) => {
      await runCli(publicUrl, store, "download-all");
      await assert.rejects(
        runCli(publicUrl, store, "release-all"),
        (error) => {
          assert.match(error.stderr, /Re-run with: npm run local -- release-all --confirm/);
          return true;
        },
      );
      assert.deepEqual(releaseRequests, []);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release-all --confirm activates every current downloaded patch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velvet-release-all-"));
  const store = join(directory, "patches.json");

  try {
    await withCatalogServer(async (publicUrl, releaseRequests) => {
      await runCli(publicUrl, store, "download-all");
      const { stdout } = await runCli(publicUrl, store, "release-all", "--confirm");

      assert.match(stdout, new RegExp(`released\\t${TEST_ISSUE.id}\\t`));
      assert.match(stdout, /Release-all summary: 1 activated, 0 already active, 0 expired\/historical skipped, 0 failed\./);
      assert.deepEqual(releaseRequests, [TEST_ISSUE.id]);

      const saved = JSON.parse(await readFile(store, "utf8"));
      assert.equal(saved.downloads.length, 1);
      assert.equal(saved.releases.length, 1);
      assert.equal(saved.releases[0].patch.patch_id, TEST_ISSUE.id);
      assert.equal(saved.releases[0].patch.delivery.status, "delivered");
      assert.equal(saved.releases[0].patch.delivery.approved, true);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
