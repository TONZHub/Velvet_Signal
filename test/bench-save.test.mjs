import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  benchmarkArtifact,
  parseBenchSaveOptions,
  saveBenchmarkArtifacts,
} from "../src/bench-save.mjs";

function fixtureResults() {
  return [
    {
      id: "fixture",
      source: "synthetic",
      query: "test query",
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
        { id: "retrieval", description: "retrieves fixture", passed: true },
      ],
      generation_adherence: {
        scored: true,
        passed: false,
        label: "uses the fixture",
        reason: null,
      },
      baseline_answer: "baseline answer",
      patched_answer: "patched answer",
    },
  ];
}

test("save option parser keeps bench options and extracts the destination", () => {
  const parsed = parseBenchSaveOptions([
    "--model",
    "dolphin3:8b",
    "--scenario",
    "five-day-chicken",
    "--save-dir",
    "proof-runs",
  ]);
  assert.equal(parsed.saveDir, "proof-runs");
  assert.equal(parsed.options.model, "dolphin3:8b");
  assert.deepEqual(parsed.options.scenarios, ["five-day-chicken"]);
});

test("benchmark artifact preserves separate retrieval and generation summaries", () => {
  const artifact = benchmarkArtifact(
    fixtureResults(),
    { model: "tiny-model" },
    new Date("2026-08-29T00:30:00.000Z"),
  );
  assert.equal(artifact.schema_version, 1);
  assert.equal(artifact.summary.retrieval.passed, 1);
  assert.equal(artifact.summary.retrieval.failed, 0);
  assert.equal(artifact.summary.generation_adherence.passed, 0);
  assert.equal(artifact.summary.generation_adherence.failed, 1);
});

test("saved runs write timestamped JSON and Markdown artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velvet-bench-"));
  try {
    const saved = await saveBenchmarkArtifacts(
      fixtureResults(),
      { model: "Dolphin 3:8B" },
      directory,
      new Date("2026-08-29T00:30:00.000Z"),
    );
    assert.match(saved.json_path, /2026-08-29T00-30-00-000Z-dolphin-3-8b\.json$/);
    assert.match(saved.markdown_path, /2026-08-29T00-30-00-000Z-dolphin-3-8b\.md$/);

    const json = JSON.parse(await readFile(saved.json_path, "utf8"));
    const markdown = await readFile(saved.markdown_path, "utf8");
    assert.equal(json.model, "Dolphin 3:8B");
    assert.equal(json.summary.retrieval.passed, 1);
    assert.match(markdown, /Retrieval correctness and model generation adherence are scored separately/);
    assert.match(markdown, /BASELINE MODEL:/);
    assert.match(markdown, /VELVET-PATCHED MODEL:/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
