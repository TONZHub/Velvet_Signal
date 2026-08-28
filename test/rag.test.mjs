import assert from "node:assert/strict";
import test from "node:test";
import { formatRetrievedContext, injectRetrievedContext, patchIsActive, resolveClaimRelationships, retrieveClaims } from "../src/rag.mjs";

function patch(overrides = {}) {
  return {
    patch_id: "pantry-003", desk: "The Pantry", title: "The Leftover Ledger", scope: "Food safety", published_at: "2026-08-28", valid_until: "2027-08-28",
    delivery: { status: "delivered", approved: true },
    claims: [
      { id: "P-06", statement: "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.", status: "verified", source_ids: ["P-SRC-1"] },
      { id: "P-08", statement: "Do not rely on smell or taste to decide whether food stored too long is safe; discard it when unsure.", status: "verified", source_ids: ["P-SRC-1"] },
      { id: "P-02", statement: "Perishable foods left at room temperature longer than 2 hours should be discarded.", status: "verified", source_ids: ["P-SRC-1"] },
      { id: "P-07", statement: "Fresh fish can be refrigerated for 1 to 2 days.", status: "verified", source_ids: ["P-SRC-1"] },
    ],
    sources: [{ id: "P-SRC-1", publisher: "USDA FSIS", url: "https://example.test/usda" }], ...overrides,
  };
}
function benchmarkPatch({ patchId, publishedAt, claimId, statement, relationships = [], supersedes = [], validUntil = "2027-08-28" }) {
  return { patch_id: patchId, desk: "Maker Edition", title: "Synthetic relationship fixture", scope: "VS-Bench synthetic fixture", published_at: publishedAt, valid_until: validUntil, delivery: { status: "delivered", approved: true }, claims: [{ id: claimId, statement, status: "verified", source_ids: ["BENCH-SRC-1"], ...(relationships.length ? { relationships } : {}), ...(supersedes.length ? { supersedes } : {}) }], sources: [{ id: "BENCH-SRC-1", publisher: "VS-Bench", url: "https://example.test/fixture" }] };
}

test("only delivered, approved, unexpired patches are active", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  assert.equal(patchIsActive(patch(), now), true);
  assert.equal(patchIsActive(patch({ delivery: { status: "locked", approved: false } }), now), false);
  assert.equal(patchIsActive(patch({ valid_until: "2026-08-27" }), now), false);
});

test("lexical retrieval finds the cooked-leftover rule", async () => {
  const result = await retrieveClaims("I cooked chicken five days ago and kept it refrigerated. Can I eat it?", [patch()], { now: new Date("2026-08-28T12:00:00Z"), limit: 2 });
  assert.equal(result.mode, "lexical"); assert.equal(result.results[0].claim_id, "P-06");
});

test("retrieval defaults to a focused three-claim context", async () => {
  const result = await retrieveClaims("leftover food safety", [patch()], { now: new Date("2026-08-28T12:00:00Z") });
  assert.equal(result.results.length, 3);
});

test("active superseding claims remove replaced claims before ranking", async () => {
  const oldPatch = benchmarkPatch({ patchId: "bench-shape-001", publishedAt: "2026-08-20", claimId: "SHAPE-01", statement: "The synthetic demo badge uses a square icon." });
  const newPatch = benchmarkPatch({ patchId: "bench-shape-002", publishedAt: "2026-08-28", claimId: "SHAPE-02", statement: "The synthetic demo badge uses a circle icon.", supersedes: ["bench-shape-001:SHAPE-01"] });
  const result = await retrieveClaims("What shape does the synthetic demo badge use?", [oldPatch, newPatch], { now: new Date("2026-08-28T12:00:00Z"), limit: 5 });
  assert.equal(result.results.some((item) => item.id === "bench-shape-001:SHAPE-01"), false);
  assert.equal(result.results[0].id, "bench-shape-002:SHAPE-02");
  assert.deepEqual(result.results[0].supersedes, ["bench-shape-001:SHAPE-01"]);
  assert.equal(result.resolution.decisions[0].type, "replaces");
  assert.equal(result.resolution.decisions[0].action, "target_withheld");
  assert.equal(result.resolution.history[0].id, "bench-shape-001:SHAPE-01");
  assert.match(result.resolution.history[0].history_reason, /^replaces_by:/);
});

test("narrowing preserves both claims and explains scoped precedence", async () => {
  const broad = benchmarkPatch({ patchId: "bench-alert-001", publishedAt: "2026-08-20", claimId: "ALERT-01", statement: "The synthetic demo shows update alerts to subscribers." });
  const narrow = benchmarkPatch({ patchId: "bench-alert-002", publishedAt: "2026-08-28", claimId: "ALERT-02", statement: "The synthetic demo shows update alerts only for subscribed desks with new issues.", relationships: [{ type: "narrows", target_id: "bench-alert-001:ALERT-01", reason: "The newer fixture adds the new-issue boundary." }] });
  const result = await retrieveClaims("When are update alerts shown to subscribers?", [broad, narrow], { now: new Date("2026-08-28T12:00:00Z"), limit: 5 });
  assert.equal(result.results.some((item) => item.id === "bench-alert-001:ALERT-01"), true);
  assert.equal(result.results.some((item) => item.id === "bench-alert-002:ALERT-02"), true);
  assert.equal(result.resolution.decisions[0].action, "both_active");
  assert.equal(result.resolution.history.length, 0);
  assert.match(formatRetrievedContext(result), /NARROWS \| bench-alert-002:ALERT-02 -> bench-alert-001:ALERT-01/);
  assert.match(formatRetrievedContext(result), /newer, more specific claim controls/);
});

