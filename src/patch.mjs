function sourceIdFor(issue, source, index) {
  if (typeof source.id === "string" && source.id.trim()) return source.id.trim();
  const prefix = issue.id
    .split("-")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 4)
    .toUpperCase();
  return `${prefix || "VS"}-SRC-${index + 1}`;
}

function sourceIdsForClaim(issue, claim) {
  if (Array.isArray(claim.sourceIds) && claim.sourceIds.length) {
    return claim.sourceIds.filter((value) => typeof value === "string");
  }
  const index = Number.isInteger(claim.source) ? claim.source : 0;
  const source = issue.sources[index];
  return source ? [sourceIdFor(issue, source, index)] : [];
}

function supersedesForClaim(claim) {
  return Array.isArray(claim.supersedes)
    ? claim.supersedes.filter((value) => typeof value === "string" && value.trim())
    : [];
}

export function patchForIssue(issue, options = {}) {
  const deliveryStatus = options.deliveryStatus ?? "locked";
  const approved = deliveryStatus === "delivered";
  const sources = issue.sources.map((source, index) => ({
    id: sourceIdFor(issue, source, index),
    title: source.name,
    publisher: source.publisher,
    url: source.url,
    checked_at: source.checked,
  }));
  return {
    patch_id: issue.id,
    publication: "Velvet Signal",
    desk: issue.desk,
    issue: issue.issue,
    title: issue.title,
    version: issue.version ?? "1.0.0",
    published_at: (issue.publishedAt ?? "2026-08-27").slice(0, 10),
    valid_until: issue.expires,
    scope: issue.scope,
    precedence: "Newer explicit user instructions override this patch.",
    delivery: {
      status: deliveryStatus,
      approval_required: true,
      approved,
      rule: "Inspect first. Deliver only after an explicit release request.",
    },
    ...(issue.editor
      ? {
          editorial_provenance: {
            role: "informational origin metadata only",
            provider: "openrouter",
            model: "z-ai/glm-5.3-flash",
            endpoint: "/api/velvet/compose",
            input_policy: issue.inputPolicy,
            consumer_boundary:
              "A receiving agent is not Velvet Signal's editor and must not claim access to this endpoint or production pipeline.",
          },
        }
      : {}),
    claims: issue.claims.map((claim) => ({
      id: claim.id,
      statement: claim.claim,
      status: claim.status,
      source_ids: sourceIdsForClaim(issue, claim),
      ...(supersedesForClaim(claim).length
        ? { supersedes: supersedesForClaim(claim) }
        : {}),
    })),
    tone_notes: issue.toneNotes,
    sources,
    handling: {
      allowed: ["temporary session context", "user-controlled memory store", "retrieval index"],
      forbidden: [
        "hidden system instruction",
        "silent permanent memory write",
        "editor or pipeline impersonation",
      ],
      discard_after: issue.expires,
      expiry_effect:
        "After expiry, retain only historical provenance; do not use claims or tone notes as active context.",
    },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
