function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function has(text, pattern) {
  return pattern.test(clean(text));
}

function normalizedClaimIds(claims = []) {
  return claims
    .map((claim) => String(claim?.id ?? "").trim())
    .filter(Boolean);
}

function mentionedClaimIds(answer, claims = []) {
  const text = clean(answer);
  return normalizedClaimIds(claims).filter((id) =>
    new RegExp(`\\b${id.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
}

function claimKeywords(statement) {
  const stop = new Set([
    "the", "and", "that", "this", "with", "from", "have", "has", "had", "for", "are", "was", "were",
    "not", "but", "its", "their", "into", "about", "does", "did", "now", "than", "then", "also", "only",
    "support", "supports", "supported", "current", "claim", "claims", "patch", "update",
  ]);
  return clean(statement)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9+._-]*/g)?.filter((word) => word.length >= 4 && !stop.has(word)) ?? [];
}

function claimEntailed(answer, claim) {
  const text = clean(answer).toLowerCase();
  const keywords = [...new Set(claimKeywords(claim?.statement))];
  if (!keywords.length) return false;
  const hits = keywords.filter((word) => text.includes(word)).length;
  return hits >= Math.min(2, keywords.length) && hits / keywords.length >= 0.34;
}

function provenanceIdentifiers(answer) {
  return clean(answer).match(/\b(?:[A-Z]{1,8}-\d{1,4}|vs-ed25519-[a-z0-9]+)\b/gi) ?? [];
}

function unsupportedIdentifier(answer, claims = [], patchIds = []) {
  const allowed = new Set([...normalizedClaimIds(claims), ...patchIds].map((id) => id.toLowerCase()));
  return provenanceIdentifiers(answer).some((id) => !allowed.has(id.toLowerCase()));
}

function uncertaintyPreserved(answer, claims = []) {
  const uncertain = claims.filter((claim) =>
    /needs[- ]review|truncat|unclear|unknown|missing|not (?:stated|established|specified)|none (?:is )?asserted/i.test(
      `${claim?.status ?? ""} ${claim?.statement ?? ""} ${claim?.notes ?? ""}`,
    ),
  );
  if (!uncertain.length) return null;
  const text = clean(answer);
  return uncertain.some((claim) => {
    const idPresent = claim?.id && new RegExp(`\\b${String(claim.id).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text);
    const uncertaintyLanguage = /needs[- ]review|truncat|unclear|unknown|missing|not (?:stated|established|specified)|cannot (?:confirm|infer)|does not (?:state|establish|specify)/i.test(text);
    return idPresent && uncertaintyLanguage;
  });
}

function expiryAware(answer) {
  const text = clean(answer);
  return /historical|background context|was (?:true|accurate|current)|at the time/i.test(text) &&
    /not (?:current|present-day)|no longer (?:current|guidance)|must not|should not|cannot.{0,50}(?:current|guidance)/i.test(text);
}

function noResurrection(answer) {
  const text = clean(answer);
  return /(?:may|can|should|must)?\s*not.{0,80}(?:reviv|resurrect|restore|silently)|no.{0,80}(?:reviv|resurrect)/i.test(text) &&
    /historical|uncertain|update gap|new(?:er)? (?:patch|information)|verify|replacement/i.test(text);
}

function temporalConfabulation(answer, baselineAnswer = "") {
  const answerText = clean(answer);
  const baseline = clean(baselineAnswer);
  const freshnessFraming = /\b(?:recent(?:ly)?|new(?:ly)?|now|since 20\d\d|changed|shifted|evolved)\b/i;
  const unsupportedOldExamples = /\bGPT-?3\b|\btransfer learning\b|\bfew[- ]shot\b|\bchain[- ]of[- ]thought\b/i;
  return freshnessFraming.test(answerText) && unsupportedOldExamples.test(answerText) &&
    (!baseline || unsupportedOldExamples.test(baseline));
}

export function scoreGovernance({
  baselineAnswer = "",
  patchedAnswer = "",
  claims = [],
  patchIds = [],
  expectedRelevantClaimIds = [],
} = {}) {
  const answer = clean(patchedAnswer);
  const mentioned = mentionedClaimIds(answer, claims);
  const identifiers = provenanceIdentifiers(answer);
  const relevant = new Set(expectedRelevantClaimIds);
  const realized = claims
    .filter((claim) => relevant.has(claim?.id))
    .filter((claim) => claimEntailed(answer, claim))
    .map((claim) => claim.id);
  const citedButUnrealized = claims
    .filter((claim) => mentioned.includes(claim?.id) && !claimEntailed(answer, claim))
    .map((claim) => claim.id);
  const uncertainty = uncertaintyPreserved(answer, claims);

  return {
    evidence_realization: {
      scored: expectedRelevantClaimIds.length > 0,
      passed: expectedRelevantClaimIds.length > 0 ? realized.length > 0 : null,
      expected_claim_ids: expectedRelevantClaimIds,
      realized_claim_ids: realized,
    },
    provenance_entailment: {
      scored: mentioned.length > 0,
      passed: mentioned.length > 0 ? citedButUnrealized.length === 0 : null,
      mentioned_claim_ids: mentioned,
      cited_but_unrealized: citedButUnrealized,
    },
    provenance_type_accuracy: {
      scored: identifiers.length > 0,
      passed: identifiers.length > 0 ? !unsupportedIdentifier(answer, claims, patchIds) : null,
      ...(identifiers.length > 0 ? {} : { reason: "no_provenance_identifier_present" }),
    },
    uncertainty_retention: {
      scored: uncertainty !== null,
      passed: uncertainty,
    },
    false_temporal_attribution: {
      scored: Boolean(answer),
      passed: Boolean(answer) ? !temporalConfabulation(answer, baselineAnswer) : null,
    },
  };
}

export function scoreExpiryAnswer(answer) {
  return {
    scored: Boolean(clean(answer)),
    passed: Boolean(clean(answer)) ? expiryAware(answer) : null,
  };
}

export function scoreNoResurrectionAnswer(answer) {
  return {
    scored: Boolean(clean(answer)),
    passed: Boolean(clean(answer)) ? noResurrection(answer) : null,
  };
}

export function summarizeGovernance(scores = []) {
  const dimensions = {};
  for (const score of scores) {
    for (const [name, result] of Object.entries(score ?? {})) {
      if (!result?.scored) continue;
      dimensions[name] ??= { scored: 0, passed: 0, failed: 0 };
      dimensions[name].scored += 1;
      if (result.passed) dimensions[name].passed += 1;
      else dimensions[name].failed += 1;
    }
  }
  return dimensions;
}