test("confirmation keeps both independently sourced claims active", () => {
  const original = benchmarkPatch({ patchId: "bench-dot-001", publishedAt: "2026-08-20", claimId: "DOT-01", statement: "The synthetic ready indicator is green." });
  const confirmation = benchmarkPatch({ patchId: "bench-dot-002", publishedAt: "2026-08-28", claimId: "DOT-02", statement: "The synthetic fixture independently confirms a green ready indicator.", relationships: [{ type: "confirms", target_id: "bench-dot-001:DOT-01", reason: "A second fixture reports the same indicator state." }] });
  const resolution = resolveClaimRelationships([original, confirmation], { now: new Date("2026-08-28T12:00:00Z") });
  assert.deepEqual(resolution.active.map((item) => item.id).sort(), ["bench-dot-001:DOT-01", "bench-dot-002:DOT-02"]);
  assert.equal(resolution.decisions[0].type, "confirms");
  assert.equal(resolution.decisions[0].action, "both_active");
});

test("an explicit conflict prefers the newer claim and retains the older one as history", () => {
  const oldPatch = benchmarkPatch({ patchId: "bench-mode-001", publishedAt: "2026-08-20", claimId: "MODE-01", statement: "The synthetic demo defaults to compact mode." });
  const newPatch = benchmarkPatch({ patchId: "bench-mode-002", publishedAt: "2026-08-28", claimId: "MODE-02", statement: "The synthetic demo defaults to expanded mode.", relationships: [{ type: "conflicts", target_id: "bench-mode-001:MODE-01", reason: "The two defaults cannot both control the same version." }] });
  const resolution = resolveClaimRelationships([oldPatch, newPatch], { now: new Date("2026-08-28T12:00:00Z") });
  assert.deepEqual(resolution.active.map((item) => item.id), ["bench-mode-002:MODE-02"]);
  assert.equal(resolution.history[0].id, "bench-mode-001:MODE-01");
  assert.equal(resolution.decisions[0].type, "conflicts");
});

test("historical wording can retrieve its active replacement without being injected as active context", async () => {
  const oldPatch = benchmarkPatch({ patchId: "bench-name-001", publishedAt: "2026-08-20", claimId: "NAME-01", statement: "The synthetic feature used the codename marigold." });
  const newPatch = benchmarkPatch({ patchId: "bench-name-002", publishedAt: "2026-08-28", claimId: "NAME-02", statement: "The synthetic feature is now called violet signal.", relationships: [{ type: "replaces", target_id: "bench-name-001:NAME-01", reason: "The public name replaced the old codename." }] });
  const result = await retrieveClaims("What happened to marigold?", [oldPatch, newPatch], { now: new Date("2026-08-28T12:00:00Z"), limit: 2 });
  assert.equal(result.results[0].id, "bench-name-002:NAME-02");
  const context = formatRetrievedContext(result);
  assert.match(context, /The synthetic feature is now called violet signal/);
  assert.doesNotMatch(context, /used the codename marigold/);
  assert.match(context, /bench-name-001:NAME-01/);
});

test("expired relationship targets remain inspectable history without becoming active", () => {
  const expired = benchmarkPatch({ patchId: "bench-expiry-001", publishedAt: "2026-08-20", claimId: "EXP-01", statement: "The synthetic banner is amber.", validUntil: "2026-08-21" });
  const replacement = benchmarkPatch({ patchId: "bench-expiry-002", publishedAt: "2026-08-28", claimId: "EXP-02", statement: "The synthetic banner is violet.", relationships: [{ type: "replaces", target_id: "bench-expiry-001:EXP-01", reason: "The newer fixture changes the banner color." }] });
  const resolution = resolveClaimRelationships([expired, replacement], { now: new Date("2026-08-28T12:00:00Z") });
  assert.deepEqual(resolution.active.map((item) => item.id), ["bench-expiry-002:EXP-02"]);
  assert.equal(resolution.decisions[0].action, "target_already_history");
  assert.equal(resolution.history[0].inactive_reason, "patch_expired_or_ineligible");
});

