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
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("serves the six-desk newsstand with security headers and first-class project links", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    const html = await response.text();
    assert.match(html, /Six desks/);
    assert.match(html, /Culture Desk/);
    assert.match(html, /Maker Edition/);
    assert.match(html, /Your People/);
    assert.match(html, /Updates since last visit/);
    assert.match(html, /velvet-signal\.visit\.v1/);
    assert.match(html, /data-show-updates/);
    assert.match(html, /Related, not repeated/);
    assert.match(html, /Why both matter/);
    assert.match(html, /relatedEditionDetails/);
    assert.match(html, /if \(!newIssueIds\.has\(issue\.id\)\) return null/);
    assert.match(html, /href="\/install">Install/);
    assert.match(html, /href="\/benchmark">VS-Bench/);
    assert.match(html, /Install on your laptop/);
    assert.match(html, /See VS-Bench/);
    assert.match(html, /href="https:\/\/ko-fi\.com\/mosslet"/);
    assert.match(html, /Support Velvet Signal on Ko-fi/);
    assert.match(html, /<th>Relationship<\/th>/);
  });
});

test("serves the Velvet Signal favicon", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/favicon.svg`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /image\/svg\+xml/);
    const svg = await response.text();
    assert.match(svg, /<title id="title">Velvet Signal<\/title>/);
    assert.match(svg, /#ff4f91/);
  });
});

test("serves the laptop installation guide as a first-class page", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/install`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /<title>Install Velvet Signal<\/title>/);
    assert.match(html, /Install Velvet Signal\s*<em>locally\.<\/em>/);
    assert.match(html, /ollama pull embeddinggemma/);
    assert.match(html, /npm\.cmd run local -- release pantry-003/);
    assert.match(html, /Windows troubleshooting/);
  });
});

test("serves VS-Bench as a first-class cross-model evidence page", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/benchmark`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /Did the model merely read the patch/);
    assert.match(html, /Hermes 4 405B/);
    assert.match(html, /o3/);
    assert.match(html, /Gemma 3 12B/);
    assert.match(html, /MythoMax 13B/);
    assert.match(html, /Evidence realization/);
    assert.match(html, /Provenance entailment/);
    assert.match(html, /Provenance type accuracy/);
    assert.match(html, /Uncertainty retention/);
    assert.match(html, /False temporal attribution/);
    assert.match(html, /Expiry awareness/);
    assert.match(html, /No resurrection/);
    assert.match(html, /Dolphin 3:8B/);
    assert.match(html, /Qwen3 4B Instruct/);
    assert.match(html, /11\/11/);
    assert.match(html, /6\/8/);
    assert.match(html, /Who won the 1998 World Cup/);
    assert.match(html, /Outside current Velvet Signal context/);
    assert.match(html, /Historical update gap/);
    assert.match(html, /bench:governance/);
  });
});

test("reports the pinned editor model without exposing secrets", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/velvet/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.model, "z-ai/glm-5.3-flash");
    assert.deepEqual(status.desks, ["model-watch", "pantry", "wellbeing", "culture", "maker", "your-people"]);
    assert.deepEqual(status.scout_desks, ["model-watch", "pantry", "wellbeing", "culture", "maker"]);
    assert.equal(status.scout_mode, "github-actions-oidc-to-render");
    assert.equal(status.scout_provider_keys, "render-only");
    assert.equal("deployment_commit" in status, true);
    assert.equal("api_key" in status, false);
  });
});

test("the Render scout endpoint rejects requests without GitHub OIDC", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/velvet/scout`, { method: "POST" });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  });
});

test("serves the canonical issue catalog", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/velvet/issues`);
    assert.equal(response.status, 200);
    const catalog = await response.json();
    assert.equal(catalog.issues.length >= 6, true);
    assert.equal(catalog.issues.some((issue) => issue.id === "culture-001"), true);
    assert.deepEqual(catalog.private_desks, ["your-people"]);
    assert.equal(catalog.scout_desks.includes("your-people"), false);
  });
});

test("releases canonical patches with verifiable content-bound receipts", async () => {
  const previousSecret = process.env.VELVET_RECEIPT_SECRET;
  process.env.VELVET_RECEIPT_SECRET = "test-receipt-secret-at-least-16-characters";
  try {
    await withServer(async (baseUrl) => {
      const release = await fetch(`${baseUrl}/api/velvet/release`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch_id: "culture-001" }) });
      assert.equal(release.status, 201);
      const delivery = await release.json();
      assert.equal(delivery.delivered, true);
      assert.equal(delivery.patch.delivery.status, "delivered");
      assert.equal(delivery.patch.delivery.approved, true);
      assert.equal(delivery.patch.editorial_provenance.role, "informational origin metadata only");
      assert.equal("composition" in delivery.patch, false);
      assert.equal(delivery.receipt.algorithm, "Ed25519");
      assert.match(delivery.receipt.content_sha256, /^[a-f0-9]{64}$/);

      const verify = await fetch(`${baseUrl}/api/velvet/verify-receipt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch: delivery.patch, receipt: delivery.receipt }) });
      assert.equal(verify.status, 200);
      const verified = await verify.json();
      assert.equal(verified.valid, true);
      assert.equal(verified.signature_valid, true);
      assert.equal(verified.content_hash_valid, true);

      const tampered = structuredClone(delivery.patch); tampered.title = "Tampered";
      const reject = await fetch(`${baseUrl}/api/velvet/verify-receipt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch: tampered, receipt: delivery.receipt }) });
      const rejected = await reject.json();
      assert.equal(rejected.valid, false);
      assert.equal(rejected.content_hash_valid, false);

      const key = await fetch(`${baseUrl}/api/velvet/receipt-key`);
      assert.equal(key.status, 200);
      const publicKey = await key.json();
      assert.equal(publicKey.key_id, delivery.receipt.key_id);
      assert.equal(publicKey.public_key_jwk.kty, "OKP");
      assert.equal("d" in publicKey.public_key_jwk, false);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.VELVET_RECEIPT_SECRET; else process.env.VELVET_RECEIPT_SECRET = previousSecret;
  }
});

test("compose remains closed until server-side secrets are configured", async () => {
  const previousEditorToken = process.env.VELVET_EDITOR_TOKEN;
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  delete process.env.VELVET_EDITOR_TOKEN; delete process.env.OPENROUTER_API_KEY;
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/velvet/compose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ desk: "culture", sources: [] }) });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "editor_auth_not_configured");
    });
  } finally {
    if (previousEditorToken === undefined) delete process.env.VELVET_EDITOR_TOKEN; else process.env.VELVET_EDITOR_TOKEN = previousEditorToken;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
});
