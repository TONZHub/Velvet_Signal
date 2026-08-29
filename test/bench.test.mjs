import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCH_SCENARIOS,
  chooseBenchScenarios,
  formatBenchReport,
  runBenchScenario,
} from "../src/bench.mjs";

test("bench ships the expected scenario set", () => {
  const ids = BENCH_SCENARIOS.map((scenario) => scenario.id);
  assert.deepEqual(ids, [
    "five-day-chicken",
    "multi-intent-leftovers",
    "overlap-delta",
    "evidence-concentration",
    "no-current-context",
    "partial-current-context",
    "tiny-context-budget",
    "synthetic-update-gap",
  ]);
});

test("scenario filtering is deterministic", () => {
  const selected = chooseBenchScenarios([
    "five-day-chicken",
    "synthetic-update-gap",
  ]);
  assert.deepEqual(
    selected.map((scenario) => scenario.id),
    ["five-day-chicken", "synthetic-update-gap"],
  );
});

test("missing released patch skips instead of inventing benchmark data", async () => {
  const scenario = BENCH_SCENARIOS.find((item) => item.id === "five-day-chicken");
  const result = await runBenchScenario(scenario, {}, {
    releases: [],
    retrieveDeltaAwareClaims: async () => { throw new Error("should not run"); },
    buildBudgetedContext: () => { throw new Error("should not run"); },
    injectRetrievedContext: (messages) => messages,
    ollamaChat: async () => ({ content: "" }),
    embed: undefined,
  });
  assert.equal(result.skipped, true);
  assert.match(result.skip_reason, /pantry-003/);
});

test("synthetic update-gap can run without local releases", async () => {
  const scenario = BENCH_SCENARIOS.find((item) => item.id === "synthetic-update-gap");
  const result = await runBenchScenario(scenario, {}, {
    releases: [],
    retrieveDeltaAwareClaims: async () => ({
      mode: "lexical-relationship-only",
      results: [],
      resolution: { decisions: [] },
      selection: {
        answerability: { status: "update-gap" },
        content_overlap: {
          overlapping_pair_count: 0,
          distinct_detail_pair_count: 0,
        },
      },
    }),
    buildBudgetedContext: () => ({
      text: "compact",
      diagnostics: {
        budget_chars: 6000,
        used_chars: 7,
        approximate_tokens: 2,
        omitted_optional_count: 0,
        hard_minimum_exceeded: false,
      },
    }),
    injectRetrievedContext: (messages) => messages,
    ollamaChat: async () => ({ content: "" }),
    embed: undefined,
  });
  assert.equal(result.skipped, false);
  assert.equal(result.checks.every((check) => check.passed), true);
  assert.equal(result.generation_adherence.scored, false);
});

test("report keeps retrieval and generation scores separate", () => {
  const report = formatBenchReport([
    {
      id: "fixture",
      query: "test",
      skipped: false,
      retrieval: {
        mode: "lexical",
        result_ids: ["fixture:C1"],
        answerability: "current-context",
        intent_count: 1,
        intents_covered: 1,
        evidence: null,
        overlap: null,
      },
      packing: {
        used_chars: 100,
        budget_chars: 6000,
        approximate_tokens: 25,
        omitted_optional_count: 0,
        hard_minimum_exceeded: false,
      },
      checks: [
        { id: "pass", description: "passes", passed: true },
        { id: "fail", description: "fails", passed: false },
      ],
      generation_adherence: {
        scored: true,
        passed: false,
        label: "obeys context",
      },
      baseline_answer: "baseline",
      patched_answer: "patched",
    },
  ], { model: "test-model" });
  assert.equal(report.retrieval.passed, 1);
  assert.equal(report.retrieval.failed, 1);
  assert.equal(report.adherence.passed, 0);
  assert.equal(report.adherence.failed, 1);
  assert.match(report.text, /Retrieval checks: 1 passed \| 1 failed/);
  assert.match(report.text, /Generation adherence: 0\/1 passed \| 1 failed/);
});
