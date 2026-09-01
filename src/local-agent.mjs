import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { injectRetrievedContext, patchIsActive } from "./rag.mjs";
import { retrieveDeltaAwareClaims } from "./claim-delta-rag.mjs";
import { buildBudgetedContext } from "./context-budget.mjs";
import { ollamaChat, ollamaEmbed } from "./ollama.mjs";
import { patchForIssue } from "./patch.mjs";
import {
  applyLocalRelevanceGate,
  LOCAL_AGENT_SYSTEM_MESSAGE,
  normalizeLocalRetrievalQuery,
} from "./local-relevance.mjs";

const DEFAULT_PUBLIC_URL = "https://velvetsignal.lol";

function storePath() {
  return process.env.VELVET_LOCAL_STORE ?? join(homedir(), ".velvet-signal", "patches.json");
}

function emptyStore() {
  return { schema_version: 2, downloads: [], releases: [] };
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8"));
    return {
      schema_version: 2,
      downloads: Array.isArray(parsed.downloads) ? parsed.downloads : [],
      releases: Array.isArray(parsed.releases) ? parsed.releases : [],
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }
}

async function writeStore(store) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function publicUrl() {
  return String(process.env.VELVET_PUBLIC_URL ?? DEFAULT_PUBLIC_URL).replace(/\/$/, "");
}

function patchIsCurrent(patch, now = new Date()) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  if (typeof patch.valid_until !== "string") return false;
  const expiresAt = Date.parse(`${patch.valid_until}T23:59:59.999Z`);
  return Number.isFinite(expiresAt) && expiresAt >= now.getTime();
}

async function downloadAllPatches() {
  const response = await fetch(`${publicUrl()}/api/velvet/issues`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.issues)) {
    throw new Error(
      payload?.message ?? payload?.error ?? `Download failed with HTTP ${response.status}.`,
    );
  }

  const downloadedAt = new Date().toISOString();
  const incoming = payload.issues.map((issue) => ({
    patch: patchForIssue(issue, { deliveryStatus: "locked" }),
    downloaded_at: downloadedAt,
  }));
  const store = await readStore();
  const downloadsById = new Map(
    store.downloads
      .filter((entry) => entry?.patch?.patch_id)
      .map((entry) => [entry.patch.patch_id, entry]),
  );
  for (const entry of incoming) {
    downloadsById.set(entry.patch.patch_id, entry);
  }
  store.downloads = [...downloadsById.values()].sort((left, right) => {
    const dateOrder = String(right.patch?.published_at ?? "").localeCompare(
      String(left.patch?.published_at ?? ""),
    );
    if (dateOrder !== 0) return dateOrder;
    return String(left.patch?.patch_id ?? "").localeCompare(String(right.patch?.patch_id ?? ""));
  });
  await writeStore(store);

  return {
    fetched: incoming.length,
    stored: store.downloads.length,
    current: store.downloads.filter((entry) => patchIsCurrent(entry.patch)).length,
    expired: store.downloads.filter((entry) => !patchIsCurrent(entry.patch)).length,
    released: store.releases.length,
  };
}

