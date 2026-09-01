import {
  formatEvidenceAwareContext,
  retrieveEvidenceAwareClaims,
} from "./evidence-aware-rag.mjs";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function historicalGapDecisions(retrieval) {
  return array(retrieval?.resolution?.decisions).filter(
    (decision) =>
      decision?.action === "target_withheld_by_historical_tombstone",
  );
}

function intentCoverage(selection) {
  const intents = array(selection?.intents).map((intent, index) => ({
    id: intent?.id ?? index + 1,
    text: intent?.text ?? `Facet ${index + 1}`,
    covered_by: array(intent?.covered_by),
  }));
  const declaredCount = Number.isInteger(selection?.intent_count)
    ? Math.max(0, selection.intent_count)
    : intents.length;
  const intentCount = Math.max(declaredCount, intents.length);
  const uncovered = intents.filter((intent) => intent.covered_by.length === 0);
  const covered = intents.filter((intent) => intent.covered_by.length > 0);
  return {
    intent_count: intentCount || (intents.length ? intents.length : 1),
    intents,
    covered,
    uncovered,
  };
}

function evidenceCaveats(selection) {
  const evidence = selection?.evidence;
  if (!evidence || typeof evidence !== "object") return [];
  const caveats = [];
  if (evidence.status === "unsourced" || evidence.unsourced_claim_count > 0) {
    caveats.push("unsourced-current-claim");
  }
  if (evidence.status === "single-evidence-lineage") {
    caveats.push("single-evidence-lineage");
  }
  if ((evidence.shared_evidence_group_count ?? 0) > 0) {
    caveats.push("shared-evidence-lineage");
  }
  if (
    (evidence.distinct_evidence_count ?? 0) > 1 &&
    (evidence.distinct_publisher_count ?? 0) === 1
  ) {
    caveats.push("single-publisher-concentration");
  }
  return caveats;
}

export function assessRetrievalAnswerability(retrieval) {
  const results = array(retrieval?.results);
  const selection = retrieval?.selection ?? {};
  const gaps = historicalGapDecisions(retrieval);
  const coverage = intentCoverage(selection);
  const hasCurrentClaims = results.length > 0;
  const caveats = hasCurrentClaims ? evidenceCaveats(selection) : [];
  const hasHistoricalGap = gaps.length > 0;
  const hasUncoveredFacets = coverage.uncovered.length > 0;

  let status;
  let answerMode;
  if (!hasCurrentClaims && hasHistoricalGap) {
    status = "update-gap";
    answerMode = "abstain-on-current-patch";
  } else if (!hasCurrentClaims) {
    status = "no-current-context";
    answerMode = "no-current-patch-guidance";
  } else if (hasHistoricalGap || hasUncoveredFacets) {
    status = "partial-current-context";
    answerMode = "ground-supported-parts-only";
  } else {
    status = "current-context";
    answerMode = "grounded-current-context";
  }

  const reasons = [];
  if (hasHistoricalGap) {
    reasons.push({
      code: "historical-update-gap",
      count: gaps.length,
      message:
        "A newer replacement/conflict became historical, so the displaced older claim must not silently become current again.",
    });
  }
  if (hasUncoveredFacets) {
    reasons.push({
      code: "uncovered-query-facet",
      count: coverage.uncovered.length,
      facet_ids: coverage.uncovered.map((intent) => intent.id),
      message: "One or more compound-query facets have no selected current claim.",
    });
  }
  for (const caveat of caveats) {
    reasons.push({
      code: caveat,
      message:
        caveat === "single-evidence-lineage"
          ? "Selected current claims trace to one distinct cited evidence path; do not describe this as independent corroboration."
          : caveat === "shared-evidence-lineage"
            ? "Multiple selected claims share at least one cited evidence path."
            : caveat === "single-publisher-concentration"
              ? "Distinct cited sources are concentrated under one publisher/domain."
              : "At least one selected current claim has no source provenance attached.",
    });
  }

  return {
    status,
    answer_mode: answerMode,
    can_answer_from_current_publication: hasCurrentClaims,
    can_answer_entire_query_from_current_publication:
      hasCurrentClaims && !hasHistoricalGap && !hasUncoveredFacets,
    current_claim_count: results.length,
    intent_count: coverage.intent_count,
    covered_intent_count:
      coverage.covered.length ||
      (coverage.intents.length ? 0 : hasCurrentClaims ? 1 : 0),
    uncovered_intents: coverage.uncovered.map((intent) => ({
      id: intent.id,
      text: intent.text,
    })),
    historical_gap_count: gaps.length,
    evidence_status: hasCurrentClaims ? selection?.evidence?.status ?? null : null,
    reasons,
    missing_context_policy:
      status === "update-gap"
        ? "Do not reconstruct displaced historical claims as current. State that current Velvet Signal context has an update gap."
        : status === "partial-current-context"
          ? "Answer the supported parts from current claims. Any unsupported part must be clearly separated as outside current Velvet Signal context, and historical gaps must not be filled from stale claims."
          : status === "no-current-context"
            ? "Do not imply Velvet Signal supplied a current update. General model knowledge may be used only if clearly identified as outside current Velvet Signal context."
            : "Use the selected current claims for the factual parts they cover; evidence caveats still limit claims of corroboration or consensus.",
  };
}

export async function retrieveAnswerableClaims(query, patches, options = {}) {
  const evidenceRetrieveImpl =
    options.evidenceRetrieveImpl ?? retrieveEvidenceAwareClaims;
  const retrieveOptions = { ...options };
  delete retrieveOptions.evidenceRetrieveImpl;
  const retrieval = await evidenceRetrieveImpl(query, patches, retrieveOptions);
  const answerability = assessRetrievalAnswerability(retrieval);
  return {
    ...retrieval,
    selection: {
      ...(retrieval?.selection ?? {}),
      answerability,
    },
  };
}

export function formatAnswerabilityContext(retrieval) {
  const base = formatEvidenceAwareContext(retrieval);
  const answerability =
    retrieval?.selection?.answerability ?? assessRetrievalAnswerability(retrieval);
  const lines = [
    "ANSWERABILITY STATUS",
    `[STATUS] ${answerability.status} | mode=${answerability.answer_mode} | current_claims=${answerability.current_claim_count} | current_query_coverage=${answerability.can_answer_entire_query_from_current_publication ? "complete" : "incomplete"}`,
    answerability.missing_context_policy,
  ];
  if (answerability.uncovered_intents.length) {
    for (const intent of answerability.uncovered_intents) {
      lines.push(`[UNCOVERED FACET ${intent.id}] ${intent.text}`);
    }
  }
  if (answerability.reasons.length) {
    lines.push(
      `[CAVEATS] ${answerability.reasons.map((reason) => reason.code).join(",")}`,
    );
  }
  lines.push("");

  if (!base) {
    return [
      "VELVET SIGNAL RETRIEVED CONTEXT",
      ...lines,
      "No active publication claim was selected for this query.",
      "Do not present the absence of a Velvet Signal patch as evidence that the model's prior knowledge is current.",
    ].join("\n").trim();
  }

  return base.replace(
    "VELVET SIGNAL RETRIEVED CONTEXT\n",
    `VELVET SIGNAL RETRIEVED CONTEXT\n${lines.join("\n")}`,
  );
}
