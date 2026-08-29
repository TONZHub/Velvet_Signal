const NUMBER_PATTERN = /\b\\d+(?:\\.\\d+)?\b/g;

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9%°.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numbers(value) {
  return [...String(value ?? "").matchAll(NUMBER_PATTERN)].map((match) => match[0]);
}

function comparableKey(value) {
  const text = normalize(value);
  return text.replace(/\b(the|a|an|can|should|may|must|is|are|be|for|of|to|and)\b/g, " ").replace(/\s+/g, " ").trim();
}

function overlap(left, right) {
  const a = new Set(comparableKey(left).split(" ").filter((token) => token.length > 3));
  const b = comparableKey(right).split(" ").filter((token) => token.length > 3);
  if (!a.size || !b.length) return 0;
  return b.filter((token) => a.has(token)).length / Math.min(a.size, b.length);
}

/** Conservative check: related packets with different numeric facts need review. */
export function compareSourcePackets(sources = []) {
  const conflicts = [];
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const left = sources[i];
      const right = sources[j];
      const subjectOverlap = overlap(`${left.title} ${left.excerpt}`, `${right.title} ${right.excerpt}`);
      if (subjectOverlap < 0.35) continue;
      const leftNumbers = numbers(left.excerpt).join(",");
      const rightNumbers = numbers(right.excerpt).join(",");
      if (leftNumbers && rightNumbers && leftNumbers !== rightNumbers) conflicts.push({
        type: "numeric-disagreement",
        source_ids: [left.id, right.id],
        reason: "Related source packets contain different numeric values. Human/editor resolution required.",
      });
    }
  }
  return conflicts;
}

export function sourceAgreement(sources = []) {
  const conflicts = compareSourcePackets(sources);
  return { status: conflicts.length ? "conflict" : "clear", checked: sources.length, conflicts };
}