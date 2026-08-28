import {
  formatAnswerabilityContext,
  retrieveAnswerableClaims,
} from "./answerability-rag.mjs";

const OVERLAP_THRESHOLD = 0.45;
const HIGH_OVERLAP_THRESHOLD = 0.65;
const MAX_TERMS_PER_SIDE = 8;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "is", "it", "its", "may", "my", "of", "on", "or", "our",
  "should", "so", "that", "the", "their", "them", "there", "these", "they",
  "this", "to", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
]);

const NUMBER_WORD =
  "(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const UNIT =
  "(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|degrees?(?:\\s*[fc])?|°[fc]|percent|%|mg|g|kg|ml|l)";
const RANGE_QUANTITY = new RegExp(
  `\\b${NUMBER_WORD}\\s*(?:-|–|—|to)\\s*${NUMBER_WORD}\\s*${UNIT}\\b`,
  "gi",
);
const SINGLE_QUANTITY = new RegExp(
  `\\b${NUMBER_WORD}\\s*${UNIT}\\b`,
  "gi",
);

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalToken(value) {
  const token = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
  if (!token || STOP_WORDS.has(token)) return null;
  if (/^\d+(?:\.\d+)?$/.test(token)) return token;
  return token.length >= 7 ? token.slice(0, 6) : token;
}

function contentTokenMap(value) {
  const map = new Map();
  const tokens = normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFKD")
    .match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? [];
  for (const token of tokens) {
    const canonical = canonicalToken(token);
    if (!canonical) continue;
    if (!map.has(canonical)) map.set(canonical, token);
  }
  return map;
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function normalizeQuantity(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[–—-]/g, " to ")
    .replace(/\s+to\s+/g, " to ");
}

export function extractQuantityDetails(statement) {
  const text = normalizeWhitespace(statement);
  if (!text) return [];
  const matches = [
    ...(text.match(RANGE_QUANTITY) ?? []),
    ...(text.match(SINGLE_QUANTITY) ?? []),
  ];
  const seen = new Set();
  const details = [];
  for (const match of matches) {
    const normalized = normalizeQuantity(match);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    details.push(normalized);
  }
  return details;
}

