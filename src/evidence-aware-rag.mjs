import {
  formatMultiIntentContext,
  retrieveMultiIntentClaims,
} from "./multi-intent-rag.mjs";

const MAX_EVIDENCE_CANDIDATES = 12;
const DEFAULT_EVIDENCE_POOL_MULTIPLIER = 3;
const RELATIONSHIP_COMPANION_BONUS = 0.12;
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "msclkid",
]);

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLabel(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hostnameFromValue(value) {
  const text = normalizeWhitespace(value);
  if (!text) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function isTrackingParam(name) {
  const normalized = String(name ?? "").toLowerCase();
  return normalized.startsWith("utm_") || TRACKING_PARAMS.has(normalized);
}

export function canonicalSourceKey(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const rawUrl = normalizeWhitespace(source.url);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      if (hostname) {
        const params = [...url.searchParams.entries()]
          .filter(([name]) => !isTrackingParam(name))
          .sort(([leftName, leftValue], [rightName, rightValue]) => {
            const nameOrder = leftName.localeCompare(rightName);
            return nameOrder !== 0 ? nameOrder : leftValue.localeCompare(rightValue);
          });
        const pathname = (url.pathname || "/").replace(/\/+$/, "") || "/";
        const query = params.length
          ? `?${params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&")}`
          : "";
        return `url:${hostname}${pathname}${query}`;
      }
    } catch {
      // Fall through to publisher/title metadata when a source has no parseable URL.
    }
  }

  const publisher = normalizeLabel(source.publisher);
  const name = normalizeLabel(source.name ?? source.title);
  if (publisher && name) return `meta:${publisher}|${name}`;
  if (name) return `name:${name}`;
  if (publisher) return `publisher:${publisher}`;
  return null;
}

export function sourcePublisherKey(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const hostname = hostnameFromValue(source.url) ?? hostnameFromValue(source.publisher);
  if (hostname) return hostname;
  const publisher = normalizeLabel(source.publisher);
  return publisher || null;
}