async function releasePatch(patchId) {
  const response = await fetch(`${publicUrl()}/api/velvet/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch_id: patchId }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.patch || !payload?.receipt) {
    throw new Error(payload?.message ?? payload?.error ?? `Release failed with HTTP ${response.status}.`);
  }
  const store = await readStore();
  store.releases = store.releases.filter((entry) => entry?.patch?.patch_id !== payload.patch.patch_id);
  store.releases.push({ patch: payload.patch, receipt: payload.receipt, stored_at: new Date().toISOString() });
  await writeStore(store);
  return payload.patch;
}

function parseOptions(argv) {
  const values = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--model") options.model = argv[++index];
    else if (current === "--embed-model") options.embedModel = argv[++index];
    else if (current === "--limit") options.limit = Number.parseInt(argv[++index], 10);
    else if (current === "--context-budget") options.contextBudget = Number.parseInt(argv[++index], 10);
    else if (current === "--lexical") options.lexicalOnly = true;
    else values.push(current);
  }
  return { values, options };
}

async function releasedPatches() {
  const store = await readStore();
  return store.releases.map((entry) => entry.patch);
}

async function retrieve(question, options) {
  const patches = await releasedPatches();
  const retrievalQuery = normalizeLocalRetrievalQuery(question);
  const embed = options.lexicalOnly || !retrievalQuery
    ? undefined
    : (input) => ollamaEmbed(input, { model: options.embedModel });
  const retrieval = await retrieveDeltaAwareClaims(retrievalQuery, patches, {
    limit: Number.isInteger(options.limit) ? options.limit : 3,
    embed,
  });
  const gated = applyLocalRelevanceGate(retrieval, {
    minSemantic: process.env.VELVET_MIN_SEMANTIC_SCORE,
  });
  gated.selection = {
    ...(gated.selection ?? {}),
    query_normalization: {
      original: question,
      retrieval_query: retrievalQuery,
      stripped_publication_name: retrievalQuery !== question,
      identity_only: !retrievalQuery,
    },
  };
  return gated;
}

async function commandDownloadAll() {
  const result = await downloadAllPatches();
  console.log(`Fetched ${result.fetched} published Velvet Signal patch(es).`);
  console.log(`Local library: ${result.stored} total (${result.current} current, ${result.expired} expired/historical).`);
  console.log(`Released into active model context: ${result.released}.`);
  console.log("Downloaded patches remain locked until you explicitly run release <patch-id>.");
}

async function commandRelease(args) {
  if (!args[0]) throw new Error("Usage: npm run local -- release <patch-id>");
  const patch = await releasePatch(args[0]);
  console.log(`Stored ${patch.patch_id} (${patch.title}) until ${patch.valid_until}.`);
}

async function commandReleaseAll(args) {
  if (!args.includes("--confirm")) {
    throw new Error(
      "release-all activates every current downloaded patch. Re-run with: npm run local -- release-all --confirm",
    );
  }

  const store = await readStore();
  const currentDownloads = store.downloads.filter(
    (entry) => entry?.patch?.patch_id && patchIsCurrent(entry.patch),
  );
  const expiredCount = store.downloads.filter(
    (entry) => entry?.patch?.patch_id && !patchIsCurrent(entry.patch),
  ).length;

  if (currentDownloads.length === 0) {
    console.log("No current downloaded patches are available to release. Run download-all first.");
    if (expiredCount > 0) {
      console.log(`Skipped ${expiredCount} expired/historical patch(es).`);
    }
    return;
  }

  const alreadyActiveIds = new Set(
    store.releases
      .filter((entry) => entry?.patch?.patch_id && patchIsActive(entry.patch))
      .map((entry) => entry.patch.patch_id),
  );
  const pending = currentDownloads.filter(
    (entry) => !alreadyActiveIds.has(entry.patch.patch_id),
  );
  const alreadyActive = currentDownloads.length - pending.length;
  const failures = [];
  let activated = 0;

  for (const entry of pending) {
    const patchId = entry.patch.patch_id;
    try {
      const patch = await releasePatch(patchId);
      activated += 1;
      console.log(`released\t${patch.patch_id}\t${patch.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ patchId, message });
      console.error(`failed\t${patchId}\t${message}`);
    }
  }

  console.log(
    `Release-all summary: ${activated} activated, ${alreadyActive} already active, ${expiredCount} expired/historical skipped, ${failures.length} failed.`,
  );
  if (failures.length > 0) {
    throw new Error(`${failures.length} patch(es) failed to release.`);
  }
}

async function commandList() {
  const store = await readStore();
  if (store.downloads.length === 0 && store.releases.length === 0) {
    console.log("No local Velvet Signal patches are stored yet.");
    return;
  }

  const entries = new Map();
  for (const entry of store.downloads) {
    if (!entry?.patch?.patch_id) continue;
    entries.set(entry.patch.patch_id, {
      patch: entry.patch,
      acquisition: "downloaded",
    });
  }
  for (const entry of store.releases) {
    if (!entry?.patch?.patch_id) continue;
    entries.set(entry.patch.patch_id, {
      patch: entry.patch,
      acquisition: "released",
    });
  }

  for (const { patch, acquisition } of [...entries.values()].sort((left, right) =>
    String(right.patch.published_at ?? "").localeCompare(String(left.patch.published_at ?? "")),
  )) {
    const validity = patchIsCurrent(patch) ? "current" : "expired";
    const activation = acquisition === "released" && patchIsActive(patch) ? "active" : "inactive";
    console.log(`${acquisition}\t${validity}\t${activation}\t${patch.patch_id}\t${patch.title}`);
  }
}