test("an expired replacement leaves a tombstone instead of resurrecting stale guidance", async () => {
  const oldPatch = benchmarkPatch({ patchId: "bench-tombstone-001", publishedAt: "2026-08-20", claimId: "TOMB-01", statement: "The synthetic policy uses revision one.", validUntil: "2027-08-28" });
  const expiredReplacement = benchmarkPatch({ patchId: "bench-tombstone-002", publishedAt: "2026-08-27", claimId: "TOMB-02", statement: "The synthetic policy uses revision two.", validUntil: "2026-08-27", relationships: [{ type: "replaces", target_id: "bench-tombstone-001:TOMB-01", reason: "Revision two replaced revision one." }] });
  const resolution = resolveClaimRelationships([oldPatch, expiredReplacement], { now: new Date("2026-08-28T12:00:00Z") });
  assert.equal(resolution.active.length, 0);
  assert.equal(resolution.decisions[0].action, "target_withheld_by_historical_tombstone");
  assert.match(resolution.decisions[0].explanation, /Neither statement is active/);
  assert.deepEqual(resolution.history.map((item) => item.id).sort(), ["bench-tombstone-001:TOMB-01", "bench-tombstone-002:TOMB-02"]);
  const retrieval = await retrieveClaims("Which synthetic policy uses revision one?", [oldPatch, expiredReplacement], { now: new Date("2026-08-28T12:00:00Z") });
  assert.equal(retrieval.mode, "lexical-relationship-only");
  assert.equal(retrieval.results.length, 0);
  const context = formatRetrievedContext(retrieval);
  assert.match(context, /No active publication claim remains/);
  assert.match(context, /target_withheld_by_historical_tombstone/);
  assert.doesNotMatch(context, /synthetic policy uses revision one/);
  assert.doesNotMatch(context, /synthetic policy uses revision two/);
});

test("a withdrawn relationship source cannot suppress an approved active claim", () => {
  const target = benchmarkPatch({ patchId: "bench-withdraw-001", publishedAt: "2026-08-20", claimId: "WITH-01", statement: "The synthetic policy remains active." });
  const withdrawn = benchmarkPatch({ patchId: "bench-withdraw-002", publishedAt: "2026-08-28", claimId: "WITH-02", statement: "A withdrawn replacement.", relationships: [{ type: "replaces", target_id: "bench-withdraw-001:WITH-01", reason: "This relationship was withdrawn." }] });
  withdrawn.claims[0].status = "withdrawn";
  const resolution = resolveClaimRelationships([target, withdrawn], { now: new Date("2026-08-28T12:00:00Z") });
  assert.deepEqual(resolution.active.map((item) => item.id), ["bench-withdraw-001:WITH-01"]);
  assert.equal(resolution.decisions.length, 0);
});

test("stale or unknown relationship declarations cannot suppress active claims", () => {
  const newer = benchmarkPatch({ patchId: "bench-order-002", publishedAt: "2026-08-28", claimId: "ORDER-02", statement: "The synthetic order is two." });
  const older = benchmarkPatch({ patchId: "bench-order-001", publishedAt: "2026-08-20", claimId: "ORDER-01", statement: "The synthetic order is one.", relationships: [
    { type: "replaces", target_id: "bench-order-002:ORDER-02", reason: "Invalid reverse replacement." },
    { type: "conflicts", target_id: "missing:claim", reason: "Invalid missing target." },
  ] });
  const resolution = resolveClaimRelationships([newer, older], { now: new Date("2026-08-28T12:00:00Z") });
  assert.equal(resolution.active.length, 2);
  assert.deepEqual(resolution.warnings.map((warning) => warning.code).sort(), ["non_newer_relationship_source", "unknown_relationship_target"]);
});

test("semantic retrieval can rank a claim through an embedding adapter", async () => {
  const embed = async (input) => input.map((_, index) => index === 0 ? [1, 0] : index === 1 ? [1, 0] : [0, 1]);
  const result = await retrieveClaims("leftover safety", [patch()], { now: new Date("2026-08-28T12:00:00Z"), embed });
  assert.equal(result.mode, "semantic"); assert.equal(result.results[0].claim_id, "P-06");
});

test("failed embeddings fall back to lexical retrieval", async () => {
  const result = await retrieveClaims("cooked leftovers refrigerator", [patch()], { now: new Date("2026-08-28T12:00:00Z"), embed: async () => { throw new Error("embedding model is not installed"); } });
  assert.equal(result.mode, "lexical-fallback"); assert.equal(result.results[0].claim_id, "P-06");
});

test("retrieved context is ranked and injected into user context with provenance and guardrails", async () => {
  const retrieval = await retrieveClaims("five day cooked chicken", [patch()], { now: new Date("2026-08-28T12:00:00Z") });
  const context = formatRetrievedContext(retrieval);
  const messages = injectRetrievedContext([{ role: "user", content: "Can I eat it?" }], context);
  assert.match(messages[0].content, /RANK 1 \| pantry-003 \/ P-06/);
  assert.match(messages[0].content, /Apply quantitative limits literally/);
  assert.match(messages[0].content, /Do not use sensory cues/);
  assert.match(messages[0].content, /Claim relationships are explicit, human-approved patch metadata/);
  assert.match(messages[0].content, /USER MESSAGE\nCan I eat it\?/);
  assert.equal(messages[0].role, "user");
});
