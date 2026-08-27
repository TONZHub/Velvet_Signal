import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runScout, SCOUT_CONFIG, tavilySearch } from "../src/scout.mjs";

function searchResponse(deskId) {
  return {
    request_id: `request-${deskId}`,
    usage: { credits: 1 },
    results: [
      {
        title: `${deskId} official update`,
        url: `https://example.com/${deskId}/update`,
        content: `A sourced ${deskId} change with an exact date and bounded scope.`,
      },
      {
        title: `${deskId} supporting documentation`,
        url: `https://docs.example.com/${deskId}/reference`,
        content: `Independent supporting context for the ${deskId} change.`,
      },
    ],
  };
}

function editionFor(input) {
  return {
    title: `${input.desk} changed`,
    kicker: "A sourced change worth carrying briefly.",
    dek: "The scheduled scout found a material update.",
    editorial: ["Paragraph one.", "Paragraph two.", "Paragraph three."],
    pull_quote: "Fresh context needs an exit date.",
    claims: [
      {
        statement: "The source packet reports a bounded change.",
        source_ids: [input.sources[0].id],
        confidence: "high",
        status: "verified",
      },
    ],
    tone_notes: ["Keep the boundary visible."],
    tags: [input.desk],
    validity_days: input.desk === "culture" ? 14 : 60,
  };
}

test("the scheduled scout publishes all public desks and skips unchanged packets", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "velvet-scout-"));
  const catalogPath = join(temporaryDirectory, "generated-issues.json");
  await writeFile(
    catalogPath,
    `${JSON.stringify({ schema_version: 1, generated_at: null, desks: {}, issues: [] })}\n`,
  );
  let composeCalls = 0;
  const searches = [];
  const options = {
    catalogPath,
    now: () => new Date("2026-08-27T10:00:00.000Z"),
    searchImpl: async (config, { deskId, fallback }) => {
      searches.push({ config, deskId, fallback });
      return deskId === "pantry" && !fallback
        ? { results: [] }
        : searchResponse(deskId);
    },
    composeImpl: async (input) => {
      composeCalls += 1;
      return editionFor(input);
    },
  };
  try {
    const first = await runScout(options);
    assert.equal(first.changed, true);
    assert.equal(first.summary.published.length, 5);
    assert.equal(first.summary.published.every((id) => id.endsWith("-002")), true);
    assert.equal(first.summary.published.some((id) => id.startsWith("your-people")), false);
    assert.deepEqual(first.summary.fallback, ["pantry"]);
    const pantryFallback = searches.find(
      (search) => search.deskId === "pantry" && search.fallback,
    );
    assert.match(pantryFallback.config.query, /^site:fsis\.usda\.gov/);
    assert.equal(pantryFallback.config.includeDomains, undefined);
    assert.equal(pantryFallback.config.searchDepth, "advanced");
    assert.equal(pantryFallback.config.maxResults, 8);
    assert.equal(composeCalls, 5);

    const stored = JSON.parse(await readFile(catalogPath, "utf8"));
    assert.equal(stored.issues.length, 5);
    assert.equal(stored.issues.every((issue) => issue.generated === true), true);
    assert.equal(stored.issues.every((issue) => issue.scout.provider === "tavily"), true);
    assert.equal(
      stored.issues.find((issue) => issue.deskId === "pantry")?.scout.search_mode,
      "timeless-official-fallback",
    );
    assert.equal(stored.issues.some((issue) => issue.deskId === "your-people"), false);

    const second = await runScout(options);
    assert.equal(second.changed, false);
    assert.deepEqual(second.summary.unchanged.sort(), [
      "culture",
      "maker",
      "model-watch",
      "pantry",
      "wellbeing",
    ]);
    assert.equal(composeCalls, 5);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Tavily search uses bounded, cost-controlled packets", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, body: JSON.parse(init.body), headers: init.headers };
    return new Response(JSON.stringify(searchResponse("culture")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const response = await tavilySearch(SCOUT_CONFIG.culture, {
    apiKey: "tvly-test",
    fetchImpl,
  });
  assert.equal(request.url, "https://api.tavily.com/search");
  assert.equal(request.headers.Authorization, "Bearer tvly-test");
  assert.equal(request.body.search_depth, "basic");
  assert.equal(request.body.max_results, 5);
  assert.equal(request.body.include_answer, false);
  assert.equal(request.body.include_raw_content, false);
  assert.equal(request.body.safe_search, true);
  assert.equal(response.usage.credits, 1);
});