function explicitRelationshipsBetween(left, right) {
  const relationships = [];
  const seen = new Set();
  const collect = (source, target) => {
    for (const relationship of Array.isArray(source?.relationships)
      ? source.relationships
      : []) {
      if (relationship?.target_id !== target?.id) continue;
      const type = String(relationship.type ?? "").trim();
      if (!type) continue;
      const key = `${source.id}|${target.id}|${type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationships.push({
        type,
        source_id: source.id,
        target_id: target.id,
        reason: relationship.reason ?? null,
      });
    }
  };
  collect(left, right);
  collect(right, left);
  return relationships;
}

function termSurfaceList(keys, tokenMap) {
  return keys
    .map((key) => tokenMap.get(key) ?? key)
    .filter((term) => !/^\d+(?:\.\d+)?$/.test(term))
    .slice(0, MAX_TERMS_PER_SIDE);
}

export function compareClaimContent(left, right, options = {}) {
  const leftMap = contentTokenMap(left?.statement);
  const rightMap = contentTokenMap(right?.statement);
  const leftKeys = new Set(leftMap.keys());
  const rightKeys = new Set(rightMap.keys());
  if (!leftKeys.size || !rightKeys.size) return null;

  const sharedKeys = [...leftKeys].filter((key) => rightKeys.has(key));
  const smallerSize = Math.min(leftKeys.size, rightKeys.size);
  const overlapScore = smallerSize > 0 ? sharedKeys.length / smallerSize : 0;
  const threshold = Number.isFinite(options.overlapThreshold)
    ? Math.max(0, Math.min(1, options.overlapThreshold))
    : OVERLAP_THRESHOLD;
  if (overlapScore < threshold) return null;

  const leftOnlyKeys = setDifference(leftKeys, rightKeys);
  const rightOnlyKeys = setDifference(rightKeys, leftKeys);
  const leftQuantities = extractQuantityDetails(left?.statement);
  const rightQuantities = extractQuantityDetails(right?.statement);
  const rightQuantitySet = new Set(rightQuantities);
  const leftQuantitySet = new Set(leftQuantities);
  const leftUniqueQuantities = leftQuantities.filter(
    (quantity) => !rightQuantitySet.has(quantity),
  );
  const rightUniqueQuantities = rightQuantities.filter(
    (quantity) => !leftQuantitySet.has(quantity),
  );
  const leftUniqueTerms = termSurfaceList(leftOnlyKeys, leftMap);
  const rightUniqueTerms = termSurfaceList(rightOnlyKeys, rightMap);
  const explicitRelationships = explicitRelationshipsBetween(left, right);
  const hasDistinctDetails =
    leftUniqueQuantities.length > 0 ||
    rightUniqueQuantities.length > 0 ||
    leftUniqueTerms.length >= 2 ||
    rightUniqueTerms.length >= 2;
  const highThreshold = Number.isFinite(options.highOverlapThreshold)
    ? Math.max(threshold, Math.min(1, options.highOverlapThreshold))
    : HIGH_OVERLAP_THRESHOLD;
  const classification =
    overlapScore >= highThreshold
      ? hasDistinctDetails
        ? "overlap-with-distinct-details"
        : "high-overlap-minimal-delta"
      : "related-content";

  return {
    left_id: left.id,
    right_id: right.id,
    overlap_score: overlapScore,
    classification,
    descriptive_only: true,
    shared_terms: termSurfaceList(sharedKeys, leftMap),
    left_unique: {
      terms: leftUniqueTerms,
      quantities: leftUniqueQuantities,
    },
    right_unique: {
      terms: rightUniqueTerms,
      quantities: rightUniqueQuantities,
    },
    explicit_relationships: explicitRelationships,
    has_explicit_relationship: explicitRelationships.length > 0,
    has_distinct_details: hasDistinctDetails,
  };
}

function buildGroups(results, pairs) {
  const parent = new Map(results.map((item) => [item.id, item.id]));
  const find = (id) => {
    const current = parent.get(id);
    if (!current || current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const pair of pairs) union(pair.left_id, pair.right_id);

  const groups = new Map();
  for (const item of results) {
    const root = find(item.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item.id);
  }

  let index = 0;
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((claimIds) => {
      index += 1;
      const claimSet = new Set(claimIds);
      const groupPairs = pairs.filter(
        (pair) => claimSet.has(pair.left_id) && claimSet.has(pair.right_id),
      );
      const explicitTypes = [
        ...new Set(
          groupPairs.flatMap((pair) =>
            pair.explicit_relationships.map((relationship) => relationship.type),
          ),
        ),
      ];
      return {
        id: `O${index}`,
        claim_ids: claimIds,
        pair_count: groupPairs.length,
        contains_distinct_details: groupPairs.some(
          (pair) => pair.has_distinct_details,
        ),
        explicit_relationship_types: explicitTypes,
      };
    });
}

function annotateResults(results, pairs) {
  return results.map((item) => ({
    ...item,
    content_neighbors: pairs
      .filter((pair) => pair.left_id === item.id || pair.right_id === item.id)
      .map((pair) => {
        const isLeft = pair.left_id === item.id;
        return {
          other_id: isLeft ? pair.right_id : pair.left_id,
          overlap_score: pair.overlap_score,
          classification: pair.classification,
          unique_to_this_claim: isLeft ? pair.left_unique : pair.right_unique,
          unique_to_other_claim: isLeft ? pair.right_unique : pair.left_unique,
          explicit_relationships: pair.explicit_relationships,
        };
      }),
  }));
}

export function buildClaimDeltaReport(results, options = {}) {
  const items = Array.isArray(results) ? results : [];
  const pairs = [];
  const candidatePairCount = (items.length * (items.length - 1)) / 2;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < items.length;
      rightIndex += 1
    ) {
      const pair = compareClaimContent(
        items[leftIndex],
        items[rightIndex],
        options,
      );
      if (pair) pairs.push(pair);
    }
  }
  const groups = buildGroups(items, pairs);
  return {
    method: "deterministic-lexical-description-only",
    analyzed_claim_count: items.length,
    candidate_pair_count: candidatePairCount,
    overlapping_pair_count: pairs.length,
    distinct_detail_pair_count: pairs.filter(
      (pair) => pair.has_distinct_details,
    ).length,
    explicit_relationship_pair_count: pairs.filter(
      (pair) => pair.has_explicit_relationship,
    ).length,
    pairs,
    groups,
  };
}

export async function retrieveDeltaAwareClaims(query, patches, options = {}) {
  const answerabilityRetrieveImpl =
    options.answerabilityRetrieveImpl ?? retrieveAnswerableClaims;
  const retrieveOptions = { ...options };
  delete retrieveOptions.answerabilityRetrieveImpl;
  delete retrieveOptions.overlapThreshold;
  delete retrieveOptions.highOverlapThreshold;

  const retrieval = await answerabilityRetrieveImpl(
    query,
    patches,
    retrieveOptions,
  );
  const report = buildClaimDeltaReport(retrieval?.results ?? [], {
    overlapThreshold: options.overlapThreshold,
    highOverlapThreshold: options.highOverlapThreshold,
  });
  const results = annotateResults(retrieval?.results ?? [], report.pairs);
  return {
    ...retrieval,
    results,
    selection: {
      ...(retrieval?.selection ?? {}),
      content_overlap: report,
    },
  };
}

function detailText(detail) {
  const parts = [];
  if (detail?.terms?.length) parts.push(`terms=${detail.terms.join(",")}`);
  if (detail?.quantities?.length) {
    parts.push(`quantities=${detail.quantities.join(";")}`);
  }
  return parts.join(" ") || "none-detected";
}

export function formatDeltaAwareContext(retrieval) {
  const base = formatAnswerabilityContext(retrieval);
  if (!base) return base;
  const report = retrieval?.selection?.content_overlap;
  if (!report || !Array.isArray(report.pairs) || report.pairs.length === 0) {
    return base;
  }

  const lines = [
    "CONTENT OVERLAP / DELTA MAP",
    "These overlap labels describe selected claim content only. They do not establish confirmation, narrowing, conflict, replacement, or truth. Only explicit claim relationship metadata can do that.",
    "When overlapping claims contain distinct details, preserve those details instead of flattening the claims into 'they say the same thing.'",
  ];
  for (const pair of report.pairs) {
    const explicit = pair.explicit_relationships.length
      ? pair.explicit_relationships
          .map(
            (relationship) =>
              `${relationship.type}:${relationship.source_id}->${relationship.target_id}`,
          )
          .join(",")
      : "none";
    lines.push(
      `[OVERLAP ${pair.left_id} <-> ${pair.right_id}] classification=${pair.classification} lexical_overlap=${pair.overlap_score.toFixed(2)} explicit_relationships=${explicit}`,
      `Shared terms: ${pair.shared_terms.join(",") || "none-detected"}`,
      `${pair.left_id} adds: ${detailText(pair.left_unique)}`,
      `${pair.right_id} adds: ${detailText(pair.right_unique)}`,
    );
  }
  lines.push("");

  return base.replace(
    "VELVET SIGNAL RETRIEVED CONTEXT\n",
    `VELVET SIGNAL RETRIEVED CONTEXT\n${lines.join("\n")}`,
  );
}
