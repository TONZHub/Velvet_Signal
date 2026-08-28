import { formatRetrievedContext, retrieveClaims } from "./rag.mjs";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "is", "it", "its", "may", "my", "of", "on", "or", "our",
  "should", "so", "that", "the", "their", "them", "there", "these", "they",
  "this", "to", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
]);

const QUESTION_CUE = "(?:can|could|should|is|are|do|does|did|what|when|where|why|how|which|who|will|would|may|must|if)";
const INTENT_MATCH_THRESHOLD = 0.34;
const MAX_INTENTS = 4;
const MAX_CANDIDATES = 12;
const RELATIONSHIP_COMPANION_BONUS = 0.12;

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenMatches(left, right) {
  if (left === right) return true;
  if (left.length >= 7 && right.length >= 7) {
    return left.slice(0, 6) === right.slice(0, 6);
  }
  return false;
}

function lexicalIntentScore(intent, text) {
  const queryTokens = tokenize(intent);
  const documentTokens = tokenize(text);
  if (queryTokens.length === 0 || documentTokens.length === 0) return 0;
  let matched = 0;
  for (const queryToken of queryTokens) {
    if (documentTokens.some((token) => tokenMatches(queryToken, token))) {
      matched += 1;
    }
  }
  return matched / queryTokens.length;
}

function tokenJaccard(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  let intersection = 0;
  const used = new Set();
  for (const leftToken of leftTokens) {
    const index = rightTokens.findIndex(
      (rightToken, candidateIndex) =>
        !used.has(candidateIndex) && tokenMatches(leftToken, rightToken),
    );
    if (index >= 0) {
      used.add(index);
      intersection += 1;
    }
  }
  const union = leftTokens.length + rightTokens.length - intersection;
  return union > 0 ? intersection / union : 0;
}

function candidateText(item) {
  return [item.title, item.scope, item.statement].filter(Boolean).join("\n");
}

function relationshipCompanionType(left, right) {
  const companionTypes = new Set(["narrows", "confirms"]);
  for (const relationship of Array.isArray(left?.relationships)
    ? left.relationships
    : []) {
    if (
      companionTypes.has(relationship.type) &&
      relationship.target_id === right?.id
    ) {
      return relationship.type;
    }
  }
  for (const relationship of Array.isArray(right?.relationships)
    ? right.relationships
    : []) {
    if (
      companionTypes.has(relationship.type) &&
      relationship.target_id === left?.id
    ) {
      return relationship.type;
    }
  }
  return null;
}

export function splitQueryIntents(query) {
  const normalized = normalizeWhitespace(query);
  if (!normalized) return [];
  const withBreaks = normalized
    .replace(/\?\s*(?=\S)/g, "?\n")
    .replace(/;\s*/g, "\n")
    .replace(
      new RegExp(`,?\\s+(?:and|but|while)\\s+(?=${QUESTION_CUE}\\b)`, "gi"),
      "\n",
    );
  const segments = withBreaks
    .split(/\n+/)
    .map((segment) => segment.replace(/[?]+$/g, "").trim())
    .filter((segment) => tokenize(segment).length > 0);
  if (segments.length <= 1) return [normalized];
  const unique = [];
  const seen = new Set();
  for (const segment of segments) {
    const key = tokenize(segment).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(segment);
    if (unique.length === MAX_INTENTS) break;
  }
  return unique.length > 1 ? unique : [normalized];
}

function enrichCandidates(candidates, intents) {
  return candidates.map((item, index) => {
    const intentScores = intents.map((intent) =>
      lexicalIntentScore(intent, candidateText(item)),
    );
    const matchedIntents = intentScores
      .map((score, intentIndex) => ({ score, intentIndex }))
      .filter(({ score }) => score >= INTENT_MATCH_THRESHOLD)
      .map(({ intentIndex }) => intentIndex);
    return {
      ...item,
      intent_scores: intentScores,
      matched_intents: matchedIntents,
      _candidate_index: index,
    };
  });
}

