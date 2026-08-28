import {
  formatMultiIntentContext,
  retrieveMultiIntentClaims,
} from "./multi-intent-rag.mjs";
import { resolveClaimRelationships } from "./rag.mjs";

const INTENT_MATCH_THRESHOLD = 0.34;
const MIN_SUPPLEMENT_LEXICAL_SCORE = 0.18;
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "msclkid",
]);
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "is", "it", "its", "may", "my", "of", "on", "or", "our",
  "should", "so", "that", "the", "their", "them", "there", "these", "they",
  "this", "to", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
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

function lexicalScore(query, text) {
  const queryTokens = tokenize(query);
  const documentTokens = tokenize(text);
  if (!queryTokens.length || !documentTokens.length) return 0;
  let matched = 0;
  for (const queryToken of queryTokens) {
    if (documentTokens.some((token) => tokenMatches(queryToken, token))) {
      matched += 1;
    }
  }
  return matched / queryTokens.length;
}

function candidateText(item) {
  return [item?.desk, item?.title, item?.scope, item?.statement]
    .filter(Boolean)
    .join("\n");
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
      // Fall through to metadata when a source has no parseable URL.
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
  return normalizeLabel(source.publisher) || null;
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

function selectionIntents(selection) {
  return Array.isArray(selection?.intents)
    ? selection.intents.map((intent) => intent?.text).filter(Boolean)
    : [];
}

function withIntentMetadata(item, intents) {
  if (!intents.length) return { ...item };
  const intentScores = intents.map((intent) => lexicalScore(intent, candidateText(item)));
  const matchedIntents = intentScores
    .map((score, index) => ({ score, index }))
    .filter(({ score }) => score >= INTENT_MATCH_THRESHOLD)
    .map(({ index }) => index);
  return {
    ...item,
    intent_scores: intentScores,
    matched_intents: matchedIntents,
  };
}

function annotateEvidence(results) {
  const seenEvidence = new Set();
  const seenPublishers = new Set();
  return (Array.isArray(results) ? results : []).map((item, index) => {
    const profile = evidenceProfile(item);
    const newEvidenceKeys = profile.evidence_keys.filter((key) => !seenEvidence.has(key));
    const newPublisherKeys = profile.publisher_keys.filter((key) => !seenPublishers.has(key));
    const sharedOnly =
      profile.evidence_keys.length > 0 && newEvidenceKeys.length === 0;
    for (const key of profile.evidence_keys) seenEvidence.add(key);
    for (const key of profile.publisher_keys) seenPublishers.add(key);
    return {
      ...item,
      ...profile,
      evidence_novelty: newEvidenceKeys.length,
      publisher_novelty: newPublisherKeys.length,
      shared_evidence_only: index === 0 ? false : sharedOnly,
    };
  });
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
      const identity = source.url ?? source.id ?? source.name ?? source.evidence_key;
      bundle.sources.set(identity, {
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

export function evidenceReport(results) {
  const annotated = annotateEvidence(results);
  const bundles = evidenceBundles(annotated);
  const publishers = new Set(bundles.flatMap((bundle) => bundle.publishers));
  const sourcedClaims = annotated.filter((item) => item.evidence_keys.length > 0);
  const sharedBundles = bundles.filter((bundle) => bundle.shared_by_multiple_claims);
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
    distinct_publisher_count: publishers.size,
    sourced_claim_count: sourcedClaims.length,
    unsourced_claim_count: annotated.length - sourcedClaims.length,
    shared_evidence_group_count: sharedBundles.length,
    max_claims_on_one_evidence: bundles.length
      ? Math.max(...bundles.map((bundle) => bundle.supports.length))
      : 0,
    bundles,
  };
}

function uniqueIntentRequirements(victim, selected) {
  const requirements = [];
  for (const intentIndex of candidateIntentIndexes(victim)) {
    const coveredElsewhere = selected.some(
      (item) => item.id !== victim.id && candidateIntentIndexes(item).includes(intentIndex),
    );
    if (!coveredElsewhere) requirements.push(intentIndex);
  }
  return requirements;
}

function isProtectedRelationshipCompanion(victim, selected) {
  return selected.some(
    (item) => item.id !== victim.id && relationshipCompanionType(victim, item),
  );
}

function distinctEvidenceOutsideVictim(selected, victim) {
  const evidence = new Set();
  const publishers = new Set();
  for (const item of selected) {
    if (item.id === victim.id) continue;
    const profile = evidenceProfile(item);
    for (const key of profile.evidence_keys) evidence.add(key);
    for (const key of profile.publisher_keys) publishers.add(key);
  }
  return { evidence, publishers };
}

function supplementCandidateScore(candidate, query, seenEvidence, seenPublishers) {
  const profile = evidenceProfile(candidate);
  const relevance = lexicalScore(query, candidateText(candidate));
  const newEvidence = profile.evidence_keys.filter((key) => !seenEvidence.has(key));
  const newPublishers = profile.publisher_keys.filter((key) => !seenPublishers.has(key));
  return {
    relevance,
    profile,
    newEvidence,
    newPublishers,
    score:
      0.72 * relevance +
      (newEvidence.length ? 0.22 : 0) +
      (newPublishers.length ? 0.06 : 0),
  };
}

function sourceDiversitySupplement(query, selectedInput, activeClaims, selection = {}) {
  let selected = annotateEvidence(selectedInput);
  const intents = selectionIntents(selection);
  const selectedIds = new Set(selected.map((item) => item.id));
  const replacements = [];

  for (let position = selected.length - 1; position >= 1; position -= 1) {
    const victim = selected[position];
    if (!victim.shared_evidence_only) continue;
    if (isProtectedRelationshipCompanion(victim, selected)) continue;

    const requiredIntents = uniqueIntentRequirements(victim, selected);
    const { evidence: seenEvidence, publishers: seenPublishers } =
      distinctEvidenceOutsideVictim(selected, victim);
    const victimLexical = Number(victim.lexical_score);
    const minimumScore = Math.max(
      MIN_SUPPLEMENT_LEXICAL_SCORE,
      Number.isFinite(victimLexical) ? Math.max(0, victimLexical) * 0.55 : 0,
    );

    const alternatives = (Array.isArray(activeClaims) ? activeClaims : [])
      .filter((candidate) => !selectedIds.has(candidate.id))
      .map((candidate) => withIntentMetadata(candidate, intents))
      .map((candidate) => ({
        candidate,
        ...supplementCandidateScore(candidate, query, seenEvidence, seenPublishers),
      }))
      .filter(({ candidate, relevance, newEvidence }) => {
        if (!newEvidence.length || relevance < minimumScore) return false;
        if (!requiredIntents.length) return true;
        const matched = candidateIntentIndexes(candidate);
        return requiredIntents.every((index) => matched.includes(index));
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (right.relevance !== left.relevance) return right.relevance - left.relevance;
        return String(right.candidate.published_at ?? "").localeCompare(
          String(left.candidate.published_at ?? ""),
        );
      });

    if (!alternatives.length) continue;
    const winner = alternatives[0];
    const replacement = {
      ...winner.candidate,
      score: winner.relevance,
      lexical_score: winner.relevance,
      semantic_score: null,
      selection_reason: "source-diversity-supplement",
      supplemental_retrieval: "local-lexical-active-ledger",
      replaced_for_evidence_diversity: victim.id,
    };
    selectedIds.delete(victim.id);
    selectedIds.add(replacement.id);
    selected[position] = replacement;
    replacements.push({
      removed_id: victim.id,
      added_id: replacement.id,
      added_evidence_keys: winner.newEvidence,
      lexical_score: winner.relevance,
      preserved_intents: requiredIntents.map((index) => index + 1),
    });
    selected = annotateEvidence(selected);
  }

  return { results: selected, replacements };
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

function mergeResolution(baseResolution, fullResolution, results) {
  if (!baseResolution && !fullResolution) return undefined;
  const resultIds = new Set(results.map((item) => item.id));
  const decisions = [];
  const decisionKeys = new Set();
  const addDecision = (decision) => {
    if (!decision) return;
    const key = `${decision.type}|${decision.source_id}|${decision.target_id}|${decision.action}`;
    if (decisionKeys.has(key)) return;
    decisionKeys.add(key);
    decisions.push(decision);
  };

  for (const decision of Array.isArray(baseResolution?.decisions)
    ? baseResolution.decisions
    : []) {
    if (
      decision.action === "target_withheld_by_historical_tombstone" ||
      resultIds.has(decision.source_id) ||
      resultIds.has(decision.target_id)
    ) {
      addDecision(decision);
    }
  }
  for (const decision of Array.isArray(fullResolution?.decisions)
    ? fullResolution.decisions
    : []) {
    if (resultIds.has(decision.source_id) || resultIds.has(decision.target_id)) {
      addDecision(decision);
    }
  }

  const historyIds = new Set(
    decisions.flatMap((decision) => [decision.source_id, decision.target_id]),
  );
  const history = [
    ...(Array.isArray(baseResolution?.history) ? baseResolution.history : []),
    ...(Array.isArray(fullResolution?.history) ? fullResolution.history : []),
  ].filter((item, index, all) =>
    historyIds.has(item.id) && all.findIndex((candidate) => candidate.id === item.id) === index,
  );
  const warnings = [
    ...(Array.isArray(baseResolution?.warnings) ? baseResolution.warnings : []),
    ...(Array.isArray(fullResolution?.warnings) ? fullResolution.warnings : []),
  ].filter((warning, index, all) =>
    (resultIds.has(warning.source_id) || resultIds.has(warning.target_id)) &&
    all.findIndex((candidate) =>
      candidate.code === warning.code &&
      candidate.source_id === warning.source_id &&
      candidate.target_id === warning.target_id
    ) === index,
  );
  return { decisions, history, warnings };
}

export async function retrieveEvidenceAwareClaims(query, patches, options = {}) {
  const requestedLimit = Number.isInteger(options.limit) ? Math.max(1, options.limit) : 3;
  const retrieveImpl = options.retrieveImpl ?? retrieveMultiIntentClaims;
  const retrieveOptions = { ...options };
  delete retrieveOptions.retrieveImpl;

  const base = await retrieveImpl(query, patches, {
    ...retrieveOptions,
    limit: requestedLimit,
  });
  const baseResults = annotateEvidence(base?.results ?? []);
  const baseReport = evidenceReport(baseResults);
  let results = baseResults;
  let replacements = [];
  let fullResolution = null;

  if (
    requestedLimit > 1 &&
    baseResults.length > 1 &&
    baseReport.shared_evidence_group_count > 0
  ) {
    fullResolution = resolveClaimRelationships(patches, { now: options.now });
    const supplemented = sourceDiversitySupplement(
      query,
      baseResults,
      fullResolution.active,
      base?.selection ?? {},
    );
    results = supplemented.results;
    replacements = supplemented.replacements;
  }

  const report = evidenceReport(results);
  const selection = recomputeIntentCoverage(
    {
      ...(base?.selection ?? {}),
      strategy: replacements.length
        ? "evidence-aware-source-diversity"
        : base?.selection?.strategy,
      base_strategy: replacements.length
        ? base?.selection?.strategy ?? null
        : base?.selection?.base_strategy ?? null,
      evidence_strategy: replacements.length
        ? "local-lexical-active-ledger-supplement"
        : "annotation-only",
      evidence_replacements: replacements,
      evidence: report,
    },
    results,
  );

  return {
    ...base,
    results,
    resolution: mergeResolution(base?.resolution, fullResolution, results),
    selection,
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
