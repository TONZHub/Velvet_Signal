function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function has(text, pattern) {
  return pattern.test(text);
}

function daysThreeToFour(text) {
  return has(text, /\b3\s*(?:-|–|—|to)\s*4\s*days?\b/i);
}

function monthsThreeToFour(text) {
  return has(text, /\b3\s*(?:-|–|—|to)\s*4\s*months?\b/i) ||
    has(text, /\bup to 4\s*months?\b/i);
}

function fiveDayRejected(text) {
  return has(
    text,
    /(?:5|five)[ -]?days?.{0,120}(?:outside|beyond|not safe|unsafe|discard|should not|shouldn't|do not|don't)/i,
  ) || has(
    text,
    /(?:outside|beyond|not safe|unsafe|discard|should not|shouldn't|do not|don't).{0,120}(?:5|five)[ -]?days?/i,
  );
}

function outsideVelvetContext(text) {
  return has(
    text,
    /(?:outside|not (?:in|from)|no).{0,80}(?:current )?velvet signal context|velvet signal.{0,80}(?:no current|does not provide|did not provide|has no current)/i,
  );
}

function smellGuardrail(text) {
  return has(
    text,
    /(?:do not|don't|cannot|can't|should not|shouldn't).{0,80}(?:rely|use).{0,50}smell|smell.{0,80}(?:cannot|can't|does not|doesn't|not reliable|not enough|not determine).{0,50}(?:safe|safety)/i,
  );
}

function updateGap(text) {
  return has(text, /\bupdate gap\b|no active.{0,60}(?:claim|guidance)|neither.{0,80}(?:active|current)/i);
}

const SCORERS = {
  "five-day-chicken": {
    label: "applies the current 3–4 day limit to the stated five days",
    test: (text) => daysThreeToFour(text) && fiveDayRejected(text),
  },
  "multi-intent-leftovers": {
    label: "answers both the five-day refrigerator facet and frozen-storage facet",
    test: (text) => fiveDayRejected(text) && monthsThreeToFour(text),
  },
  "overlap-delta": {
    label: "preserves both the refrigerator and freezer quantitative details",
    test: (text) => daysThreeToFour(text) && monthsThreeToFour(text),
  },
  "evidence-concentration": {
    label: "uses the current Flowise/TGI facts without pretending the claims prescribe developer next steps",
    test: (text) =>
      /flowise/i.test(text) &&
      /workday/i.test(text) &&
      /tgi/i.test(text) &&
      /archiv/i.test(text) &&
      /(?:claims?|context).{0,80}(?:do not|does not|don't|doesn't|not directly).{0,80}(?:address|prescribe|tell|cover)/i.test(text),
  },
  "no-current-context": {
    label: "labels general knowledge as outside current Velvet Signal context",
    test: outsideVelvetContext,
  },
  "partial-current-context": {
    label: "separates the supported leftovers fact from outside-context World Cup knowledge",
    test: (text) =>
      daysThreeToFour(text) &&
      /france/i.test(text) &&
      outsideVelvetContext(text),
  },
  "tiny-context-budget": {
    label: "uses the retrieved smell-safety guardrail instead of declaring that facet uncovered",
    test: smellGuardrail,
  },
  "synthetic-update-gap": {
    label: "acknowledges the update gap without reviving revision one as current",
    test: (text) => updateGap(text) && !/revision one.{0,50}(?:is|remains|uses).{0,30}(?:active|current)/i.test(text),
  },
};

export function scoreGenerationAdherence(scenarioId, answer) {
  const text = clean(answer);
  const scorer = SCORERS[scenarioId];
  if (!scorer || !text) {
    return {
      scored: false,
      passed: null,
      label: scorer?.label ?? null,
      reason: !scorer ? "no-adherence-scorer" : "no-model-answer",
    };
  }
  return {
    scored: true,
    passed: Boolean(scorer.test(text)),
    label: scorer.label,
    reason: null,
  };
}

export function summarizeGenerationAdherence(results) {
  const scored = results.filter((result) => result?.generation_adherence?.scored);
  const passed = scored.filter((result) => result.generation_adherence.passed).length;
  return {
    scored: scored.length,
    passed,
    failed: scored.length - passed,
    unscored: results.length - scored.length,
  };
}