function selectForIntentCoverage(candidates, intents, limit) {
  const requestedLimit = Math.max(1, limit);
  if (!candidates.length) return [];
  const maxBaseScore = Math.max(
    0,
    ...candidates.map((item) => Number(item.score) || 0),
  );
  const selected = [];
  const remaining = [...candidates];
  const covered = new Set();

  while (remaining.length && selected.length < requestedLimit) {
    if (selected.length === 0) {
      const first = remaining.shift();
      const selectedItem = {
        ...first,
        multi_intent_score: 1,
        multi_intent_redundancy: 0,
        selection_reason: first.selection_reason ?? "top-relevance",
      };
      delete selectedItem._candidate_index;
      selected.push(selectedItem);
      for (const index of selectedItem.matched_intents) covered.add(index);
      continue;
    }

    const uncovered = intents
      .map((_, index) => index)
      .filter((index) => !covered.has(index));
    const coverageCandidates = uncovered.length
      ? remaining.filter((item) =>
          item.matched_intents.some((index) => uncovered.includes(index)),
        )
      : [];
    const eligible = coverageCandidates.length ? coverageCandidates : remaining;
    const scored = eligible.map((item) => {
      const uncoveredMatches = item.matched_intents.filter((index) =>
        uncovered.includes(index),
      );
      const bestUncovered = uncoveredMatches.length
        ? Math.max(...uncoveredMatches.map((index) => item.intent_scores[index]))
        : 0;
      const relevance = maxBaseScore > 0
        ? Math.max(0, Math.min(1, (Number(item.score) || 0) / maxBaseScore))
        : 0;
      let redundancy = 0;
      let companionType = null;
      for (const chosen of selected) {
        const relationship = relationshipCompanionType(item, chosen);
        if (relationship && !companionType) companionType = relationship;
        if (!relationship) {
          redundancy = Math.max(
            redundancy,
            tokenJaccard(item.statement, chosen.statement),
          );
        }
      }
      const coverageBonus = uncoveredMatches.length
        ? 0.48 * bestUncovered + 0.08 * Math.min(2, uncoveredMatches.length)
        : 0;
      const companionBonus = companionType ? RELATIONSHIP_COMPANION_BONUS : 0;
      const score = 0.52 * relevance + coverageBonus + companionBonus - 0.16 * redundancy;
      return {
        item,
        score,
        uncoveredMatches,
        redundancy,
        companionType,
      };
    });
    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if ((right.item.score ?? 0) !== (left.item.score ?? 0)) {
        return (right.item.score ?? 0) - (left.item.score ?? 0);
      }
      return left.item._candidate_index - right.item._candidate_index;
    });
    const winner = scored[0];
    const selectedItem = {
      ...winner.item,
      multi_intent_score: winner.score,
      multi_intent_redundancy: winner.redundancy,
      selection_reason: winner.uncoveredMatches.length
        ? `intent-coverage:${winner.uncoveredMatches.map((index) => index + 1).join(",")}`
        : winner.companionType
          ? `relationship-companion:${winner.companionType}`
          : winner.item.selection_reason ?? "relevance-fallback",
    };
    delete selectedItem._candidate_index;
    selected.push(selectedItem);
    for (const index of selectedItem.matched_intents) covered.add(index);
    const remainingIndex = remaining.findIndex((item) => item.id === winner.item.id);
    remaining.splice(remainingIndex, 1);
  }
  return selected;
}

function coverageReport(intents, results) {
  return intents.map((intent, index) => ({
    id: index + 1,
    text: intent,
    covered_by: results
      .filter((item) => item.matched_intents.includes(index))
      .map((item) => item.id),
  }));
}

