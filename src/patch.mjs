import { normalizeClaimRelationships } from "./claim-relations.mjs";
import { sourceAgreement } from "./source-conflicts.mjs";

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

export function evidenceForClaim(issue, claim) {
  const sourceIds = sourceIdsForClaim(issue, claim);
  const sources = issue.sources
    .map((source, index) => ({
      id: sourceIdFor(issue, source, index),
      publisher: String(source.publisher ?? "").trim().toLowerCase(),
    }))
    .filter((source) => sourceIds.includes(source.id));
  const publishers = new Set(
    sources.map((source) => source.publisher).filter(Boolean),
  );
  const editorialStatus = String(claim.status ?? "").trim().toLowerCase();
  const status = editorialStatus === "needs-review"
    ? "needs-review"
    : editorialStatus.includes("editorial")
      ? "editorial-rule"
      : publishers.size >= 2
        ? "independently-verified"
        : "source-reported";
  return {
    status,
    source_count: sources.length,
    publisher_count: publishers.size,
  };
}

export function patchForIssue(issue, options = {}) {
  const deliveryStatus = options.deliveryStatus ?? "locked";
  const approved = deliveryStatus === "delivered";
  const scoutedSources = issue.sources.map((source, index) => ({
    id: sourceIdFor(issue, source, index),
    title: source.name,
    publisher: source.publisher,
    url: source.url,
    checked_at: source.checked,
  }));
  const supportingSourceIds = new Set(
    issue.claims.flatMap((claim) => sourceIdsForClaim(issue, claim)),
  );
  const sources = scoutedSources.filter((source) => supportingSourceIds.has(source.id));
  const agreement = sourceAgreement(sources.map((source) => ({
    ...source,
    excerpt: issue.claims
      .filter((claim) => sourceIdsForClaim(issue, claim).includes(source.id))
      .map((claim) => claim.claim)
      .join(" "),
  })));
  const sourceSelection = {
    scouted_count: scoutedSources.length,
    supporting_count: sources.length,
    excluded_count: scoutedSources.length - sources.length,
    policy: "Delivered patches include only sources cited by published claims; scouting candidates remain editorial input, not supporting evidence.",
  };
  return {
    patch_id: issue.id,
    publication: "Velvet Signal",
    desk: issue.desk,
    issue: issue.issue,
    title: issue.title,
    version: issue.version ?? "1.0.0",
    published_at: issue.publishedAt ?? "2026-08-27",
    valid_until: issue.expires,
    scope: issue.scope,
    source_selection: sourceSelection,
    claim_status_policy: {
      "source-reported": "Supported by the cited publication or repository, without independent corroboration.",
      "independently-verified": "Supported by cited sources from at least two distinct publishers.",
      "needs-review": "Material uncertainty remains unresolved.",
      "editorial-rule": "A publication handling rule rather than an externally verified fact.",
    },
    source_agreement: agreement,
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
    claims: issue.claims.map((claim) => {
      const relationships = normalizeClaimRelationships(claim);
      const supersedes = relationships
        .filter((relationship) => relationship.type === "replaces")
        .map((relationship) => relationship.target_id);
      const evidence = evidenceForClaim(issue, claim);
      return {
        id: claim.id,
        statement: claim.claim,
        status: evidence.status,
        editorial_status: claim.status,
        source_ids: sourceIdsForClaim(issue, claim),
        evidence: {
          source_count: evidence.source_count,
          publisher_count: evidence.publisher_count,
        },
        ...(relationships.length ? { relationships } : {}),
        ...(supersedes.length ? { supersedes } : {}),
      };
    }),
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