export function evidenceProfile(item) {
  const sources = Array.isArray(item?.sources) ? item.sources : [];
  const evidenceKeys = [];
  const publisherKeys = [];
  const sourceDetails = [];
  const seenEvidence = new Set();
  const seenPublishers = new Set();

  for (const source of sources) {
    const evidenceKey = canonicalSourceKey(source);
    const publisherKey = sourcePublisherKey(source);
    if (evidenceKey && !seenEvidence.has(evidenceKey)) {
      seenEvidence.add(evidenceKey);
      evidenceKeys.push(evidenceKey);
    }
    if (publisherKey && !seenPublishers.has(publisherKey)) {
      seenPublishers.add(publisherKey);
      publisherKeys.push(publisherKey);
    }
    sourceDetails.push({
      id: source?.id ?? null,
      name: source?.name ?? source?.title ?? null,
      publisher: source?.publisher ?? publisherKey,
      url: source?.url ?? null,
      evidence_key: evidenceKey,
      publisher_key: publisherKey,
    });
  }

  return {
    evidence_keys: evidenceKeys,
    publisher_keys: publisherKeys,
    source_details: sourceDetails,
  };
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

function candidateIntentIndexes(item) {
  return Array.isArray(item?.matched_intents)
    ? item.matched_intents.filter((index) => Number.isInteger(index) && index >= 0)
    : [];
}

function enrichedCandidates(candidates) {
  return candidates.map((item, index) => ({
    ...item,
    ...evidenceProfile(item),
    _evidence_candidate_index: index,
  }));
}

function evidenceNovelty(item, seenEvidence, seenPublishers) {
  const newEvidenceKeys = item.evidence_keys.filter((key) => !seenEvidence.has(key));
  const newPublisherKeys = item.publisher_keys.filter((key) => !seenPublishers.has(key));
  const hasEvidence = item.evidence_keys.length > 0;
  return {
    newEvidenceKeys,
    newPublisherKeys,
    sharedOnly: hasEvidence && newEvidenceKeys.length === 0,
  };
}

export function selectEvidenceAwareResults(candidates, limit, selection = {}) {
  const requestedLimit = Math.max(1, Number.isInteger(limit) ? limit : 3);
  const pool = enrichedCandidates(Array.isArray(candidates) ? candidates : []);
  if (!pool.length) return [];

  const maxBaseScore = Math.max(0, ...pool.map((item) => Number(item.score) || 0));
  const selected = [];
  const remaining = [...pool];
  const seenEvidence = new Set();
  const seenPublishers = new Set();
  const coveredIntents = new Set();
  const intentCount = Number.isInteger(selection?.intent_count)
    ? Math.max(0, selection.intent_count)
    : 0;

  const remember = (item) => {
    for (const key of item.evidence_keys) seenEvidence.add(key);
    for (const key of item.publisher_keys) seenPublishers.add(key);
    for (const index of candidateIntentIndexes(item)) coveredIntents.add(index);
  };

  while (remaining.length && selected.length < requestedLimit) {
    if (selected.length === 0) {
      const first = remaining.shift();
      const novelty = evidenceNovelty(first, seenEvidence, seenPublishers);
      const selectedItem = {
        ...first,
        evidence_selection_score: 1,
        evidence_novelty: novelty.newEvidenceKeys.length,
        publisher_novelty: novelty.newPublisherKeys.length,
        shared_evidence_only: false,
        evidence_selection_reason: first.selection_reason ?? "top-relevance",
      };
      delete selectedItem._evidence_candidate_index;
      selected.push(selectedItem);
      remember(selectedItem);
      continue;
    }

    const uncoveredIntents = intentCount > 0
      ? Array.from({ length: intentCount }, (_, index) => index).filter(
          (index) => !coveredIntents.has(index),
        )
      : [];
    const coverageCandidates = uncoveredIntents.length
      ? remaining.filter((item) =>
          candidateIntentIndexes(item).some((index) => uncoveredIntents.includes(index)),
        )
      : [];
    const eligible = coverageCandidates.length ? coverageCandidates : remaining;

    const scored = eligible.map((item) => {
      const novelty = evidenceNovelty(item, seenEvidence, seenPublishers);
      const uncoveredMatches = candidateIntentIndexes(item).filter((index) =>
        uncoveredIntents.includes(index),
      );
      const relevance = maxBaseScore > 0
        ? Math.max(0, Math.min(1, (Number(item.score) || 0) / maxBaseScore))
        : Math.max(0, 1 - item._evidence_candidate_index / Math.max(1, pool.length));
      let companionType = null;
      for (const chosen of selected) {
        const relationship = relationshipCompanionType(item, chosen);
        if (relationship && !companionType) companionType = relationship;
      }
      const intentBonus = uncoveredMatches.length
        ? 0.38 + 0.05 * Math.min(2, uncoveredMatches.length)
        : 0;
      const evidenceBonus = novelty.newEvidenceKeys.length
        ? 0.24 + 0.04 * Math.min(2, novelty.newEvidenceKeys.length - 1)
        : 0;
      const publisherBonus = novelty.newPublisherKeys.length ? 0.05 : 0;
      const companionBonus = companionType ? RELATIONSHIP_COMPANION_BONUS : 0;
      const sharedEvidencePenalty = novelty.sharedOnly ? 0.20 : 0;
      const score =
        0.52 * relevance +
        intentBonus +
        evidenceBonus +
        publisherBonus +
        companionBonus -
        sharedEvidencePenalty;
      return {
        item,
        score,
        novelty,
        uncoveredMatches,
        companionType,
      };
    });

    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if ((right.item.score ?? 0) !== (left.item.score ?? 0)) {
        return (right.item.score ?? 0) - (left.item.score ?? 0);
      }
      return left.item._evidence_candidate_index - right.item._evidence_candidate_index;
    });

    const winner = scored[0];
    const selectedItem = {
      ...winner.item,
      evidence_selection_score: winner.score,
      evidence_novelty: winner.novelty.newEvidenceKeys.length,
      publisher_novelty: winner.novelty.newPublisherKeys.length,
      shared_evidence_only: winner.novelty.sharedOnly,
      evidence_selection_reason: winner.uncoveredMatches.length && winner.novelty.newEvidenceKeys.length
        ? `intent-and-evidence-coverage:${winner.uncoveredMatches.map((index) => index + 1).join(",")}`
        : winner.uncoveredMatches.length
          ? `intent-coverage:${winner.uncoveredMatches.map((index) => index + 1).join(",")}`
          : winner.companionType
            ? `relationship-companion:${winner.companionType}`
            : winner.novelty.newEvidenceKeys.length
              ? "new-evidence-lineage"
              : winner.novelty.sharedOnly
                ? "shared-evidence-relevance"
                : winner.item.selection_reason ?? "relevance-fallback",
    };
    delete selectedItem._evidence_candidate_index;
    selected.push(selectedItem);
    remember(selectedItem);
    const winnerIndex = remaining.findIndex((item) => item.id === winner.item.id);
    remaining.splice(winnerIndex, 1);
  }

  return selected;
}

