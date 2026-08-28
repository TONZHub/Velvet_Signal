import {
  normalizeClaimRelationships,
  relationshipExplanation,
} from "./claim-relations.mjs";

const DEFAULT_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "is", "it", "its", "may", "my", "of", "on", "or", "our",
  "should", "so", "that", "the", "their", "them", "there", "these", "they",
  "this", "to", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
]);

const DEFAULT_DIVERSITY_LAMBDA = 0.72;
const RELATIONSHIP_COMPANION_BONUS = 0.12;

function endOfUtcDay(date) {
  const parsed = Date.parse(`${date}T23:59:59.999Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function patchIsActive(patch, now = new Date()) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  if (patch.delivery?.status !== "delivered" || patch.delivery?.approved !== true) {
    return false;
  }
  if (typeof patch.valid_until !== "string") return false;
  const expiresAt = endOfUtcDay(patch.valid_until);
  return Number.isFinite(expiresAt) && expiresAt >= now.getTime();
}

function patchIsReleased(patch) {
  return Boolean(
    patch &&
      typeof patch === "object" &&
      !Array.isArray(patch) &&
      patch.delivery?.status === "delivered" &&
      patch.delivery?.approved === true,
  );
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !DEFAULT_STOP_WORDS.has(token));
}

function lexicalScore(query, text) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const documentTokens = tokenize(text);
  if (documentTokens.length === 0) return 0;
  const counts = new Map();
  for (const token of documentTokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let matched = 0;
  for (const token of queryTokens) {
    const count = counts.get(token) ?? 0;
    if (count > 0) matched += 1 + Math.log1p(count) * 0.15;
  }
  return matched / queryTokens.length;
}

function cosineSimilarity(left, right) {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length !== right.length ||
    left.length === 0
  ) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function tokenJaccard(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function chunkText(chunk) {
  return [
    chunk.desk,
    chunk.title,
    chunk.scope,
    chunk.statement,
    chunk.relationship_search_text,
  ]
    .filter(Boolean)
    .join("\n");
}

function relationshipCompanionType(left, right) {
  const companionTypes = new Set(["narrows", "confirms"]);
  for (const relationship of Array.isArray(left.relationships)
    ? left.relationships
    : []) {
    if (
      companionTypes.has(relationship.type) &&
      relationship.target_id === right.id
    ) {
      return relationship.type;
    }
  }
  for (const relationship of Array.isArray(right.relationships)
    ? right.relationships
    : []) {
    if (
      companionTypes.has(relationship.type) &&
      relationship.target_id === left.id
    ) {
      return relationship.type;
    }
  }
  return null;
}

function candidateSimilarity(left, right, vectorsById) {
  const lexical = tokenJaccard(left.statement, right.statement);
  const leftVector = vectorsById?.get(left.id);
  const rightVector = vectorsById?.get(right.id);
  if (!leftVector || !rightVector) return lexical;
  return Math.max(
    lexical,
    clampUnit(cosineSimilarity(leftVector, rightVector)),
  );
}

function compareSelectionCandidates(left, right) {
  if (right.selection_score !== left.selection_score) {
    return right.selection_score - left.selection_score;
  }
  if (right.item.score !== left.item.score) return right.item.score - left.item.score;
  const recency = String(right.item.published_at ?? "").localeCompare(
    String(left.item.published_at ?? ""),
  );
  if (recency !== 0) return recency;
  return left.index - right.index;
}

function selectDiverseResults(candidates, limit, options = {}) {
  const requestedLimit = Math.max(1, limit);
  const pool = Array.isArray(candidates) ? candidates : [];
  const lambda = Number.isFinite(options.lambda)
    ? Math.max(0.5, Math.min(1, Number(options.lambda)))
    : DEFAULT_DIVERSITY_LAMBDA;
  if (pool.length === 0) {
    return {
      results: [],
      strategy: "relevance",
      lambda,
    };
  }

  const topScore = Math.max(0, ...pool.map((item) => Number(item.score) || 0));
  const selected = [];
  const remaining = pool.map((item, index) => ({ item, index }));
  const useDiversity = pool.length > requestedLimit && topScore > 0;

  while (remaining.length > 0 && selected.length < requestedLimit) {
    const scored = remaining.map(({ item, index }) => {
      const relevance = topScore > 0 ? clampUnit(item.score / topScore) : 0;
      let redundancy = 0;
      let companionType = null;
      for (const chosen of selected) {
        const relationship = relationshipCompanionType(item, chosen);
        if (relationship && !companionType) companionType = relationship;
        if (!relationship && useDiversity) {
          redundancy = Math.max(
            redundancy,
            candidateSimilarity(item, chosen, options.vectorsById),
          );
        }
      }
      const companionBonus = companionType && useDiversity
        ? RELATIONSHIP_COMPANION_BONUS
        : 0;
      const selectionScore = selected.length === 0 || !useDiversity
        ? relevance + companionBonus
        : lambda * relevance - (1 - lambda) * redundancy + companionBonus;
      return {
        item,
        index,
        relevance,
        redundancy,
        companionType,
        selection_score: selectionScore,
      };
    });

    scored.sort(compareSelectionCandidates);
    const winner = scored[0];
    selected.push({
      ...winner.item,
      selection_score: winner.selection_score,
      redundancy_penalty: winner.redundancy,
      selection_reason:
        selected.length === 0
          ? "top-relevance"
          : winner.companionType
            ? `relationship-companion:${winner.companionType}`
            : winner.redundancy >= 0.35
              ? "relevance-with-diversity-penalty"
              : "relevance-and-coverage",
    });
    const winnerIndex = remaining.findIndex(
      (candidate) => candidate.index === winner.index,
    );
    remaining.splice(winnerIndex, 1);
  }

  return {
    results: selected,
    strategy: useDiversity ? "maximal-marginal-relevance" : "relevance",
    lambda,
  };
}

function claimRecords(patches, options = {}) {
  const now = options.now ?? new Date();
  const records = [];
  for (const patch of Array.isArray(patches) ? patches : []) {
    if (!patchIsReleased(patch)) continue;
    const patchActive = patchIsActive(patch, now);
    for (const claim of Array.isArray(patch.claims) ? patch.claims : []) {
      if (
        !claim ||
        typeof claim.statement !== "string" ||
        !claim.statement.trim()
      ) {
        continue;
      }
      const claimStatus = String(claim.status ?? "").toLowerCase();
      const claimActive = !["withdrawn", "rejected", "superseded"].includes(
        claimStatus,
      );
      const relationships = normalizeClaimRelationships(claim);
      records.push({
        id: `${patch.patch_id}:${claim.id}`,
        patch_id: patch.patch_id,
        claim_id: claim.id,
        desk: patch.desk ?? null,
        title: patch.title ?? null,
        scope: patch.scope ?? null,
        published_at: patch.published_at ?? null,
        valid_until: patch.valid_until,
        statement: claim.statement.trim(),
        status: claim.status ?? null,
        patch_active: patchActive,
        claim_active: claimActive,
        active: patchActive && claimActive,
        inactive_reason: !patchActive
          ? "patch_expired_or_ineligible"
          : !claimActive
            ? `claim_${claimStatus}`
            : null,
        relationships,
        supersedes: relationships
          .filter((relationship) => relationship.type === "replaces")
          .map((relationship) => relationship.target_id),
        source_ids: Array.isArray(claim.source_ids) ? claim.source_ids : [],
        sources: Array.isArray(patch.sources)
          ? patch.sources.filter(
              (source) =>
                Array.isArray(claim.source_ids) &&
                claim.source_ids.includes(source.id),
            )
          : [],
      });
    }
  }
  return records;
}

const claimIdCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareClaimRecency(left, right) {
  const leftTime = Date.parse(left.published_at ?? "");
  const rightTime = Date.parse(right.published_at ?? "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    if (leftTime !== rightTime) return leftTime - rightTime;
  } else if (Number.isFinite(leftTime)) {
    return 1;
  } else if (Number.isFinite(rightTime)) {
    return -1;
  }
  return claimIdCollator.compare(left.id, right.id);
}

function resolutionAction(type, targetActive, sourceActive) {
  if (type === "replaces" || type === "conflicts") {
    if (targetActive) {
      return sourceActive
        ? "target_withheld"
        : "target_withheld_by_historical_tombstone";
    }
    return "target_already_history";
  }
  return targetActive ? "both_active" : "target_already_history";
}

export function resolveClaimRelationships(patches, options = {}) {
  const records = claimRecords(patches, options);
  const byId = new Map(records.map((record) => [record.id, record]));
  const initiallyActive = records.filter((record) => record.active);
  const suppressed = new Map();
  const decisions = [];
  const warnings = [];
  const historicalTargets = new Set();
  const historicalSources = new Set();

  for (const source of records) {
    for (const relationship of source.relationships) {
      const destructive = ["replaces", "conflicts"].includes(
        relationship.type,
      );
      const sourceWithdrawn = ["claim_withdrawn", "claim_rejected"].includes(
        source.inactive_reason,
      );
      if ((!source.active && !destructive) || sourceWithdrawn) continue;
      const target = byId.get(relationship.target_id);
      if (!target) {
        warnings.push({
          code: "unknown_relationship_target",
          source_id: source.id,
          target_id: relationship.target_id,
          type: relationship.type,
          message: "The target is not present in the approved local ledger.",
        });
        continue;
      }
      if (source.id === target.id) {
        warnings.push({
          code: "self_relationship",
          source_id: source.id,
          target_id: target.id,
          type: relationship.type,
          message: "A claim cannot resolve a relationship to itself.",
        });
        continue;
      }
      if (compareClaimRecency(source, target) <= 0) {
        warnings.push({
          code: "non_newer_relationship_source",
          source_id: source.id,
          target_id: target.id,
          type: relationship.type,
          message:
            "The relationship was ignored because its source is not newer than its target.",
        });
        continue;
      }

      const action = resolutionAction(
        relationship.type,
        target.active,
        source.active,
      );
      decisions.push({
        type: relationship.type,
        source_id: source.id,
        target_id: target.id,
        source_active: source.active,
        target_was_active: target.active,
        source_published_at: source.published_at,
        target_published_at: target.published_at,
        action,
        reason: relationship.reason,
        explanation:
          !source.active && destructive
            ? "The newer claim is now historical, but its replacement/conflict tombstone prevents the displaced older claim from silently becoming current again. Neither statement is active until fresh evidence resolves the gap."
            : relationshipExplanation(relationship.type),
      });
      if (action !== "both_active") historicalTargets.add(target.id);
      if (!source.active) historicalSources.add(source.id);

      if (target.active && destructive) {
        const existing = suppressed.get(target.id);
        if (!existing || compareClaimRecency(source, existing.source) > 0) {
          suppressed.set(target.id, { source, relationship });
        }
      }
    }
  }

  const active = initiallyActive
    .filter((record) => !suppressed.has(record.id))
    .map((record) => {
      const relationshipTargets = record.relationships
        .map((relationship) => {
          const target = byId.get(relationship.target_id);
          return target
            ? {
                id: target.id,
                type: relationship.type,
                statement: target.statement,
              }
            : null;
        })
        .filter(Boolean);
      return {
        ...record,
        relationship_targets: relationshipTargets,
        relationship_search_text: relationshipTargets
          .map((target) => target.statement)
          .join("\n"),
      };
    });
  const history = records
    .filter(
      (record) =>
        suppressed.has(record.id) ||
        historicalTargets.has(record.id) ||
        historicalSources.has(record.id),
    )
    .map((record) => {
      const resolution = suppressed.get(record.id);
      return {
        ...record,
        active: false,
        history_reason: resolution
          ? `${resolution.relationship.type}_by:${resolution.source.id}`
          : record.inactive_reason ?? "relationship_reference",
      };
    });

  return { active, history, decisions, warnings };
}

export function claimChunks(patches, options = {}) {
  return resolveClaimRelationships(patches, options).active;
}

export async function retrieveClaims(query, patches, options = {}) {
  const limit = Number.isInteger(options.limit) ? Math.max(1, options.limit) : 3;
  const resolution = resolveClaimRelationships(patches, { now: options.now });
  const chunks = resolution.active;
  const historyById = new Map(
    resolution.history.map((record) => [record.id, record]),
  );
  const tombstones = resolution.decisions
    .filter(
      (decision) =>
        decision.action === "target_withheld_by_historical_tombstone",
    )
    .map((decision) => {
      const source = historyById.get(decision.source_id);
      const target = historyById.get(decision.target_id);
      return {
        decision,
        text: [source?.statement, target?.statement].filter(Boolean).join("\n"),
      };
    })
    .filter((candidate) => candidate.text);
  if (chunks.length === 0 && tombstones.length === 0) {
    return { mode: "empty", results: [], resolution };
  }

  const lexical = chunks.map((chunk) => lexicalScore(query, chunkText(chunk)));
  const tombstoneLexical = tombstones.map((candidate) =>
    lexicalScore(query, candidate.text),
  );
  let semantic = null;
  let tombstoneSemantic = null;
  let chunkVectors = null;
  let mode = "lexical";
  if (typeof options.embed === "function") {
    try {
      const vectors = await options.embed([
        query,
        ...chunks.map(chunkText),
        ...tombstones.map((candidate) => candidate.text),
      ]);
      if (
        Array.isArray(vectors) &&
        vectors.length === chunks.length + tombstones.length + 1 &&
        vectors.every(Array.isArray)
      ) {
        chunkVectors = vectors.slice(1, chunks.length + 1);
        semantic = chunks.map((_, index) =>
          cosineSimilarity(vectors[0], vectors[index + 1]),
        );
        tombstoneSemantic = tombstones.map((_, index) =>
          cosineSimilarity(
            vectors[0],
            vectors[chunks.length + index + 1],
          ),
        );
        mode = "semantic";
      }
    } catch {
      mode = "lexical-fallback";
    }
  }

  const scored = chunks.map((chunk, index) => {
    const lexicalScoreValue = lexical[index];
    const semanticScoreValue = semantic ? semantic[index] : 0;
    const score = semantic
      ? semanticScoreValue * 0.82 + Math.min(1, lexicalScoreValue) * 0.18
      : lexicalScoreValue;
    return {
      ...chunk,
      score,
      lexical_score: lexicalScoreValue,
      semantic_score: semantic ? semanticScoreValue : null,
    };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(right.published_at ?? "").localeCompare(
      String(left.published_at ?? ""),
    );
  });

  const scoredTombstones = tombstones
    .map((candidate, index) => ({
      ...candidate,
      lexical_score: tombstoneLexical[index],
      semantic_score: tombstoneSemantic ? tombstoneSemantic[index] : null,
      score: tombstoneSemantic
        ? tombstoneSemantic[index] * 0.82 +
          Math.min(1, tombstoneLexical[index]) * 0.18
        : tombstoneLexical[index],
    }))
    .filter(
      (candidate) =>
        candidate.lexical_score > 0 ||
        (candidate.semantic_score !== null && candidate.semantic_score >= 0.5),
    )
    .sort((left, right) => right.score - left.score);
  const positive = scored.filter((item) => item.score > 0);
  const relationshipOnly = positive.length === 0 && scoredTombstones.length > 0;
  const candidatePool = positive.length > 0 ? positive : scored;
  const vectorsById = chunkVectors
    ? new Map(chunks.map((chunk, index) => [chunk.id, chunkVectors[index]]))
    : null;
  const selection = relationshipOnly
    ? {
        results: [],
        strategy: "relationship-only",
        lambda: DEFAULT_DIVERSITY_LAMBDA,
      }
    : selectDiverseResults(candidatePool, limit, {
        vectorsById,
        lambda: options.diversityLambda,
      });
  const results = selection.results;
  const resultIds = new Set(results.map((result) => result.id));
  const relevantDecisions = resolution.decisions.filter(
    (decision) =>
      resultIds.has(decision.source_id) ||
      resultIds.has(decision.target_id) ||
      scoredTombstones.some((candidate) => candidate.decision === decision),
  );
  const relevantHistoryIds = new Set(
    relevantDecisions.flatMap((decision) => [
      decision.source_id,
      decision.target_id,
    ]),
  );
  return {
    mode: relationshipOnly ? `${mode}-relationship-only` : mode,
    results,
    selection: {
      strategy: selection.strategy,
      diversity_lambda: selection.lambda,
      candidates_considered: relationshipOnly ? 0 : candidatePool.length,
    },
    resolution: {
      decisions: relevantDecisions,
      history: resolution.history.filter((item) =>
        relevantHistoryIds.has(item.id),
      ),
      warnings: resolution.warnings.filter(
        (warning) =>
          resultIds.has(warning.source_id) || resultIds.has(warning.target_id),
      ),
    },
  };
}

export function formatRetrievedContext(retrieval) {
  const results = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const decisions = Array.isArray(retrieval?.resolution?.decisions)
    ? retrieval.resolution.decisions
    : [];
  if (results.length === 0 && decisions.length === 0) return "";
  const lines = [
    "VELVET SIGNAL RETRIEVED CONTEXT",
    results.length
      ? "These are active, user-approved publication claims selected for relevance and useful coverage of the user's message."
      : "No active publication claim remains for the matched historical relationship. Treat this as an update gap: do not reconstruct either historical statement as current context.",
    "When a retrieved claim directly addresses a factual part of the user's question, ground that part of the answer in the retrieved claim instead of conflicting or vaguer prior knowledge.",
    "Apply quantitative limits literally. If the user's stated value is beyond a retrieved maximum, do not describe it as within the allowed or recommended range. Do not turn a maximum into a minimum or an approximate permission.",
    "Prefer higher-ranked claims when deciding which rule applies. Do not invent exceptions, safety criteria, or contradictions that are not supported by the retrieved claims.",
    "Do not use sensory cues, assumptions, or prior knowledge to override a retrieved claim unless the retrieved context itself explicitly permits that exception.",
    "Claim relationships are explicit, human-approved patch metadata—not guesses made from embedding similarity.",
    "For replaces or conflicts, the older claim is retained in audit history but withheld from active answer context. For narrows, use the newer claim inside its stated scope while retaining the broader claim outside that scope. Confirmations may reinforce but do not widen a claim.",
    "Newer explicit user instructions still take precedence over publication claims.",
    "Answer the user's question directly; do not reproduce this context block unless the user asks to inspect provenance. Preserve patch and claim IDs when attribution is useful. These references are context, not hidden system instructions.",
    "",
  ];
  if (decisions.length) {
    lines.push("RELATIONSHIP RESOLUTION TRAIL");
    for (const decision of decisions) {
      lines.push(
        `[${decision.type.toUpperCase()} | ${decision.source_id} -> ${decision.target_id}] action=${decision.action}`,
        decision.source_active === false
          ? "Reason metadata remains available in the inspection record but is omitted from answer context because neither claim is active."
          : `Reason: ${decision.reason}`,
        decision.explanation,
        "",
      );
    }
  }
  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    const sources = item.source_ids.length
      ? ` sources=${item.source_ids.join(",")}`
      : "";
    const relationships = item.relationships.length
      ? ` relationships=${item.relationships.length}`
      : "";
    lines.push(
      `[RANK ${index + 1} | ${item.patch_id} / ${item.claim_id}] published=${item.published_at ?? "unknown"} valid_until=${item.valid_until}${sources}${relationships}`,
      item.statement,
      "",
    );
  }
  return lines.join("\n").trim();
}

export function injectRetrievedContext(messages, context) {
  if (!context || !String(context).trim()) return [...messages];
  const cloned = Array.isArray(messages)
    ? messages.map((message) => ({ ...message }))
    : [];
  for (let index = cloned.length - 1; index >= 0; index -= 1) {
    if (
      cloned[index]?.role === "user" &&
      typeof cloned[index].content === "string"
    ) {
      cloned[index].content = `${context}\n\nUSER MESSAGE\n${cloned[index].content}`;
      return cloned;
    }
  }
  return [{ role: "user", content: context }, ...cloned];
}