export async function retrieveMultiIntentClaims(query, patches, options = {}) {
  const intents = splitQueryIntents(query);
  const requestedLimit = Number.isInteger(options.limit)
    ? Math.max(1, options.limit)
    : 3;
  const retrieveImpl = options.retrieveImpl ?? retrieveClaims;
  const explicitCandidateLimit = Number.isInteger(options.candidateLimit)
    ? Math.max(requestedLimit, options.candidateLimit)
    : null;
  const retrieveOptions = { ...options };
  delete retrieveOptions.retrieveImpl;
  delete retrieveOptions.candidateLimit;

  if (intents.length < 2 || requestedLimit < 2) {
    return retrieveImpl(query, patches, {
      ...retrieveOptions,
      limit: requestedLimit,
    });
  }

  const poolLimit = Math.min(
    MAX_CANDIDATES,
    explicitCandidateLimit ?? Math.max(requestedLimit * intents.length, requestedLimit * 2),
  );
  const base = await retrieveImpl(query, patches, {
    ...retrieveOptions,
    limit: poolLimit,
  });
  const candidates = Array.isArray(base?.results) ? base.results : [];
  if (!candidates.length) {
    return {
      ...base,
      selection: {
        ...(base?.selection ?? {}),
        strategy: base?.selection?.strategy ?? "multi-intent-empty",
        intent_count: intents.length,
        intents: coverageReport(intents, []),
        candidate_limit: poolLimit,
      },
    };
  }

  const enriched = enrichCandidates(candidates, intents);
  const results = selectForIntentCoverage(enriched, intents, requestedLimit);
  const coverage = coverageReport(intents, results);
  const resultIds = new Set(results.map((item) => item.id));
  const decisions = Array.isArray(base?.resolution?.decisions)
    ? base.resolution.decisions.filter(
        (decision) =>
          decision.action === "target_withheld_by_historical_tombstone" ||
          resultIds.has(decision.source_id) ||
          resultIds.has(decision.target_id),
      )
    : [];
  const historyIds = new Set(
    decisions.flatMap((decision) => [decision.source_id, decision.target_id]),
  );
  const resolution = base?.resolution
    ? {
        ...base.resolution,
        decisions,
        history: Array.isArray(base.resolution.history)
          ? base.resolution.history.filter((item) => historyIds.has(item.id))
          : [],
        warnings: Array.isArray(base.resolution.warnings)
          ? base.resolution.warnings.filter(
              (warning) =>
                resultIds.has(warning.source_id) ||
                resultIds.has(warning.target_id),
            )
          : [],
      }
    : base?.resolution;
  return {
    ...base,
    results,
    resolution,
    selection: {
      ...(base?.selection ?? {}),
      strategy: "multi-intent-coverage",
      base_strategy: base?.selection?.strategy ?? null,
      intent_count: intents.length,
      intents: coverage,
      intents_covered: coverage.filter((intent) => intent.covered_by.length > 0).length,
      candidate_limit: poolLimit,
      candidates_considered: candidates.length,
      intent_scoring: "deterministic-lexical-over-core-candidates",
    },
  };
}

export function formatMultiIntentContext(retrieval) {
  const base = formatRetrievedContext(retrieval);
  if (!base || retrieval?.selection?.strategy !== "multi-intent-coverage") {
    return base;
  }
  const intents = Array.isArray(retrieval.selection.intents)
    ? retrieval.selection.intents
    : [];
  if (!intents.length) return base;
  const lines = [
    "MULTI-INTENT QUERY FACETS",
    "The user asked a compound question. Address each listed facet that has retrieved support; do not let the first facet crowd out later facets.",
    "If a facet has covered_by=none, do not fill it from stale history. If the relationship trail shows an update gap for that facet, say that current publication context is unavailable.",
    ...intents.map((intent) =>
      `[FACET ${intent.id}] ${intent.text} | covered_by=${intent.covered_by.join(",") || "none"}`,
    ),
    "",
  ];
  return base.replace(
    "VELVET SIGNAL RETRIEVED CONTEXT\n",
    `VELVET SIGNAL RETRIEVED CONTEXT\n${lines.join("\n")}`,
  );
}
