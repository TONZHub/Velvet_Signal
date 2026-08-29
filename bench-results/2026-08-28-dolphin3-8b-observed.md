# VS-Bench observed run — Dolphin 3:8B

- Date: 2026-08-28
- Model: `dolphin3:8b`
- Path: local Ollama baseline vs Velvet-patched
- Retrieval mode: lexical
- Scenarios: 8 executed / 0 skipped
- Deterministic retrieval checks: **11 passed / 0 failed**
- Generation adherence under the v0.2.0 rubric: **6/8 passed / 2 failed**

> This is a development field run, not a statistically powered accuracy benchmark. Retrieval correctness and generation adherence are scored separately.

## Five-day chicken

**Baseline:** began by saying the five-day refrigerated cooked chicken could be eaten, then stated a 3–4 day storage rule and fell back to sensory spoilage checks.

**Velvet-patched:** applied the retrieved 3–4 day cooked-leftover window to the stated five days and said the chicken was outside the recommended storage time.

Retrieval selected current Pantry claims and passed both deterministic checks.

## Multi-intent leftovers

The query asked both whether five-day refrigerated chicken was acceptable and how long frozen leftovers could be kept.

Velvet Signal detected and covered **2/2 facets**. The patched model applied the current refrigerator limit and the retrieved frozen-storage window.

## Overlap with meaningful delta

The deterministic synthetic fixture selected two highly overlapping claims where the second added a distinct freezer duration. VS-Bench preserved the unique detail rather than flattening the claims into a duplicate.

## Evidence concentration

The Maker query selected three claims but VS-Bench reported **1 distinct evidence lineage / 1 publisher / 1 shared group**. The patched model used current Flowise and TGI archive facts while noting that the retrieved claims did not directly prescribe developer next steps.

The baseline model said its knowledge ended in April 2023 and did not know the current Flowise/TGI situation.

## No current context

For `Who won the 1998 World Cup?`, retrieval returned **no claims** and answerability reported `no-current-context`.

This scenario exists because the first benchmark attempt exposed a real bug: zero-relevance lexical candidates were previously allowed to fill the retrieval limit. The benchmark caught it, the fallback was removed, and a regression test now protects the behavior.

**Generation-adherence miss:** Dolphin answered from general knowledge but did not explicitly label that answer as outside current Velvet Signal context.

## Partial current context

For a compound leftovers + World Cup query, Velvet Signal covered **1/2 facets** and reported `partial-current-context`. The patched model correctly answered the leftovers part from Velvet and explicitly labeled the World Cup answer as outside current Velvet Signal context.

## Tiny context budget

The 1200-character soft budget preserved mandatory claims even though the mandatory packet exceeded the soft ceiling. Optional diagnostics were omitted first.

**Generation-adherence miss:** the smell-safety claim was retrieved, but Dolphin treated that facet as uncovered rather than applying the retrieved guardrail.

## Historical update gap

The baseline model invented an unrelated Synthetic Control Method explanation from the phrase “synthetic policy.”

The Velvet-patched model recognized the explicit replacement relationship, did not silently resurrect revision one as current truth, and named the current update gap.

## Why this run matters

This was the first complete same-model A/B run where Velvet Signal could be evaluated as its own subsystem:

- the retrieval stack passed all deterministic expectations;
- the underlying model visibly changed behavior when given current Velvet context;
- model-side failures remained visible instead of being mislabeled as retrieval failures;
- the benchmark itself found a genuine zero-relevance retrieval bug before this milestone was frozen.
