const DEFAULT_CONTEXT_BUDGET_CHARS = 6000;
const MIN_CONTEXT_BUDGET_CHARS = 800;
const MAX_CONTEXT_BUDGET_CHARS = 30000;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampBudget(value) {
  if (!Number.isFinite(value)) return DEFAULT_CONTEXT_BUDGET_CHARS;
  return Math.max(
    MIN_CONTEXT_BUDGET_CHARS,
    Math.min(MAX_CONTEXT_BUDGET_CHARS, Math.floor(value)),
  );
}

function shortReason(value) {
  const reason = clean(value);
  if (!reason) return "";
  return reason.length <= 180 ? ` reason=${reason}` : " reason=see-inspect";
}

function sourceLabels(item) {
  const sources = array(item?.sources);
  if (sources.length) {
    return sources.map((source) => {
      const id = clean(source?.id) || "source";
      const publisher = clean(source?.publisher);
      return publisher ? `${id}@${publisher}` : id;
    });
  }
  return array(item?.source_ids).map((id) => clean(id)).filter(Boolean);
}

function renderSections(sectionOrder, sections) {
  const lines = ["VELVET SIGNAL COMPACT CURRENT CONTEXT", ""];
  for (const name of sectionOrder) {
    const section = sections.get(name);
    if (!section?.lines?.length) continue;
    lines.push(section.title, ...section.lines, "");
  }
  return lines.join("\n").trim();
}

function makeSections() {
  return new Map([
    ["policy", { title: "PATCH POLICY", lines: [] }],
    ["answerability", { title: "ANSWERABILITY", lines: [] }],
    ["claims", { title: "CURRENT CLAIMS", lines: [] }],
    ["relationships", { title: "EXPLICIT RELATIONSHIPS", lines: [] }],
    ["facets", { title: "QUERY FACETS", lines: [] }],
    ["deltas", { title: "MEANINGFUL OVERLAP DELTAS", lines: [] }],
    ["evidence", { title: "EVIDENCE", lines: [] }],
    ["packing", { title: "PACKING NOTE", lines: [] }],
  ]);
}

const SECTION_ORDER = [
  "policy",
  "answerability",
  "claims",
  "relationships",
  "facets",
  "deltas",
  "evidence",
  "packing",
];

function answerabilityLines(retrieval) {
  const answerability = retrieval?.selection?.answerability;
  if (!answerability) {
    return [
      "[STATUS] unavailable",
      "Do not imply Velvet Signal supplied a current update when no answerability assessment is present.",
    ];
  }
  const lines = [
    `[STATUS] ${answerability.status} mode=${answerability.answer_mode} current_claims=${answerability.current_claim_count} full_current_coverage=${answerability.can_answer_entire_query_from_current_publication ? "yes" : "no"}`,
  ];
  if (clean(answerability.missing_context_policy)) {
    lines.push(clean(answerability.missing_context_policy));
  }
  for (const intent of array(answerability.uncovered_intents)) {
    lines.push(`[UNCOVERED FACET ${intent.id}] ${clean(intent.text)}`);
  }
  return lines;
}

function claimLines(results) {
  const lines = [];
  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    const sources = sourceLabels(item);
    const relationshipCount = array(item?.relationships).length;
    lines.push(
      `[C${index + 1} | ${item.patch_id}/${item.claim_id} | CURRENT] published=${item.published_at ?? "unknown"} valid_until=${item.valid_until ?? "unknown"}${sources.length ? ` sources=${sources.join(",")}` : ""}${relationshipCount ? ` relationships=${relationshipCount}` : ""}`,
      clean(item.statement),
    );
  }
  if (!results.length) {
    lines.push("No active publication claim was selected for this query.");
  }
  return lines;
}

function relationshipLines(retrieval) {
  return array(retrieval?.resolution?.decisions).map((decision) =>
    `[REL ${String(decision.type ?? "unknown").toUpperCase()}] ${decision.source_id} -> ${decision.target_id} action=${decision.action}${shortReason(decision.reason)}`,
  );
}

function evidenceSummaryLine(retrieval) {
  const evidence = retrieval?.selection?.evidence;
  if (!evidence) return null;
  return `[SUMMARY] status=${evidence.status} distinct_evidence=${evidence.distinct_evidence_count} publishers=${evidence.distinct_publisher_count} shared_groups=${evidence.shared_evidence_group_count} unsourced_claims=${evidence.unsourced_claim_count}`;
}

function optionalFacetEntries(retrieval) {
  const selection = retrieval?.selection;
  if (!Array.isArray(selection?.intents) || selection.intents.length <= 1) return [];
  return selection.intents
    .filter((intent) => array(intent?.covered_by).length > 0)
    .map((intent) => ({
      section: "facets",
      priority: 2,
      line: `[FACET ${intent.id}] ${clean(intent.text)} covered_by=${array(intent.covered_by).join(",")}`,
    }));
}

function uniqueDetailText(detail) {
  const parts = [];
  if (array(detail?.quantities).length) {
    parts.push(`quantities=${detail.quantities.join(";")}`);
  }
  if (array(detail?.terms).length) {
    parts.push(`terms=${detail.terms.join(",")}`);
  }
  return parts.join(" ") || "none-detected";
}

