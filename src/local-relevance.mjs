import { assessRetrievalAnswerability } from "./answerability-rag.mjs";

export const DEFAULT_MIN_SEMANTIC_RELEVANCE = 0.55;

export const LOCAL_AGENT_SYSTEM_MESSAGE = [
  "You are a local language model being used through Velvet Signal.",
  "Velvet Signal is an AI publication and local context bridge that gives language models user-approved, time-bounded factual patches with provenance and expiry metadata.",
  "It is software/publication infrastructure, not a consumer-product brand.",
  "If the user asks what Velvet Signal is, answer from this description rather than guessing from the name.",
  "Only treat retrieved publication claims as factual updates when they are actually included in the current prompt.",
  "Do not invent unrelated products, brands, features, or claims to fill missing Velvet Signal context.",
].join(" ");

const LOCAL_QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "about", "according", "be", "been",
  "but", "by", "can", "could", "did", "do", "does", "for", "from", "had",
  "has", "have", "how", "i", "if", "in", "is", "it", "its", "may", "me",
  "my", "of", "on", "or", "our", "please", "say", "says", "should", "so",
  "that", "the", "their", "them", "there", "these", "they", "this", "to",
  "tell", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
]);

export function normalizeLocalRetrievalQuery(value) {
  const stripped = String(value ?? "")
    .replace(/\bvelvet\s+signal\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = stripped
    .toLowerCase()
    .normalize("NFKD")
    .match(/[a-z0-9]+/g) ?? [];
  const meaningful = tokens.filter((token) => !LOCAL_QUERY_STOP_WORDS.has(token));
  return meaningful.length > 0 ? stripped : "";
}

function threshold(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return DEFAULT_MIN_SEMANTIC_RELEVANCE;
  return Math.max(0, Math.min(1, parsed));
}

function resultPasses(item, minimumSemantic) {
  const lexical = Number(item?.lexical_score);
  if (Number.isFinite(lexical) && lexical > 0) return true;
  const semantic = Number(item?.semantic_score);
  return Number.isFinite(semantic) && semantic >= minimumSemantic;
}

function filteredIntents(selection, keptIds) {
  if (!Array.isArray(selection?.intents)) return selection?.intents;
  return selection.intents.map((intent) => ({
    ...intent,
    covered_by: Array.isArray(intent?.covered_by)
      ? intent.covered_by.filter((id) => keptIds.has(id))
      : [],
  }));
}

function emptyOverlap(selection) {
  const prior = selection?.content_overlap;
  if (!prior || typeof prior !== "object") return prior;
  return {
    ...prior,
    analyzed_claim_count: 0,
    candidate_pair_count: 0,
    overlapping_pair_count: 0,
    distinct_detail_pair_count: 0,
    explicit_relationship_pair_count: 0,
    pairs: [],
    groups: [],
  };
}

export function applyLocalRelevanceGate(retrieval, options = {}) {
  const minimumSemantic = threshold(options.minSemantic);
  const original = Array.isArray(retrieval?.results) ? retrieval.results : [];
  if (original.length === 0) {
    return {
      ...retrieval,
      selection: {
        ...(retrieval?.selection ?? {}),
        relevance_gate: {
          minimum_semantic_score: minimumSemantic,
          original_count: 0,
          kept_count: 0,
          dropped_count: 0,
        },
      },
    };
  }

  const results = original.filter((item) => resultPasses(item, minimumSemantic));
  const keptIds = new Set(results.map((item) => item?.id).filter(Boolean));
  const droppedCount = original.length - results.length;
  if (droppedCount === 0) {
    return {
      ...retrieval,
      selection: {
        ...(retrieval?.selection ?? {}),
        relevance_gate: {
          minimum_semantic_score: minimumSemantic,
          original_count: original.length,
          kept_count: results.length,
          dropped_count: 0,
        },
      },
    };
  }

  const selection = {
    ...(retrieval?.selection ?? {}),
    intents: filteredIntents(retrieval?.selection, keptIds),
    candidates_considered: results.length,
    relevance_gate: {
      minimum_semantic_score: minimumSemantic,
      original_count: original.length,
      kept_count: results.length,
      dropped_count: droppedCount,
    },
  };

  if (results.length === 0) {
    selection.evidence = undefined;
    selection.content_overlap = emptyOverlap(retrieval?.selection);
  }

  const resolution = results.length === 0
    ? { decisions: [], history: [], warnings: [] }
    : retrieval?.resolution;

  const sanitized = {
    ...retrieval,
    results,
    selection,
    resolution,
  };
  sanitized.selection.answerability = assessRetrievalAnswerability(sanitized);
  return sanitized;
}
