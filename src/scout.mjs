import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generatedIssuesPath, PUBLIC_SCOUT_DESKS } from "./catalog.mjs";
import { LAUNCH_ISSUES } from "./launch-issues.mjs";
import { composeEdition, parseComposeEditionInput } from "./velvet.mjs";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_ARCHIVE_PER_DESK = 12;

export const SCOUT_CONFIG = {
  "model-watch": {
    desk: "Model Watch",
    icon: "⌁",
    color: "#ff719f",
    scope: "AI models and agent interfaces",
    query:
      "official AI model releases model cards API changes browser agent interfaces announced or updated this week",
    brief:
      "Choose the most consequential current model or agent-interface change for builders and agent users. Preserve exact names, dates, availability, and experimental status.",
    topic: "news",
    timeRange: "week",
    includeDomains: [
      "openai.com",
      "anthropic.com",
      "ai.google.dev",
      "deepmind.google",
      "mistral.ai",
      "huggingface.co",
      "developer.chrome.com",
      "github.blog",
      "openrouter.ai",
      "z.ai",
    ],
  },
  pantry: {
    desk: "The Pantry",
    icon: "◒",
    color: "#f1cf69",
    scope: "Food safety",
    query:
      "new or updated official food safety guidance refrigeration leftovers cooking storage recalls household kitchen",
    brief:
      "Turn one authoritative food-safety update into a practical kitchen edition. Never decide whether a specific food is safe when storage history is missing.",
    topic: "general",
    timeRange: "year",
    allowTimelessFallback: true,
    fallbackQuery:
      "site:fsis.usda.gov leftovers food safety refrigeration storage guidance",
    includeDomains: ["fsis.usda.gov", "fda.gov", "foodsafety.gov", "cdc.gov"],
  },
  wellbeing: {
    desk: "Wellbeing",
    icon: "☾",
    color: "#a993ff",
    scope: "General wellbeing",
    query:
      "new or updated official general wellbeing guidance sleep stress rest movement daily routines public health",
    brief:
      "Explain one useful general-wellbeing update without diagnosis, moral judgment, or individualized medical advice. Keep individual variation visible.",
    topic: "general",
    timeRange: "year",
    allowTimelessFallback: true,
    fallbackQuery:
      "site:nhlbi.nih.gov healthy sleep habits sleep hygiene official guidance",
    includeDomains: ["cdc.gov", "nih.gov", "who.int", "nhlbi.nih.gov"],
  },
  culture: {
    desk: "Culture Desk",
    icon: "✺",
    color: "#67d6c0",
    scope: "Culture signals",
    query:
      "emerging internet language meme format online culture reference gaining attention this week explained with provenance",
    brief:
      "Choose one current cultural signal supported by the packets. Explain its observed use and ambiguity without declaring a universal meaning or turning it into a user identity.",
    topic: "news",
    timeRange: "week",
  },
  maker: {
    desk: "Maker Edition",
    icon: "⌘",
    color: "#ff9466",
    scope: "AI product engineering",
    query:
      "official release notes agent tooling local LLM framework web API developer platform changes this week",
    brief:
      "Choose the most useful current tooling or platform change for builders. Preserve versions, dates, deprecations, compatibility limits, and security implications.",
    topic: "news",
    timeRange: "week",
    includeDomains: [
      "github.blog",
      "github.com",
      "developer.chrome.com",
      "nodejs.org",
      "deno.com",
      "bun.sh",
      "ai.google.dev",
      "openrouter.ai",
      "docs.tavily.com",
      "modelcontextprotocol.io",
    ],
  },
};

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeExcerpt(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function publisherFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

function sourcePackets(deskId, searchResponse) {
  const code = deskId
    .split("-")
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const seen = new Set();
  const packets = [];
  for (const result of searchResponse.results ?? []) {
    if (!nonempty(result?.title) || !nonempty(result?.url)) continue;
    let url;
    try {
      url = new URL(result.url);
    } catch {
      continue;
    }
    if (!["https:", "http:"].includes(url.protocol) || seen.has(url.href)) continue;
    const excerpt = normalizeExcerpt(result.content ?? result.raw_content);
    if (!excerpt) continue;
    seen.add(url.href);
    packets.push({
      id: `${code}-SRC-${packets.length + 1}`,
      title: result.title.trim().slice(0, 240),
      url: url.href,
      excerpt,
      publishedAt: nonempty(result.published_date)
        ? result.published_date.trim().slice(0, 40)
        : undefined,
    });
    if (packets.length === 5) break;
  }
  return packets;
}

function fingerprintSources(sources) {
  const material = sources
    .map((source) => `${source.url}\n${normalizeExcerpt(source.excerpt).slice(0, 700)}`)
    .sort()
    .join("\n---\n");
  return createHash("sha256").update(material).digest("hex");
}

export async function tavilySearch(config, options = {}) {
  const apiKey = options.apiKey ?? process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is required.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: config.query,
      search_depth: config.searchDepth ?? "basic",
      chunks_per_source: 2,
      max_results: config.maxResults ?? 5,
      topic: config.topic,
      time_range: config.timeRange,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      safe_search: true,
      include_usage: true,
      ...(config.includeDomains ? { include_domains: config.includeDomains } : {}),
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 300);
    throw new Error(`Tavily returned ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return response.json();
}

function issueNumber(deskId, generatedIssues) {
  const numbers = [...LAUNCH_ISSUES, ...generatedIssues]
    .filter((issue) => issue.deskId === deskId)
    .map((issue) => Number.parseInt(issue.issue, 10))
    .filter(Number.isFinite);
  return String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(3, "0");
}

function displayDate(date) {
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  return `${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, "0")} · ${date.getUTCFullYear()}`;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function confidenceLabel(claims) {
  if (claims.some((claim) => claim.status === "needs-review" || claim.confidence === "low")) {
    return "Mixed";
  }
  if (claims.every((claim) => claim.confidence === "high")) return "High";
  return "Medium";
}

export function priorClaimsForDesk(deskId, catalog) {
  const issues = [
    ...(Array.isArray(catalog?.issues) ? catalog.issues : []),
    ...LAUNCH_ISSUES,
  ]
    .filter((issue) => issue.deskId === deskId)
    .sort((left, right) =>
      String(right.publishedAt ?? "").localeCompare(
        String(left.publishedAt ?? ""),
      ),
    );
  const priorClaims = [];
  const seen = new Set();
  for (const issue of issues) {
    for (const claim of Array.isArray(issue.claims) ? issue.claims : []) {
      if (!nonempty(issue.id) || !nonempty(claim?.id) || !nonempty(claim?.claim)) {
        continue;
      }
      if (["withdrawn", "rejected", "superseded"].includes(claim.status)) {
        continue;
      }
      const id = `${issue.id}:${claim.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      priorClaims.push({
        id,
        statement: claim.claim,
        publishedAt: issue.publishedAt,
      });
      if (priorClaims.length === 24) return priorClaims;
    }
  }
  return priorClaims;
}