function optionalDeltaEntries(retrieval) {
  const report = retrieval?.selection?.content_overlap;
  if (!Array.isArray(report?.pairs)) return [];
  return report.pairs
    .filter((pair) => pair.has_distinct_details)
    .map((pair) => ({
      section: "deltas",
      priority: 1,
      line: `[DELTA ${pair.left_id} <-> ${pair.right_id}] overlap=${Number(pair.overlap_score ?? 0).toFixed(2)} descriptive_only=yes | ${pair.left_id} adds ${uniqueDetailText(pair.left_unique)} | ${pair.right_id} adds ${uniqueDetailText(pair.right_unique)}`,
    }));
}

function optionalEvidenceEntries(retrieval) {
  const evidence = retrieval?.selection?.evidence;
  if (!Array.isArray(evidence?.bundles)) return [];
  return evidence.bundles
    .filter((bundle) => bundle.shared_by_multiple_claims)
    .map((bundle) => ({
      section: "evidence",
      priority: 3,
      line: `[SHARED ${bundle.id}] supports=${array(bundle.supports).join(",")} publishers=${array(bundle.publishers).join(",") || "unknown"}`,
    }));
}

function addMandatorySections(sections, retrieval) {
  sections.get("policy").lines.push(
    "Use current Velvet Signal claims for factual parts they directly cover; newer explicit user instructions still take precedence.",
    "Apply quantitative limits literally. Do not invent exceptions or use sensory cues/prior knowledge to override a retrieved limit unless current patch context explicitly permits it.",
    "Only explicit claim metadata establishes replaces/narrows/confirms/conflicts. Content overlap, embeddings, and source diversity are descriptive retrieval signals, not factual authority.",
    "Never resurrect a displaced historical claim to fill an update gap.",
    "If a facet has no current patch coverage, keep any general model knowledge clearly separated as outside current Velvet Signal context.",
    "Multiple cited sources improve diversity but do not by themselves prove consensus, independence, or correctness.",
  );
  sections.get("answerability").lines.push(...answerabilityLines(retrieval));
  sections.get("claims").lines.push(...claimLines(array(retrieval?.results)));
  sections.get("relationships").lines.push(...relationshipLines(retrieval));
  const evidenceSummary = evidenceSummaryLine(retrieval);
  if (evidenceSummary) sections.get("evidence").lines.push(evidenceSummary);
}

function optionalEntries(retrieval) {
  return [
    ...optionalDeltaEntries(retrieval),
    ...optionalFacetEntries(retrieval),
    ...optionalEvidenceEntries(retrieval),
  ].sort((left, right) => left.priority - right.priority);
}

function nonEmptySectionNames(sections) {
  return SECTION_ORDER.filter((name) => sections.get(name)?.lines?.length > 0);
}

export function buildBudgetedContext(retrieval, options = {}) {
  const budgetChars = clampBudget(options.maxChars);
  const sections = makeSections();
  addMandatorySections(sections, retrieval);
  const mandatoryText = renderSections(SECTION_ORDER, sections);
  const mandatoryChars = mandatoryText.length;
  const candidates = optionalEntries(retrieval);
  const included = [];
  const omitted = [];

  for (const candidate of candidates) {
    if (mandatoryChars > budgetChars) {
      omitted.push(candidate);
      continue;
    }
    const section = sections.get(candidate.section);
    section.lines.push(candidate.line);
    const proposed = renderSections(SECTION_ORDER, sections);
    if (proposed.length <= budgetChars) {
      included.push(candidate);
    } else {
      section.lines.pop();
      omitted.push(candidate);
    }
  }

  if (omitted.length) {
    const bySection = new Map();
    for (const candidate of omitted) {
      bySection.set(candidate.section, (bySection.get(candidate.section) ?? 0) + 1);
    }
    const summary = `[OPTIONAL OMITTED] ${[...bySection.entries()]
      .map(([section, count]) => `${section}=${count}`)
      .join(",")} — use inspect for full diagnostics.`;
    sections.get("packing").lines.push(summary);
    const proposed = renderSections(SECTION_ORDER, sections);
    if (proposed.length > budgetChars || mandatoryChars > budgetChars) {
      sections.get("packing").lines.pop();
    }
  }

  const text = renderSections(SECTION_ORDER, sections);
  return {
    text,
    diagnostics: {
      budget_chars: budgetChars,
      used_chars: text.length,
      approximate_tokens: Math.ceil(text.length / 4),
      mandatory_chars: mandatoryChars,
      hard_minimum_exceeded: mandatoryChars > budgetChars,
      included_optional_count: included.length,
      omitted_optional_count: omitted.length,
      omitted_by_section: Object.fromEntries(
        [...new Set(omitted.map((candidate) => candidate.section))].map(
          (section) => [
            section,
            omitted.filter((candidate) => candidate.section === section).length,
          ],
        ),
      ),
      sections_included: nonEmptySectionNames(sections),
    },
  };
}

export function formatBudgetedContext(retrieval, options = {}) {
  return buildBudgetedContext(retrieval, options).text;
}

export const CONTEXT_BUDGET_DEFAULTS = Object.freeze({
  default_chars: DEFAULT_CONTEXT_BUDGET_CHARS,
  min_chars: MIN_CONTEXT_BUDGET_CHARS,
  max_chars: MAX_CONTEXT_BUDGET_CHARS,
});