function evidenceBundles(results) {
  const bundles = new Map();
  for (const item of Array.isArray(results) ? results : []) {
    for (const source of Array.isArray(item.source_details) ? item.source_details : []) {
      if (!source.evidence_key) continue;
      if (!bundles.has(source.evidence_key)) {
        bundles.set(source.evidence_key, {
          key: source.evidence_key,
          publishers: new Set(),
          sources: new Map(),
          supports: new Set(),
        });
      }
      const bundle = bundles.get(source.evidence_key);
      if (source.publisher_key) bundle.publishers.add(source.publisher_key);
      const sourceIdentity = source.url ?? source.id ?? source.name ?? source.evidence_key;
      bundle.sources.set(sourceIdentity, {
        id: source.id,
        name: source.name,
        publisher: source.publisher,
        url: source.url,
      });
      bundle.supports.add(item.id);
    }
  }

  return [...bundles.values()].map((bundle, index) => ({
    id: `E${index + 1}`,
    key: bundle.key,
    publishers: [...bundle.publishers],
    sources: [...bundle.sources.values()],
    supports: [...bundle.supports],
    shared_by_multiple_claims: bundle.supports.size > 1,
  }));
}

function recomputeIntentCoverage(selection, results) {
  if (!Array.isArray(selection?.intents)) return selection;
  const intents = selection.intents.map((intent, index) => ({
    ...intent,
    covered_by: results
      .filter((item) => candidateIntentIndexes(item).includes(index))
      .map((item) => item.id),
  }));
  return {
    ...selection,
    intents,
    intents_covered: intents.filter((intent) => intent.covered_by.length > 0).length,
  };
}

function pruneResolution(resolution, results) {
  if (!resolution || typeof resolution !== "object") return resolution;
  const resultIds = new Set(results.map((item) => item.id));
  const decisions = Array.isArray(resolution.decisions)
    ? resolution.decisions.filter(
        (decision) =>
          decision.action === "target_withheld_by_historical_tombstone" ||
          resultIds.has(decision.source_id) ||
          resultIds.has(decision.target_id),
      )
    : [];
  const historyIds = new Set(
    decisions.flatMap((decision) => [decision.source_id, decision.target_id]),
  );
  return {
    ...resolution,
    decisions,
    history: Array.isArray(resolution.history)
      ? resolution.history.filter((item) => historyIds.has(item.id))
      : [],
    warnings: Array.isArray(resolution.warnings)
      ? resolution.warnings.filter(
          (warning) =>
            resultIds.has(warning.source_id) || resultIds.has(warning.target_id),
        )
      : [],
  };
}

