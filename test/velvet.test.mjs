import assert from "node:assert/strict";
import test from "node:test";
import {
  composeEdition,
  parseComposeEditionInput,
  VelvetUpstreamError,
  VelvetValidationError,
} from "../src/velvet.mjs";
const source = {
  id: "SRC-CHROME",
  title: "WebMCP docs",
  url: "https://developer.chrome.com/docs/ai/webmcp/imperative-api",
  excerpt: "The imperative API registers tools through document.modelContext.",
};
test("every public desk requires sourced signal packets", () => {
  for (const desk of [
    "model-watch",
    "pantry",
    "wellbeing",
    "culture",
    "maker",
  ]) {
    assert.throws(
      () => parseComposeEditionInput({ desk, sources: [] }),
      VelvetValidationError,
    );
    assert.equal(parseComposeEditionInput({ desk, sources: [source] }).desk, desk);
  }
});
test("Your People requires explicit cloud-processing consent", () => {
  assert.throws(
    () =>
      parseComposeEditionInput({
        desk: "your-people",
        privateContext: "The user prefers concise project updates.",
      }),
    VelvetValidationError,
  );
  const parsed = parseComposeEditionInput({
    desk: "your-people",
    privateContext: "The user prefers concise project updates.",
    consent: {
      allowCloudProcessing: true,
      acknowledgedAt: "2026-08-27T03:00:00.000Z",
    },
  });
  assert.equal(parsed.consent?.allowCloudProcessing, true);
  assert.throws(
    () =>
      parseComposeEditionInput({
        desk: "your-people",
        sources: [source],
        privateContext: "Private context must not be mixed with web packets.",
        consent: {
          allowCloudProcessing: true,
          acknowledgedAt: "2026-08-27T03:00:00.000Z",
        },
      }),
    VelvetValidationError,
  );
});
test("OpenRouter structured output becomes a proposed, unapproved edition", async () => {
  const input = parseComposeEditionInput({
    desk: "maker",
    sources: [source],
    priorClaims: [
      {
        id: "maker-001:ME-01",
        statement: "The earlier fixture exposes structured tools.",
        publishedAt: "2026-08-20T00:00:00.000Z",
      },
    ],
  });
  let requestBody;
  const fetchImpl = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "The Web Has Tools Now",
                kicker: "A structured interface for agents.",
                dek: "WebMCP makes page capabilities explicit.",
                editorial: [
                  "Paragraph one.",
                  "Paragraph two.",
                  "Paragraph three.",
                ],
                pull_quote: "The page becomes a collaborator.",
                claims: [
                  {
                    statement: "WebMCP exposes structured tools.",
                    source_ids: ["SRC-CHROME"],
                    confidence: "high",
                    status: "verified",
                    relationships: [
                      {
                        type: "narrows",
                        target_id: "maker-001:ME-01",
                        reason: "The new source limits the claim to registered page tools.",
                      },
                    ],
                  },
                ],
                tone_notes: ["Verify experimental API details."],
                tags: ["webmcp"],
                validity_days: 30,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await composeEdition(input, {
    apiKey: "test-key",
    model: "test/model",
    fetchImpl,
    now: () => /* @__PURE__ */ new Date("2026-08-27T03:00:00.000Z"),
  });
  assert.equal(result.status, "proposed");
  assert.equal(result.consent.memory_delivery_approved, false);
  assert.equal(result.engine.model, "test/model");
  assert.equal((requestBody?.response_format).type, "json_schema");
  assert.deepEqual((requestBody?.provider).order, ["novita"]);
  assert.equal("only" in (requestBody?.provider ?? {}), false);
  assert.equal((requestBody?.provider).allow_fallbacks, true);
  assert.equal((requestBody?.provider).require_parameters, true);
  assert.equal((requestBody?.reasoning).effort, "high");
  assert.equal((requestBody?.reasoning).exclude, true);
  assert.equal(requestBody?.max_tokens, 4200);
  assert.equal((requestBody?.response_format).json_schema?.strict, true);
  assert.deepEqual(result.claims[0].relationships, [
    {
      type: "narrows",
      target_id: "maker-001:ME-01",
      reason: "The new source limits the claim to registered page tools.",
    },
  ]);
  const prompt = JSON.parse(requestBody.messages[1].content);
  assert.equal(prompt.prior_claims[0].id, "maker-001:ME-01");
  assert.equal(prompt.prior_claims_are_relationship_targets_only, true);
  assert.deepEqual(
    requestBody.response_format.json_schema.schema.properties.claims.items.properties.relationships.items.properties.type.enum,
    ["replaces", "narrows", "confirms", "conflicts"],
  );
});
test("OpenRouter retries an empty GLM completion without changing models", async () => {
  const input = parseComposeEditionInput({ desk: "model-watch", sources: [source] });
  let calls = 0;
  const fetchImpl = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "z-ai/glm-5.3-flash");
    if (calls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "The retry landed",
                kicker: "Same model, complete response.",
                dek: "An empty completion is retried once.",
                editorial: ["One.", "Two.", "Three."],
                pull_quote: "Transient is not terminal.",
                claims: [
                  {
                    statement: "WebMCP exposes structured tools.",
                    source_ids: ["SRC-CHROME"],
                    confidence: "high",
                    status: "verified",
                    relationships: [],
                  },
                ],
                tone_notes: ["Keep retries bounded."],
                tags: ["reliability"],
                validity_days: 30,
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const edition = await composeEdition(input, { apiKey: "test-key", fetchImpl });
  assert.equal(edition.title, "The retry landed");
  assert.equal(calls, 2);
});
test("OpenRouter cannot invent a prior claim relationship target", async () => {
  const input = parseComposeEditionInput({
    desk: "maker",
    sources: [source],
    priorClaims: [
      {
        id: "maker-001:ME-01",
        statement: "A known prior claim.",
        publishedAt: "2026-08-20T00:00:00.000Z",
      },
    ],
  });
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "A related change",
                kicker: "Typed links need exact targets.",
                dek: "Unknown prior claims are rejected.",
                editorial: ["One.", "Two.", "Three."],
                pull_quote: "A relation is a claim too.",
                claims: [
                  {
                    statement: "WebMCP exposes structured tools.",
                    source_ids: ["SRC-CHROME"],
                    confidence: "high",
                    status: "verified",
                    relationships: [
                      {
                        type: "replaces",
                        target_id: "invented:CLAIM-99",
                        reason: "This target was not supplied.",
                      },
                    ],
                  },
                ],
                tone_notes: ["Reject unknown targets."],
                tags: ["relationships"],
                validity_days: 30,
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  await assert.rejects(
    () => composeEdition(input, { apiKey: "test-key", fetchImpl }),
    VelvetUpstreamError,
  );
});
test("OpenRouter cannot cite a source that was not supplied", async () => {
  const input = parseComposeEditionInput({
    desk: "culture",
    sources: [source],
  });
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Culture moves",
                kicker: "Context changes.",
                dek: "A sourced edition.",
                editorial: ["One.", "Two.", "Three."],
                pull_quote: "Context has a clock.",
                claims: [
                  {
                    statement: "An unsupported claim.",
                    source_ids: ["INVENTED"],
                    confidence: "high",
                    status: "verified",
                    relationships: [],
                  },
                ],
                tone_notes: ["Keep ambiguity visible."],
                tags: ["culture"],
                validity_days: 7,
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  await assert.rejects(
    () => composeEdition(input, { apiKey: "test-key", fetchImpl }),
    VelvetUpstreamError,
  );
});
