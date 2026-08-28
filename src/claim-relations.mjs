export const CLAIM_RELATION_TYPES = Object.freeze([
  "replaces",
  "narrows",
  "confirms",
  "conflicts",
]);

const RELATION_TYPE_SET = new Set(CLAIM_RELATION_TYPES);

export function isClaimRelationType(value) {
  return typeof value === "string" && RELATION_TYPE_SET.has(value);
}

export function normalizeClaimReference(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeClaimRelationships(claim) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return [];
  const relationships = [];
  const seen = new Set();

  const add = (type, targetId, reason) => {
    const target_id = normalizeClaimReference(targetId);
    if (!isClaimRelationType(type) || !target_id) return;
    const key = `${type}\0${target_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    relationships.push({
      type,
      target_id,
      reason:
        typeof reason === "string" && reason.trim()
          ? reason.trim()
          : type === "replaces"
            ? "Explicit legacy supersession reference."
            : "Explicit claim relationship.",
    });
  };

  for (const relationship of Array.isArray(claim.relationships)
    ? claim.relationships
    : []) {
    if (!relationship || typeof relationship !== "object") continue;
    add(
      relationship.type,
      relationship.target_id ?? relationship.target,
      relationship.reason ?? relationship.rationale,
    );
  }

  for (const targetId of Array.isArray(claim.supersedes)
    ? claim.supersedes
    : []) {
    add("replaces", targetId, "Explicit legacy supersession reference.");
  }

  return relationships;
}

export function relationshipExplanation(type) {
  if (type === "replaces") {
    return "The newer claim replaces the older claim in active context; the older claim remains in audit history.";
  }
  if (type === "narrows") {
    return "Both claims remain active, but the newer, more specific claim controls inside its stated scope.";
  }
  if (type === "confirms") {
    return "Both claims remain active; the newer claim independently confirms the older claim.";
  }
  if (type === "conflicts") {
    return "The claims cannot both control the same scope, so the newer claim is active and the older claim remains in audit history.";
  }
  return "The relationship does not change claim eligibility.";
}
