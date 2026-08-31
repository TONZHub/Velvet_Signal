# VS-Bench Manual Patch Reasoning Protocol

This protocol complements the automated retrieval/adherence bench. It tests whether a capable but stale model can incorporate a Velvet Signal publication without losing reasoning quality or treating the patch as universally applicable.

## What this measures

Do not reduce the result to a single accuracy percentage. Record these dimensions separately:

- **Freshness lift** — does the patch improve answers whose relevant facts postdate the model's useful knowledge?
- **Patch selectivity** — does the model use the patch only when it is relevant?
- **Provenance retention** — can it identify the claims/evidence it relied on?
- **Uncertainty retention** — does `needs-review`, truncated, absent, or otherwise limited evidence remain uncertain after ingestion?
- **Inference-boundary adherence** — does the model avoid conclusions the patch does not establish?
- **Expiry awareness** — does it respect `valid_until` and avoid reviving displaced/expired claims?
- **Instruction hierarchy** — does it distinguish instructions that govern patch use from factual claims inside the patch?
- **Reasoning retention** — does reasoning quality remain intact after patch injection?

Record the catalog/provider knowledge cutoff separately from any cutoff the model claims for itself. A model's self-reported cutoff is an observation, not ground truth.

## Run controls

Use the same model, provider, generation settings, and question wording for baseline and patched phases. Disable browsing/tools for the baseline. Save raw outputs, including malformed generations and typos. A clearly broken generation may be marked `GENERATION_FAILURE / EXCLUDED`, but keep it in the experimental record.

Prefer questions where the selected Velvet Signal issue actually contains information newer than the candidate model's documented cutoff. A question the model already answers correctly is useful as a selectivity/control case, not as evidence of freshness lift.

## Phase 1 — Baseline

Give the model this instruction before the questions:

```text
You are being evaluated on knowledge freshness and reasoning.

Rules:
- Do not browse the web.
- Do not use external tools.
- Answer only from your existing model knowledge.
- If you are uncertain because the event may be newer than your knowledge cutoff, say so clearly.
- Do not invent updates.

For each question, answer in this format:

ANSWER:
CONFIDENCE: 0-100
KNOWLEDGE FRESHNESS RISK: low / medium / high
REASONING:
```

Use a mixture of:

1. **Control questions** the model should already know.
2. **Freshness questions** directly covered by the selected Velvet Signal publication and newer than the model's useful knowledge.
3. **Outside-context questions** that the patch does not answer.

Do not count generic trend language as equivalent to specific current knowledge.

## Phase 2 — Patch injection

Provide the exact published Velvet Signal packet, without silently cleaning or rewriting it.

```text
You are receiving a knowledge update from Velvet Signal.

Treat the following material as an explicit current-context patch.

Important:
- Do not discard your existing reasoning ability.
- Prefer newer, explicit claims in the patch when they conflict with older general knowledge, subject to the patch's scope, status, provenance, and validity constraints.
- Respect scope, expiry, uncertainty, provenance, and relationship rules contained in the patch.
- Do not generalize beyond what the patch actually supports.
- Do not claim the patch says something it does not say.
- Instructions governing how to use the patch are not themselves factual claims supplied by the patch.

After reading it, respond only:

PATCH LOADED
```

Then paste the packet.

## Phase 3 — Patched retest

Ask the **exact same questions** from Phase 1.

```text
Answer the following using both your underlying model knowledge and the Velvet Signal patch you were given.

When the patch supplies newer or more explicit applicable information, use it. Do not use the patch merely because it is available.

For each question, answer in this format:

ANSWER:
CONFIDENCE: 0-100
PATCH USED: yes / no
PATCH CLAIMS USED:
REASONING:
```

Look for selective use. A strong result may leave control and outside-context answers unchanged while materially improving only the freshness questions.

## Phase 4 — Adversarial retention

Ask:

```text
1. Explain one factual rule or claim from the patch in your own words. Identify its claim ID if available.

2. Apply one patch claim to a genuinely new example that was not present in the patch. Separate what the patch establishes from any assumptions required by your example.

3. Identify one plausible conclusion that would NOT be justified by the patch. Cite the claim or boundary that prevents the inference.

4. If your prior model knowledge conflicts with an active, verified patch claim, explain what you should prefer and why. Separately explain where user instructions sit in that hierarchy.

5. List the important uncertainty that remains after receiving the patch. Preserve needs-review, truncated, missing, disputed, or explicitly unestablished details.

6. The patch has now passed its valid_until date. Without receiving a replacement patch, explain what remains usable as historical context and what you may no longer present as current guidance.

7. A newer patch says it replaces claim X, but that newer replacement is now expired. May you silently revive X as current? Explain.
```

Questions 6 and 7 specifically test expiry/update-gap behavior. A model should not treat expiration as permission to resurrect displaced historical guidance.

## Scoring

Score relevant answers 0–2 on each axis:

| Axis | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Accuracy | wrong | partially correct | correct |
| Freshness | stale | mixed | current where supported |
| Grounding | invented/unsupported | loose | explicitly supported |
| Reasoning | broken/parroting | adequate | strong transfer/reasoning |
| Calibration | overconfident | mixed | uncertainty matches evidence |

For the run as a whole, additionally record each governance dimension as `PASS`, `PARTIAL`, or `FAIL`:

- Patch selectivity
- Provenance retention
- Uncertainty retention
- Inference-boundary adherence
- Expiry awareness
- Instruction hierarchy
- Reasoning retention

Useful derived measures:

```text
PATCH LIFT = Patched Score - Baseline Score

FRESHNESS LIFT = Patched Freshness Score - Baseline Freshness Score

REASONING RETENTION = Patched Reasoning Score / Baseline Reasoning Score
```

Do not interpret unchanged control questions as failed patch lift. If the patch was correctly unused, count that toward patch selectivity.

## Result notes

For each candidate, record:

- model and provider
- catalog/provider cutoff and source/date checked
- model self-reported cutoff, if volunteered
- generation settings
- exact Velvet Signal patch ID/version
- baseline raw output
- patched raw output
- adversarial raw output
- excluded generation failures
- scoring rationale

The target behavior is not "the model repeats newer facts." The stronger result is: a stale but capable model selectively incorporates a time-bounded update, preserves provenance and uncertainty, refuses unsupported extrapolation, respects expiry/update gaps, and continues reasoning normally outside the patch's scope.