function editionToIssue(deskId, edition, sources, searchResponse, catalog, now) {
  const config = SCOUT_CONFIG[deskId];
  const number = issueNumber(deskId, catalog.issues);
  const expires = addDays(now, edition.validity_days);
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index]));
  const words = edition.editorial.join(" ").split(/\s+/).filter(Boolean).length;
  return {
    id: `${deskId}-${number}`,
    deskId,
    desk: config.desk,
    icon: config.icon,
    issue: number,
    version: "1.0.0",
    date: displayDate(now),
    publishedAt: now.toISOString(),
    color: config.color,
    title: edition.title,
    kicker: edition.kicker,
    dek: edition.dek,
    readTime: `${Math.max(3, Math.ceil(words / 200))} min read`,
    validity: `${edition.validity_days} days`,
    expires: dateOnly(expires),
    confidence: confidenceLabel(edition.claims),
    scope: config.scope,
    editor: "OpenRouter · GLM 5.3 Flash",
    inputPolicy: "Scheduled Tavily source packets",
    editorial: edition.editorial,
    pullquote: edition.pull_quote,
    sources: sources.map((source) => ({
      id: source.id,
      name: source.title,
      publisher: publisherFromUrl(source.url),
      url: source.url,
      checked: dateOnly(now),
      publishedAt: source.publishedAt,
    })),
    claims: edition.claims.map((claim, index) => {
      const relationships = Array.isArray(claim.relationships)
        ? claim.relationships
        : [];
      return {
        id: `${deskId
          .split("-")
          .map((part) => part[0])
          .join("")
          .toUpperCase()}-${String(index + 1).padStart(2, "0")}`,
        claim: claim.statement,
        source: sourceIndex.get(claim.source_ids[0]) ?? 0,
        sourceIds: claim.source_ids,
        status: claim.status,
        confidence: claim.confidence,
        ...(relationships.length ? { relationships } : {}),
      };
    }),
    toneNotes: edition.tone_notes,
    tags: edition.tags,
    generated: true,
    scout: {
      provider: "tavily",
      request_id: searchResponse.request_id ?? null,
      credits: searchResponse.usage?.credits ?? null,
      search_mode: searchResponse.velvet_search_mode ?? "bounded",
    },
  };
}

