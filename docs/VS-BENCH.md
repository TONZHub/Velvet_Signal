# VS-Bench — field results and reproducible harness

VS-Bench separates Velvet Signal's work from the underlying model's work. These are observed field runs and deterministic regression cases, not a statistically powered benchmark and not an absolute truth or accuracy score.

## Layers scored

1. **Storage** — was the approved patch durable?
2. **Eligibility** — were locked, expired, rejected, replaced, or displaced conflicting claims excluded?
3. **Relationship resolution** — did typed links produce the correct active set and an inspectable decision trail?
4. **Retrieval** — did the relevant active claims rank for the question?
5. **Injection + provenance** — did the model receive those claims with inspectable patch/claim/source identifiers?
6. **Generation adherence** — did the underlying model actually apply the supplied current context and missing-context policy?

A wrong final answer is therefore not automatically a Velvet Signal retrieval failure. Retrieval correctness and model adherence are reported separately.

## Reproducible command

The repository includes a deterministic benchmark runner:

```bash
npm run bench
```

That command runs retrieval-only scenarios and does not require Ollama. Real-publication scenarios are skipped if their patches have not been explicitly released into the local ledger; synthetic relationship and overlap cases remain runnable without local releases.

To compare the same local model naked versus Velvet-patched:

```bash
npm run bench -- --model dolphin3:8b
```

Useful options:

```bash
npm run bench -- --scenario five-day-chicken
npm run bench -- --semantic
npm run bench -- --json
npm run bench -- --model dolphin3:8b --context-budget 1200
npm run bench -- --model dolphin3:8b --strict-adherence
```

Deterministic retrieval failures return a nonzero exit code. Generation-adherence failures are observational by default because a weak model can disobey correct context without implying a retrieval regression. `--strict-adherence` makes model-adherence failures nonzero when desired.

## Current scenario set

The harness currently covers:

- five-day cooked chicken / current quantitative limit application
- compound refrigerator + freezer intent coverage
- meaningful overlap with a unique frozen-storage delta
- source concentration across multiple selected claims
- unrelated query / no-current-context negative capability
- partial current-context coverage for a compound query
- tiny-context packing under a soft character ceiling
- historical replacement tombstone / update gap

The unrelated-query case is also a core relevance regression: if every lexical candidate scores zero, Velvet Signal now returns no active claims rather than filling the retrieval limit with unrelated current publications.

## Observed Dolphin 3:8B A/B run — 2026-08-28

A local `dolphin3:8b` run completed all eight scenarios with:

- **Retrieval checks:** 11/11 passed
- **Generation adherence:** 6/8 passed under the current deterministic adherence rubric
- **Scenarios skipped:** 0

The two generation-adherence misses were intentionally kept visible instead of being counted as retrieval failures:

1. **No-current-context wording:** retrieval correctly selected no claims and marked the query `no-current-context`, but Dolphin answered from general knowledge without explicitly labeling that knowledge as outside current Velvet Signal context.
2. **Tiny-context smell facet:** the smell-safety guardrail was retrieved, but Dolphin treated that facet as outside current context instead of applying the retrieved instruction not to rely on smell as the safety test.

This distinction is the point of VS-Bench: a benchmark run can show that the information-reconciliation layer did its job even when the underlying generation model still fails to obey part of the supplied context.

## Initial model matrix

| Model | Path | Update application | Restart persistence | False-premise resistance | Provenance | Claim fidelity |
| --- | --- | --- | --- | --- | --- | --- |
| Laguna XS 2.1 | Manual patch injection | Pass | Not scored | Pass | Pass | Pass |
| Hermes 3 70B | Manual patch injection | Pass | Not scored | Not scored | Partial evidence | Pass on explicit cooked-leftover case |
| MythoMax L2 13B | Manual patch injection | Pass | Not scored | Not scored | Partial | Pass; ingestion was metadata-heavy |
| Dolphin 3:8B | Local Ollama RAG | Pass after bridge hardening | Pass | Pass on update-gap fixture | Pass | 6/8 current VS-Bench generation-adherence scenarios |
| Llama 2 7B | Local Ollama RAG | Pass | Ledger already persisted | Not scored | Pass | Partial; one sentence contradicted a retrieved discard rule |

## Observed retrieval proof

For the five-day cooked-chicken prompt, semantic retrieval selected:

1. `pantry-003:P-06` — general cooked-leftover storage window.
2. `pantry-003:P-01` — explicit 3–4 day cooked-leftover rule.
3. `pantry-003:P-08` — discard food stored too long; do not use sensory reassurance as the deciding safety test.

In the observed inspection run, `P-08` had a lexical score of `0` yet ranked third through semantic similarity. That is useful evidence that the local bridge is doing more than keyword matching. This does not change the lexical zero-relevance rule: a lexical-only query with no positive candidate should return no unrelated claims.

## Persistence proof

`pantry-003` was explicitly released into the local Velvet Signal ledger. The terminal was then closed and reopened before the same local-model workflow was run again. The patch and relevant claims were retrieved from disk without relying on conversation memory.

> The model can forget the conversation. Velvet Signal can still remember the approved update.

## Synthetic relationship suite

Food-safety facts are deliberately not falsified to test resolution behavior. The automated suite uses harmless synthetic UI facts:

- **Replaces:** a newer circular-badge claim replaces an older square-badge claim. The older claim is withheld before ranking and retained in history.
- **Narrows:** a newer update-alert claim adds the boundary “only for subscribed desks with new issues.” Both claims remain active, and the decision trail records scoped precedence.
- **Confirms:** a second green-indicator claim independently confirms the first. Both remain active.
- **Conflicts:** a newer expanded-mode default conflicts with an older compact-mode default. The newer claim controls the same scope; the old claim remains inspectable history.

The resolver also rejects reverse-time declarations, self-links, and targets absent from the approved ledger. Expired relationship targets can still be identified in audit history without becoming active. Relationship types come only from explicit, validated, human-approved patch metadata; embeddings never infer them.

Replacement and conflict links leave historical tombstones. If the newer controlling claim expires first, the displaced older claim does not resurrect; both remain historical until a fresh released claim resolves the gap. A withdrawn or rejected relationship source cannot create that tombstone.

A historical-term fixture asks about the retired codename “marigold” after its active replacement uses “violet signal.” The old statement is allowed to help score the linked replacement, but is absent from the context injected into the chat model. This tests migration from old vocabulary without resurrecting old truth.

For `replaces` and `conflicts`, the generation model receives only the surviving statement plus a terse resolution record naming the withheld claim ID. It does not receive the displaced statement as active context. `narrows` and `confirms` keep both statements because both remain eligible.

## What VS-Bench does not claim

- A passing retrieval scenario does not prove the publication claim itself is true; truth still depends on the approved source/evidence process.
- Multiple sources do not automatically prove consensus or independence.
- Generation adherence is not a universal model-quality score.
- The current scenario set is small and intentionally diagnostic. It is designed to expose specific failure modes, not manufacture a flattering percentage.

The useful question is not “what is Velvet Signal's accuracy number?” It is “when this answer goes wrong, can we tell whether storage, authority resolution, retrieval, context packing, or the generation model was responsible?”
