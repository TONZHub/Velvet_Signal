import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatBenchReport,
  parseBenchOptions,
  runBench,
} from "./bench.mjs";

const DEFAULT_SAVE_DIR = "bench-results";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fileSlug(value) {
  const slug = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "retrieval-only";
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function parseBenchSaveOptions(argv) {
  const benchArgs = [];
  let saveDir = DEFAULT_SAVE_DIR;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--save-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--save-dir requires a path.");
      saveDir = value;
    } else {
      benchArgs.push(current);
    }
  }
  return {
    options: parseBenchOptions(benchArgs),
    saveDir,
  };
}

export function benchmarkArtifact(results, options = {}, generatedAt = new Date()) {
  const report = formatBenchReport(results, options);
  return {
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    model: options.model ?? null,
    baseline_model: options.noBaseline
      ? null
      : options.baselineModel ?? options.model ?? null,
    retrieval_mode: options.semantic ? "semantic" : "lexical",
    context_budget: Number.isInteger(options.contextBudget)
      ? options.contextBudget
      : null,
    scenario_filter: Array.isArray(options.scenarios) && options.scenarios.length
      ? [...options.scenarios]
      : null,
    summary: {
      retrieval: report.retrieval,
      generation_adherence: report.adherence,
    },
    results,
  };
}

function markdownArtifact(artifact, reportText) {
  const retrieval = artifact.summary.retrieval;
  const adherence = artifact.summary.generation_adherence;
  const lines = [
    "# VS-Bench saved run",
    "",
    `- Generated: ${artifact.generated_at}`,
    `- Patched model: ${artifact.model ?? "not requested"}`,
    `- Baseline model: ${artifact.baseline_model ?? "not requested"}`,
    `- Retrieval mode: ${artifact.retrieval_mode}`,
    `- Retrieval checks: ${retrieval.passed} passed / ${retrieval.failed} failed / ${retrieval.skipped} skipped`,
    artifact.model
      ? `- Generation adherence: ${adherence.passed}/${adherence.scored} passed / ${adherence.failed} failed / ${adherence.unscored} unscored`
      : "- Generation adherence: not scored",
    "",
    "> Retrieval correctness and model generation adherence are scored separately. A weak model can ignore correct context without turning that into a retrieval failure.",
    "",
    reportText,
    "",
  ];
  return lines.join("\n");
}

export async function saveBenchmarkArtifacts(
  results,
  options = {},
  saveDir = DEFAULT_SAVE_DIR,
  generatedAt = new Date(),
) {
  const report = formatBenchReport(results, options);
  const artifact = benchmarkArtifact(results, options, generatedAt);
  const directory = resolve(saveDir);
  await mkdir(directory, { recursive: true });

  const stem = `${timestampSlug(generatedAt)}-${fileSlug(options.model)}`;
  const jsonPath = join(directory, `${stem}.json`);
  const markdownPath = join(directory, `${stem}.md`);

  await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdownArtifact(artifact, report.text), "utf8");

  return {
    artifact,
    report,
    json_path: jsonPath,
    markdown_path: markdownPath,
  };
}

function usage() {
  return [
    "VS-Bench saved run",
    "",
    "npm run bench:save",
    "npm run bench:save -- --model <ollama-model>",
    "npm run bench:save -- --model <ollama-model> --semantic",
    "npm run bench:save -- --model <ollama-model> --save-dir <path>",
    "",
    "All normal npm run bench options are accepted.",
    `Artifacts default to ./${DEFAULT_SAVE_DIR}/ as timestamped JSON and Markdown files.`,
  ].join("\n");
}

async function main() {
  const parsed = parseBenchSaveOptions(process.argv.slice(2));
  if (parsed.options.help) {
    console.log(usage());
    return;
  }
  if (parsed.options.listScenarios) {
    throw new Error("Use npm run bench -- --list-scenarios for scenario discovery.");
  }

  const results = await runBench(parsed.options);
  const saved = await saveBenchmarkArtifacts(
    results,
    parsed.options,
    parsed.saveDir,
  );

  console.log(saved.report.text);
  console.log(`Saved JSON: ${saved.json_path}`);
  console.log(`Saved Markdown: ${saved.markdown_path}`);

  if (
    saved.report.retrieval.failed > 0 ||
    (parsed.options.strictAdherence && saved.report.adherence.failed > 0)
  ) {
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