async function readCatalog(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return {
      schema_version: 1,
      generated_at: value.generated_at ?? null,
      desks: value.desks && typeof value.desks === "object" ? value.desks : {},
      issues: Array.isArray(value.issues) ? value.issues : [],
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { schema_version: 1, generated_at: null, desks: {}, issues: [] };
    }
    throw error;
  }
}

async function writeCatalog(path, catalog) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function runScout(options = {}) {
  const now = options.now ?? (() => new Date());
  const searchImpl = options.searchImpl ?? tavilySearch;
  const composeImpl = options.composeImpl ?? composeEdition;
  const catalogPath = options.catalogPath ?? generatedIssuesPath;
  const catalog = await readCatalog(catalogPath);
  const summary = {
    checked: [],
    published: [],
    unchanged: [],
    fallback: [],
    failed: [],
  };
  let changed = false;

  for (const deskId of PUBLIC_SCOUT_DESKS) {
    const config = SCOUT_CONFIG[deskId];
    summary.checked.push(deskId);
    try {
      let searchResponse = await searchImpl(config, { deskId, fallback: false });
      let sources = sourcePackets(deskId, searchResponse);
      if (!sources.length && config.allowTimelessFallback) {
        const fallbackConfig = {
          ...config,
          query: config.fallbackQuery ?? config.query,
          timeRange: undefined,
          includeDomains: undefined,
          searchDepth: "advanced",
          maxResults: 8,
        };
        const fallbackResponse = await searchImpl(
          fallbackConfig,
          { deskId, fallback: true },
        );
        searchResponse = {
          ...fallbackResponse,
          velvet_search_mode: "timeless-official-fallback",
        };
        sources = sourcePackets(deskId, searchResponse);
        summary.fallback.push(deskId);
      }
      if (!sources.length) throw new Error("Tavily returned no usable source packets.");
      const fingerprint = fingerprintSources(sources);
      if (catalog.desks[deskId]?.fingerprint === fingerprint) {
        summary.unchanged.push(deskId);
        continue;
      }
      const input = parseComposeEditionInput({
        desk: deskId,
        brief: config.brief,
        sources,
        priorClaims: priorClaimsForDesk(deskId, catalog),
      });
      const edition = await composeImpl(input);
      const timestamp = now();
      const issue = editionToIssue(
        deskId,
        edition,
        sources,
        searchResponse,
        catalog,
        timestamp,
      );
      catalog.issues.unshift(issue);
      const keep = [];
      const counts = new Map();
      for (const candidate of catalog.issues) {
        const count = counts.get(candidate.deskId) ?? 0;
        if (count >= MAX_ARCHIVE_PER_DESK) continue;
        keep.push(candidate);
        counts.set(candidate.deskId, count + 1);
      }
      catalog.issues = keep;
      catalog.desks[deskId] = {
        fingerprint,
        latest_patch_id: issue.id,
        published_at: timestamp.toISOString(),
        tavily_request_id: searchResponse.request_id ?? null,
      };
      catalog.generated_at = timestamp.toISOString();
      summary.published.push(issue.id);
      changed = true;
    } catch (error) {
      summary.failed.push({
        desk: deskId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (changed) await writeCatalog(catalogPath, catalog);
  if (summary.failed.length === PUBLIC_SCOUT_DESKS.length) {
    throw new Error(`Every scout desk failed: ${JSON.stringify(summary.failed)}`);
  }
  return { changed, summary, catalog };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  runScout()
    .then(({ changed, summary }) => {
      console.log(JSON.stringify({ changed, ...summary }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