async function commandInspect(args) {
  const { values, options } = parseOptions(args);
  const question = values.join(" ").trim();
  if (!question) throw new Error("Usage: npm run local -- inspect [--lexical] <question>");
  const result = await retrieve(question, options);
  console.log(JSON.stringify(result, null, 2));
}

async function commandAsk(args) {
  const { values, options } = parseOptions(args);
  const question = values.join(" ").trim();
  if (!question) throw new Error("Usage: npm run local -- ask --model <ollama-model> <question>");
  const retrieval = await retrieve(question, options);
  const packed = buildBudgetedContext(retrieval, {
    maxChars: options.contextBudget,
  });
  const messages = injectRetrievedContext(
    [
      { role: "system", content: LOCAL_AGENT_SYSTEM_MESSAGE },
      { role: "user", content: question },
    ],
    packed.text,
  );
  const answer = await ollamaChat(messages, { model: options.model });
  console.log(answer.content.trim());
  const decisions = retrieval.resolution?.decisions?.length ?? 0;
  const intentCount = retrieval.selection?.intent_count ?? 1;
  const intentsCovered = retrieval.selection?.intents_covered ?? intentCount;
  const intentSummary = intentCount > 1
    ? `; intents ${intentsCovered}/${intentCount}`
    : "";
  const evidence = retrieval.selection?.evidence;
  const evidenceSummary = evidence
    ? `; evidence ${evidence.distinct_evidence_count} distinct/${evidence.distinct_publisher_count} publisher(s)`
    : "";
  const answerability = retrieval.selection?.answerability;
  const answerabilitySummary = answerability
    ? `; answerability ${answerability.status}`
    : "";
  const overlap = retrieval.selection?.content_overlap;
  const overlapSummary = overlap?.overlapping_pair_count
    ? `; overlap ${overlap.overlapping_pair_count} pair(s)/${overlap.distinct_detail_pair_count} with delta`
    : "";
  const gate = retrieval.selection?.relevance_gate;
  const gateSummary = gate
    ? `; gate ${gate.kept_count}/${gate.original_count} kept @ semantic>=${gate.minimum_semantic_score}`
    : "";
  const packingSummary = `; context ${packed.diagnostics.used_chars}/${packed.diagnostics.budget_chars} chars (~${packed.diagnostics.approximate_tokens} tokens), optional omitted=${packed.diagnostics.omitted_optional_count}${packed.diagnostics.hard_minimum_exceeded ? ", hard minimum exceeded" : ""}`;
  console.error(`\n[Velvet Signal: ${retrieval.mode}; ${retrieval.results.length} claim(s) retrieved: ${retrieval.results.map((item) => `${item.patch_id}/${item.claim_id}`).join(", ") || "none"}; ${decisions} relationship decision(s)${intentSummary}${evidenceSummary}${answerabilitySummary}${overlapSummary}${gateSummary}${packingSummary}]`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "download-all") return commandDownloadAll();
  if (command === "release") return commandRelease(args);
  if (command === "release-all") return commandReleaseAll(args);
  if (command === "list") return commandList();
  if (command === "inspect") return commandInspect(args);
  if (command === "ask") return commandAsk(args);
  console.log([
    "Velvet Signal local memory bridge",
    "",
    "  download-all                       Download every published patch without activating it",
    "  release <patch-id>                 Explicitly release and store a patch locally",
    "  release-all --confirm              Debug: release every current downloaded patch",
    "  list                               List downloaded/released patches and activation state",
    "  inspect [--lexical] <question>     Show retrieved claims without calling a chat model",
    "  ask --model <name> [--context-budget <chars>] <question>",
    "                                     Retrieve compact current context and ask a local Ollama model",
    "",
    "Environment: VELVET_PUBLIC_URL, VELVET_LOCAL_STORE, OLLAMA_HOST, OLLAMA_MODEL, VELVET_EMBED_MODEL, VELVET_MIN_SEMANTIC_SCORE",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
