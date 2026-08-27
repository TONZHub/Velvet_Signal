import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GitHubOidcError,
  verifyGitHubActionsOidc,
} from "../src/github-oidc.mjs";
import {
  requestRenderScout,
  waitForRenderDeployment,
} from "../src/request-scout.mjs";

const now = new Date("2026-08-27T12:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key" };

function identityToken(overrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: "test-key" };
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: "https://velvetsignal.lol/api/velvet/scout",
    iat: nowSeconds - 10,
    nbf: nowSeconds - 10,
    exp: nowSeconds + 300,
    repository: "TONZHub/Velvet_Signal",
    repository_id: "1348233751",
    ref: "refs/heads/main",
    workflow_ref:
      "TONZHub/Velvet_Signal/.github/workflows/refresh-editions.yml@refs/heads/main",
    runner_environment: "github-hosted",
    event_name: "workflow_dispatch",
    run_id: "42",
    actor: "TONZHub",
    ...overrides,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const material = `${encodedHeader}.${encodedClaims}`;
  const signature = sign("RSA-SHA256", Buffer.from(material), privateKey).toString(
    "base64url",
  );
  return `${material}.${signature}`;
}

test("accepts only the pinned GitHub Actions workflow identity", async () => {
  const identity = await verifyGitHubActionsOidc(identityToken(), {
    keys: [publicJwk],
    now: () => now,
  });
  assert.equal(identity.repository, "TONZHub/Velvet_Signal");
  assert.equal(identity.event_name, "workflow_dispatch");

  const pushIdentity = await verifyGitHubActionsOidc(
    identityToken({ event_name: "push" }),
    { keys: [publicJwk], now: () => now },
  );
  assert.equal(pushIdentity.event_name, "push");

  await assert.rejects(
    () =>
      verifyGitHubActionsOidc(identityToken({ repository: "someone/else" }), {
        keys: [publicJwk],
        now: () => now,
      }),
    GitHubOidcError,
  );
  await assert.rejects(
    () =>
      verifyGitHubActionsOidc(identityToken({ event_name: "pull_request" }), {
        keys: [publicJwk],
        now: () => now,
      }),
    GitHubOidcError,
  );
});

test("the Actions client writes Render's returned catalog without provider keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velvet-oidc-"));
  const outputPath = join(directory, "generated-issues.json");
  const catalog = {
    schema_version: 1,
    generated_at: "2026-08-27T12:00:00.000Z",
    desks: {},
    issues: [],
  };
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ value: "short-lived-github-jwt" }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({ changed: false, summary: { checked: [] }, catalog }),
      { status: 200 },
    );
  };
  try {
    const result = await requestRenderScout({
      scoutUrl: "https://velvetsignal.lol/api/velvet/scout",
      oidcRequestUrl: "https://actions.example.test/token?job=1",
      oidcRequestToken: "actions-request-token",
      outputPath,
      fetchImpl,
    });
    assert.equal(result.changed, false);
    assert.match(requests[0].url, /audience=https%3A%2F%2Fvelvetsignal\.lol/);
    assert.equal(requests[1].init.headers.Authorization, "Bearer short-lived-github-jwt");
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), catalog);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the Actions client waits for Render's exact Git commit", async () => {
  let checks = 0;
  let delays = 0;
  const fetchImpl = async () => {
    checks += 1;
    return new Response(
      JSON.stringify({
        deployment_commit: checks === 1 ? "older-commit" : "expected-commit",
      }),
      { status: 200 },
    );
  };
  const status = await waitForRenderDeployment({
    expectedCommit: "expected-commit",
    scoutUrl: "https://velvetsignal.lol/api/velvet/scout",
    deploymentAttempts: 3,
    fetchImpl,
    delayImpl: async () => {
      delays += 1;
    },
  });
  assert.equal(status.deployment_commit, "expected-commit");
  assert.equal(checks, 2);
  assert.equal(delays, 1);
});