export function evidenceReport(results) {
  const bundles = evidenceBundles(results);
  const publisherSet = new Set(
    bundles.flatMap((bundle) => bundle.publishers),
  );
  const sourcedClaims = (Array.isArray(results) ? results : []).filter(
    (item) => Array.isArray(item.evidence_keys) && item.evidence_keys.length > 0,
  );
  const sharedBundles = bundles.filter((bundle) => bundle.shared_by_multiple_claims);
  const maxClaimsOnOneEvidence = bundles.length
    ? Math.max(...bundles.map((bundle) => bundle.supports.length))
    : 0;
  const distinctEvidenceCount = bundles.length;
  const status = distinctEvidenceCount === 0
    ? "unsourced"
    : distinctEvidenceCount === 1
      ? "single-evidence-lineage"
      : sharedBundles.length
        ? "mixed-source-diversity"
        : "source-diverse";
  return {
    status,
    distinct_evidence_count: distinctEvidenceCount,
    distinct_publisher_count: publisherSet.size,
    sourced_claim_count: sourcedClaims.length,
    unsourced_claim_count: (Array.isArray(results) ? results.length : 0) - sourcedClaims.length,
    shared_evidence_group_count: sharedBundles.length,
    max_claims_on_one_evidence: maxClaimsOnOneEvidence,
    bundles,
  };
}

export async function retrieveEvidenceAwareClaims(query, patches, options = {}) {
  const requestedLimit = Number.isInteger(options.limit) ? Math.max(1, options.limit) : 3;
  const retrieveImpl = options.retrieveImpl ?? retrieveMultiIntentClaims;
  const explicitPool = Number.isInteger(options.evidenceCandidateLimit)
    ? Math.max(requestedLimit, options.evidenceCandidateLimit)
    : null;
  const retrieveOptions = { ...options };
  delete retrieveOptions.retrieveImpl;
  delete retrieveOptions.evidenceCandidateLimit;

  const poolLimit = Math.min(
    MAX_EVIDENCE_CANDIDATES,
    explicitPool ?? Math.max(
      requestedLimit * DEFAULT_EVIDENCE_POOL_MULTIPLIER,
      requestedLimit + 3,
    ),
  );
  const existingCandidateLimit = Number.isInteger(retrieveOptions.candidateLimit)
    ? retrieveOptions.candidateLimit
    : 0;
  const base = await retrieveImpl(query, patches, {
    ...retrieveOptions,
    limit: poolLimit,
    candidateLimit: Math.max(existingCandidateLimit, poolLimit),
  });
  const candidates = Array.isArray(base?.results) ? base.results : [];
  const selectionWithCoverage = recomputeIntentCoverage(base?.selection ?? {}, candidates);
  const results = selectEvidenceAwareResults(
    candidates,
    requestedLimit,
    selectionWithCoverage,
  );
  const report = evidenceReport(results);
  const finalSelection = recomputeIntentCoverage(
    {
      ...(base?.selection ?? {}),
      strategy: candidates.length > requestedLimit
        ? "evidence-aware-source-diversity"
        : base?.selection?.strategy ?? "evidence-annotated",
      base_strategy: base?.selection?.strategy ?? null,
      evidence_candidate_limit: poolLimit,
      evidence_candidates_considered: candidates.length,
      evidence: report,
    },
    results,
  );

  return {
    ...base,
    results,
    resolution: pruneResolution(base?.resolution, results),
    selection: finalSelection,
  };
}

export function formatEvidenceAwareContext(retrieval) {
  const base = formatMultiIntentContext(retrieval);
  if (!base) return base;
  const report = retrieval?.selection?.evidence;
  if (!report || !Array.isArray(report.bundles)) return base;

  const lines = [
    "EVIDENCE MAP",
    "Separate claims can cite the same underlying source. Shared evidence is one cited evidence path, not independent confirmation merely because it appears in multiple claims or issues.",
    "Distinct cited sources improve source diversity but do not by themselves prove consensus, independence, or factual correctness.",
    `[EVIDENCE SUMMARY] status=${report.status} distinct_evidence=${report.distinct_evidence_count} publishers=${report.distinct_publisher_count} sourced_claims=${report.sourced_claim_count} unsourced_claims=${report.unsourced_claim_count}`,
  ];
  for (const bundle of report.bundles) {
    lines.push(
      `[${bundle.id}] publishers=${bundle.publishers.join(",") || "unknown"} supports=${bundle.supports.join(",") || "none"} shared=${bundle.shared_by_multiple_claims ? "yes" : "no"}`,
    );
  }
  lines.push("");
  return base.replace(
    "VELVET SIGNAL RETRIEVED CONTEXT\n",
    `VELVET SIGNAL RETRIEVED CONTEXT\n${lines.join("\n")}`,
  );
}
