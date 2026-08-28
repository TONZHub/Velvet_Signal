import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { formatRetrievedContext, injectRetrievedContext, patchIsActive, retrieveClaims } from "./rag.mjs";
import { ollamaChat, ollamaEmbed } from "./ollama.mjs";

const DEFAULT_PUBLIC_URL = "https://velvetsignal.lol";

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
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { schema_version: 1, releases: [] };
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

async function releasePatch(patchId) {
  const publicUrl = String(process.env.VELVET_PUBLIC_URL ?? DEFAULT_PUBLIC_URL).replace(/\/$/, "");
  const response = await fetch(`${publicUrl}/api/velvet/release`, {
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
    else if (current === "--lexical") options.lexicalOnly = true;
    else values.push(current);
  }
  return { values, options };
}

async function activePatches() {
  const store = await readStore();
  return store.releases.map((entry) => entry.patch).filter((patch) => patchIsActive(patch));
}

async function retrieve(question, options) {
  const patches = await activePatches();
  const embed = options.lexicalOnly
    ? undefined
    : (input) => ollamaEmbed(input, { model: options.embedModel });
  return retrieveClaims(question, patches, {
    limit: Number.isInteger(options.limit) ? options.limit : 3,
    embed,
  });
}

async function commandRelease(args) {
  if (!args[0]) throw new Error("Usage: npm run local -- release <patch-id>");
  const patch = await releasePatch(args[0]);
  console.log(`Stored ${patch.patch_id} (${patch.title}) until ${patch.valid_until}.`);
}

async function commandList() {
  const store = await readStore();
  if (store.releases.length === 0) {
    console.log("No locally released Velvet Signal patches are stored yet.");
    return;
  }
  for (const entry of store.releases) {
    const patch = entry.patch;
    console.log(`${patchIsActive(patch) ? "active" : "inactive"}\t${patch.patch_id}\t${patch.title}`);
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
  const context = formatRetrievedContext(retrieval);
  const messages = injectRetrievedContext([{ role: "user", content: question }], context);
  const answer = await ollamaChat(messages, { model: options.model });
  console.log(answer.content.trim());
  console.error(`\n[Velvet Signal: ${retrieval.mode}; ${retrieval.results.length} claim(s) retrieved: ${retrieval.results.map((item) => `${item.patch_id}/${item.claim_id}`).join(", ") || "none"}]`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "release") return commandRelease(args);
  if (command === "list") return commandList();
  if (command === "inspect") return commandInspect(args);
  if (command === "ask") return commandAsk(args);
  console.log([
    "Velvet Signal local memory bridge",
    "",
    "  release <patch-id>                 Explicitly release and store a patch locally",
    "  list                               List locally stored patches",
    "  inspect [--lexical] <question>     Show retrieved claims without calling a chat model",
    "  ask --model <name> <question>      Retrieve context and ask a local Ollama model",
    "",
    "Environment: VELVET_PUBLIC_URL, VELVET_LOCAL_STORE, OLLAMA_HOST, OLLAMA_MODEL, VELVET_EMBED_MODEL",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
