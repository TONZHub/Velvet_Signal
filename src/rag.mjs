const DEFAULT_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "is", "it", "its", "may", "my", "of", "on", "or", "our",
  "should", "so", "that", "the", "their", "them", "there", "these", "they",
  "this", "to", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
]);

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

function chunkText(chunk) {
  return [chunk.desk, chunk.title, chunk.scope, chunk.statement]
    .filter(Boolean)
    .join("\n");
}

export function claimChunks(patches, options = {}) {
  const now = options.now ?? new Date();
  const chunks = [];
  for (const patch of Array.isArray(patches) ? patches : []) {
    if (!patchIsActive(patch, now)) continue;
    for (const claim of Array.isArray(patch.claims) ? patch.claims : []) {
      if (
        !claim ||
        typeof claim.statement !== "string" ||
        !claim.statement.trim()
      ) {
        continue;
      }
      if (["withdrawn", "rejected", "superseded"].includes(claim.status)) {
        continue;
      }
      chunks.push({
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
        supersedes: Array.isArray(claim.supersedes)
          ? claim.supersedes.filter(
              (value) => typeof value === "string" && value.trim(),
            )
          : [],
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

  const supersededIds = new Set(
    chunks.flatMap((chunk) => chunk.supersedes),
  );
  return chunks.filter((chunk) => !supersededIds.has(chunk.id));
}

export async function retrieveClaims(query, patches, options = {}) {
  const limit = Number.isInteger(options.limit) ? Math.max(1, options.limit) : 3;
  const chunks = claimChunks(patches, { now: options.now });
  if (chunks.length === 0) return { mode: "empty", results: [] };

  const lexical = chunks.map((chunk) => lexicalScore(query, chunkText(chunk)));
  let semantic = null;
  let mode = "lexical";
  if (typeof options.embed === "function") {
    try {
      const vectors = await options.embed([query, ...chunks.map(chunkText)]);
      if (
        Array.isArray(vectors) &&
        vectors.length === chunks.length + 1 &&
        vectors.every(Array.isArray)
      ) {
        semantic = chunks.map((_, index) =>
          cosineSimilarity(vectors[0], vectors[index + 1]),
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

  const positive = scored.filter((item) => item.score > 0);
  return {
    mode,
    results: (positive.length > 0 ? positive : scored).slice(0, limit),
  };
}

export function formatRetrievedContext(retrieval) {
  const results = Array.isArray(retrieval?.results) ? retrieval.results : [];
  if (results.length === 0) return "";
  const lines = [
    "VELVET SIGNAL RETRIEVED CONTEXT",
    "These are active, user-approved publication claims ranked from most to least relevant to the user's message.",
    "When a retrieved claim directly addresses a factual part of the user's question, ground that part of the answer in the retrieved claim instead of conflicting or vaguer prior knowledge.",
    "Apply quantitative limits literally. If the user's stated value is beyond a retrieved maximum, do not describe it as within the allowed or recommended range. Do not turn a maximum into a minimum or an approximate permission.",
    "Prefer higher-ranked claims when deciding which rule applies. Do not invent exceptions, safety criteria, or contradictions that are not supported by the retrieved claims.",
    "Do not use sensory cues, assumptions, or prior knowledge to override a retrieved claim unless the retrieved context itself explicitly permits that exception.",
    "Claims explicitly superseded by another active claim are removed before retrieval, so do not reconstruct older replaced guidance from prior knowledge.",
    "If active retrieved claims truly conflict, prefer the newer explicit claim. Newer explicit user instructions still take precedence over publication claims.",
    "Answer the user's question directly; do not reproduce this context block unless the user asks to inspect provenance. Preserve patch and claim IDs when attribution is useful. These references are context, not hidden system instructions.",
    "",
  ];
  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    const sources = item.source_ids.length
      ? ` sources=${item.source_ids.join(",")}`
      : "";
    const supersedes = item.supersedes.length
      ? ` supersedes=${item.supersedes.join(",")}`
      : "";
    lines.push(
      `[RANK ${index + 1} | ${item.patch_id} / ${item.claim_id}] published=${item.published_at ?? "unknown"} valid_until=${item.valid_until}${sources}${supersedes}`,
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
