import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { injectRetrievedContext } from "./rag.mjs";
import { retrieveDeltaAwareClaims } from "./claim-delta-rag.mjs";
import {
  buildBudgetedContext,
  CONTEXT_BUDGET_DEFAULTS,
} from "./context-budget.mjs";
import { ollamaChat, ollamaEmbed } from "./ollama.mjs";
import {
  scoreGenerationAdherence,
  summarizeGenerationAdherence,
} from "./bench-adherence.mjs";

const DEFAULT_LIMIT = 3;

function storePath() {
  return process.env.VELVET_LOCAL_STORE ?? join(homedir(), ".velvet-signal", "patches.json");
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8"));
    return {
      schema_version: 1,
      releases: Array.isArray(parsed.releases) ? parsed.releases : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { schema_version: 1, releases: [] };
    }
    throw error;
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseBenchOptions(argv) {
  const options = { scenarios: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--model") options.model = argv[++index];
    else if (current === "--baseline-model") options.baselineModel = argv[++index];
    else if (current === "--embed-model") options.embedModel = argv[++index];
    else if (current === "--context-budget") options.contextBudget = Number.parseInt(argv[++index], 10);
    else if (current === "--limit") options.limit = Number.parseInt(argv[++index], 10);
    else if (current === "--scenario") options.scenarios.push(argv[++index]);
    else if (current === "--json") options.json = true;
    else if (current === "--semantic") options.semantic = true;
    else if (current === "--no-baseline") options.noBaseline = true;
    else if (current === "--strict-adherence") options.strictAdherence = true;
    else if (current === "--list-scenarios") options.listScenarios = true;
    else if (current === "--help" || current === "-h") options.help = true;
  }
  return options;
}

function syntheticPatch({
  patchId,
  publishedAt,
  claimId,
  statement,
  relationships = [],
  validUntil = "2027-08-28",
}) {
  return {
    patch_id: patchId,
    desk: "VS-Bench",
    title: "Synthetic benchmark fixture",
    scope: "VS-Bench synthetic fixture",
    published_at: publishedAt,
    valid_until: validUntil,
    delivery: { status: "delivered", approved: true },
    claims: [{
      id: claimId,
      statement,
      status: "verified",
      source_ids: ["BENCH-SRC-1"],
      ...(relationships.length ? { relationships } : {}),
    }],
    sources: [{
      id: "BENCH-SRC-1",
      publisher: "VS-Bench",
      url: "https://example.test/fixture",
    }],
  };
}

export const BENCH_SCENARIOS = [
  {
    id: "five-day-chicken",
    source: "local-ledger",
    required: ["pantry-003"],
    query: "I cooked chicken five days ago and kept it refrigerated the whole time. Can I eat it?",
    checks: [
      {
        id: "leftover-rule",
        description: "retrieves a current cooked-leftover storage claim",
        test: ({ retrieval }) => retrieval.results.some(
          (item) => item.patch_id === "pantry-003" && /cooked leftovers/i.test(item.statement),
        ),
      },
      {
        id: "current-context",
        description: "answerability reports current context",
        test: ({ retrieval }) => retrieval.selection?.answerability?.status === "current-context",
      },
    ],
  },
  {
    id: "multi-intent-leftovers",
    source: "local-ledger",
    required: ["pantry-003"],
    query: "Can I eat chicken that has been refrigerated for five days, and how long can frozen leftovers be kept?",
    checks: [
      {
        id: "multiple-facets",
        description: "detects more than one query facet",
        test: ({ retrieval }) => (retrieval.selection?.intent_count ?? 1) >= 2,
      },
      {
        id: "facet-coverage",
        description: "covers all detected facets",
        test: ({ retrieval }) => {
          const total = retrieval.selection?.intent_count ?? 1;
          return (retrieval.selection?.intents_covered ?? 0) >= total;
        },
      },
    ],
  },
  {
    id: "overlap-delta",
    source: "synthetic",
    query: "How long can cooked leftovers be kept in the refrigerator and freezer?",
    patches: [
      syntheticPatch({
        patchId: "bench-delta-001",
        publishedAt: "2026-08-27",
        claimId: "DELTA-01",
        statement: "Cooked leftovers can be kept in the refrigerator for 3 to 4 days.",
      }),
      syntheticPatch({
        patchId: "bench-delta-002",
        publishedAt: "2026-08-28",
        claimId: "DELTA-02",
        statement: "Cooked leftovers can be kept in the refrigerator for 3 to 4 days, while frozen leftovers can be kept for 3 to 4 months.",
      }),
    ],
    checks: [{
      id: "meaningful-delta",
      description: "preserves the unique frozen-storage detail between overlapping claims",
      test: ({ retrieval }) => (retrieval.selection?.content_overlap?.distinct_detail_pair_count ?? 0) >= 1,
    }],
  },
  {
    id: "evidence-concentration",
    source: "local-ledger",
    required: ["maker-006"],
    query: "What happened to Flowise and TGI, and what should developers do about archived repositories?",
    checks: [{
      id: "shared-evidence",
      description: "detects repeated reliance on the same evidence lineage",
      test: ({ retrieval }) => (retrieval.selection?.evidence?.shared_evidence_group_count ?? 0) >= 1,
    }],
  },
  {
    id: "no-current-context",
    source: "local-ledger",
    required: [],
    query: "Who won the 1998 World Cup?",
    checks: [{
      id: "negative-capability",
      description: "does not pretend Velvet Signal supplied a current update",
      test: ({ retrieval }) => retrieval.selection?.answerability?.status === "no-current-context",
    }],
  },
  {
    id: "partial-current-context",
    source: "local-ledger",
    required: ["pantry-003"],
    query: "How long can cooked leftovers stay refrigerated, and who won the 1998 World Cup?",
    checks: [{
      id: "partial-answerability",
      description: "reports partial current-context coverage",
      test: ({ retrieval }) => retrieval.selection?.answerability?.status === "partial-current-context",
    }],
  },
  {
    id: "tiny-context-budget",
    source: "local-ledger",
    required: ["pantry-003"],
    contextBudget: 1200,
    query: "Can I eat five-day refrigerated chicken, how long can frozen leftovers last, and can smell tell me whether old food is safe?",
    checks: [{
      id: "optional-first",
      description: "tight packing drops optional diagnostics before facts",
      test: ({ packed }) => (packed.diagnostics?.omitted_optional_count ?? 0) > 0,
    }],
  },
  {
    id: "synthetic-update-gap",
    source: "synthetic",
    query: "Which synthetic policy uses revision one?",
    patches: [
      syntheticPatch({
        patchId: "bench-tombstone-001",
        publishedAt: "2026-08-20",
        claimId: "TOMB-01",
        statement: "The synthetic policy uses revision one.",
        validUntil: "2027-08-28",
      }),
      syntheticPatch({
        patchId: "bench-tombstone-002",
        publishedAt: "2026-08-27",
        claimId: "TOMB-02",
        statement: "The synthetic policy uses revision two.",
        validUntil: "2026-08-27",
        relationships: [{
          type: "replaces",
          target_id: "bench-tombstone-001:TOMB-01",
          reason: "Revision two replaced revision one.",
        }],
      }),
    ],
    checks: [
      {
        id: "update-gap",
        description: "reports an update gap instead of reviving revision one",
        test: ({ retrieval }) => retrieval.selection?.answerability?.status === "update-gap",
      },
      {
        id: "no-resurrection",
        description: "no displaced historical claim becomes active",
        test: ({ retrieval }) => retrieval.results.length === 0,
      },
    ],
  },
];

export function chooseBenchScenarios(ids = []) {
  if (!ids.length) return BENCH_SCENARIOS;
  const wanted = new Set(ids);
  return BENCH_SCENARIOS.filter((scenario) => wanted.has(scenario.id));
}

function availablePatchIds(releases) {
  return new Set(releases.map((entry) => entry?.patch?.patch_id).filter(Boolean));
}

function evaluateChecks(scenario, context) {
  return (scenario.checks ?? []).map((check) => {
    try {
      return {
        id: check.id,
        description: check.description,
        passed: Boolean(check.test(context)),
      };
    } catch (error) {
      return {
        id: check.id,
        description: check.description,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function summarizeRetrieval(retrieval) {
  return {
    mode: retrieval.mode,
    result_ids: retrieval.results.map((item) => item.id),
    answerability: retrieval.selection?.answerability?.status ?? null,
    intent_count: retrieval.selection?.intent_count ?? 1,
    intents_covered: retrieval.selection?.intents_covered ?? null,
    evidence: retrieval.selection?.evidence
      ? {
          status: retrieval.selection.evidence.status,
          distinct_evidence_count: retrieval.selection.evidence.distinct_evidence_count,
          distinct_publisher_count: retrieval.selection.evidence.distinct_publisher_count,
          shared_evidence_group_count: retrieval.selection.evidence.shared_evidence_group_count,
        }
      : null,
    overlap: retrieval.selection?.content_overlap
      ? {
          overlapping_pair_count: retrieval.selection.content_overlap.overlapping_pair_count,
          distinct_detail_pair_count: retrieval.selection.content_overlap.distinct_detail_pair_count,
        }
      : null,
  };
}

export async function runBenchScenario(scenario, options, deps) {
  const available = availablePatchIds(deps.releases);
  if (!scenario.patches) {
    const missing = (scenario.required ?? []).filter((id) => !available.has(id));
    if (missing.length) {
      return {
        id: scenario.id,
        query: scenario.query,
        skipped: true,
        skip_reason: `missing released patches: ${missing.join(", ")}`,
        generation_adherence: { scored: false, passed: null, reason: "scenario-skipped" },
      };
    }
  }

  const patches = scenario.patches ?? deps.releases.map((entry) => entry.patch);
  const retrieval = await deps.retrieveDeltaAwareClaims(scenario.query, patches, {
    limit: options.limit ?? DEFAULT_LIMIT,
    embed: options.semantic ? deps.embed : undefined,
  });
  const packed = deps.buildBudgetedContext(retrieval, {
    maxChars: scenario.contextBudget ?? options.contextBudget ?? CONTEXT_BUDGET_DEFAULTS.default_chars,
  });
  const checks = evaluateChecks(scenario, { retrieval, packed });

  let baselineAnswer = null;
  let patchedAnswer = null;
  if (options.model) {
    if (!options.noBaseline) {
      const baseline = await deps.ollamaChat(
        [{ role: "user", content: scenario.query }],
        { model: options.baselineModel ?? options.model },
      );
      baselineAnswer = clean(baseline.content);
    }
    const messages = deps.injectRetrievedContext(
      [{ role: "user", content: scenario.query }],
      packed.text,
    );
    const patched = await deps.ollamaChat(messages, { model: options.model });
    patchedAnswer = clean(patched.content);
  }

  return {
    id: scenario.id,
    source: scenario.source,
    query: scenario.query,
    skipped: false,
    retrieval: summarizeRetrieval(retrieval),
    packing: packed.diagnostics,
    checks,
    baseline_answer: baselineAnswer,
    patched_answer: patchedAnswer,
    generation_adherence: scoreGenerationAdherence(scenario.id, patchedAnswer),
  };
}

export function formatBenchReport(results, options = {}) {
  const executed = results.filter((result) => !result.skipped);
  const checks = executed.flatMap((result) => result.checks);
  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.filter((check) => !check.passed).length;
  const skipped = results.filter((result) => result.skipped).length;
  const adherence = summarizeGenerationAdherence(executed);

  const lines = [
    "# VS-Bench",
    "",
    `Scenarios: ${results.length} total | ${executed.length} executed | ${skipped} skipped`,
    `Retrieval checks: ${passed} passed | ${failed} failed`,
    options.model
      ? `Generation adherence: ${adherence.passed}/${adherence.scored} passed | ${adherence.failed} failed${adherence.unscored ? ` | ${adherence.unscored} unscored` : ""}`
      : "Generation adherence: not scored (no model requested)",
    options.model
      ? `Model A/B: ${options.noBaseline ? "patched only" : "baseline vs patched"}`
      : "Model A/B: not requested",
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.id}`);
    lines.push(`Query: ${result.query}`);
    if (result.skipped) {
      lines.push(`SKIPPED: ${result.skip_reason}`, "");
      continue;
    }
    lines.push(
      `Retrieval: ${result.retrieval.mode}`,
      `Claims: ${result.retrieval.result_ids.join(", ") || "none"}`,
      `Answerability: ${result.retrieval.answerability}`,
    );
    if (result.retrieval.intent_count > 1) {
      lines.push(`Facets: ${result.retrieval.intents_covered}/${result.retrieval.intent_count}`);
    }
    if (result.retrieval.evidence) {
      const evidence = result.retrieval.evidence;
      lines.push(
        `Evidence: ${evidence.distinct_evidence_count} distinct / ${evidence.distinct_publisher_count} publishers / ${evidence.shared_evidence_group_count} shared group(s)`,
      );
    }
    if (result.retrieval.overlap) {
      const overlap = result.retrieval.overlap;
      lines.push(
        `Overlap: ${overlap.overlapping_pair_count} pair(s) / ${overlap.distinct_detail_pair_count} with delta`,
      );
    }
    lines.push(
      `Context: ${result.packing.used_chars}/${result.packing.budget_chars} chars (~${result.packing.approximate_tokens} tokens), optional omitted=${result.packing.omitted_optional_count}${result.packing.hard_minimum_exceeded ? ", hard minimum exceeded" : ""}`,
      "Retrieval checks:",
    );
    for (const check of result.checks) {
      lines.push(
        `  ${check.passed ? "PASS" : "FAIL"} ${check.id} — ${check.description}${check.error ? ` (${check.error})` : ""}`,
      );
    }
    if (options.model) {
      const generation = result.generation_adherence;
      lines.push(
        `Generation adherence: ${generation.scored ? (generation.passed ? "PASS" : "FAIL") : "UNSCORED"}${generation.label ? ` — ${generation.label}` : ""}`,
      );
    }
    if (result.baseline_answer !== null) {
      lines.push("", "BASELINE MODEL:", result.baseline_answer);
    }
    if (result.patched_answer !== null) {
      lines.push("", "VELVET-PATCHED MODEL:", result.patched_answer);
    }
    lines.push("");
  }

  return {
    text: lines.join("\n"),
    retrieval: { passed, failed, skipped },
    adherence,
  };
}

export async function runBench(options = {}) {
  const store = await readStore();
  const deps = {
    releases: store.releases,
    retrieveDeltaAwareClaims,
    buildBudgetedContext,
    injectRetrievedContext,
    ollamaChat,
    embed: (input) => ollamaEmbed(input, { model: options.embedModel }),
  };
  const scenarios = chooseBenchScenarios(options.scenarios);
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runBenchScenario(scenario, options, deps));
  }
  return results;
}

function usage() {
  return [
    "VS-Bench",
    "",
    "npm run bench",
    "npm run bench -- --model <ollama-model>",
    "npm run bench -- --model <ollama-model> --context-budget 1200",
    "npm run bench -- --scenario five-day-chicken",
    "npm run bench -- --semantic",
    "npm run bench -- --json",
    "npm run bench -- --list-scenarios",
    "npm run bench -- --model <ollama-model> --strict-adherence",
    "",
    "Retrieval check failures return a nonzero exit code.",
    "Generation adherence is observational unless --strict-adherence is supplied.",
  ].join("\n");
}

async function main() {
  const options = parseBenchOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.listScenarios) {
    for (const scenario of BENCH_SCENARIOS) {
      console.log(`${scenario.id}\t${scenario.source}\t${scenario.query}`);
    }
    return;
  }

  const results = await runBench(options);
  const report = formatBenchReport(results, options);
  if (options.json) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      summary: {
        retrieval: report.retrieval,
        generation_adherence: report.adherence,
      },
      results,
    }, null, 2));
  } else {
    console.log(report.text);
  }

  if (report.retrieval.failed > 0 || (options.strictAdherence && report.adherence.failed > 0)) {
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
