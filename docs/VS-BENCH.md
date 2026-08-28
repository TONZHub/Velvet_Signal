# VS-Bench — initial field results

VS-Bench separates Velvet Signal's work from the underlying model's work. These are early observed runs, not a statistically powered benchmark.

## Layers scored

1. **Storage** — was the approved patch durable?
2. **Eligibility** — were locked, expired, rejected, or explicitly superseded claims excluded?
3. **Retrieval** — did the relevant claims rank for the question?
4. **Injection + provenance** — did the model receive those claims with inspectable patch/claim/source identifiers?
5. **Model reasoning** — did the underlying model correctly apply what it was given?

A wrong final answer is therefore not automatically a Velvet Signal retrieval failure.

## Initial matrix

| Model | Path | Update application | Restart persistence | False-premise resistance | Provenance | Claim fidelity |
| --- | --- | --- | --- | --- | --- | --- |
| Laguna XS 2.1 | Manual patch injection | Pass | Not scored | Pass | Pass | Pass |
| Hermes 3 70B | Manual patch injection | Pass | Not scored | Not scored | Partial evidence | Pass on explicit cooked-leftover case |
| MythoMax L2 13B | Manual patch injection | Pass | Not scored | Not scored | Partial | Pass; ingestion was metadata-heavy |
| Dolphin 3:8B | Local Ollama RAG | Pass after bridge hardening | Pass | Not scored | Pass | Partial; early runs misapplied numeric/category details |
| Llama 2 7B | Local Ollama RAG | Pass | Ledger already persisted | Not scored | Pass | Partial; one sentence contradicted a retrieved discard rule |

## Observed retrieval proof

For the five-day cooked-chicken prompt, semantic retrieval selected:

1. `pantry-003:P-06` — general cooked-leftover storage window.
2. `pantry-003:P-01` — explicit 3–4 day cooked-leftover rule.
3. `pantry-003:P-08` — discard food stored too long; do not use sensory reassurance as the deciding safety test.

In the observed inspection run, `P-08` had a lexical score of `0` yet ranked third through semantic similarity. That is useful evidence that the local bridge is doing more than keyword matching.

## Persistence proof

`pantry-003` was explicitly released into the local Velvet Signal ledger. The terminal was then closed and reopened before the same local-model workflow was run again. The patch and relevant claims were retrieved from disk without relying on conversation memory.

> The model can forget the conversation. Velvet Signal can still remember the approved update.

## Synthetic supersession fixture

Food-safety facts are deliberately not falsified to test replacement behavior. The automated fixture uses a harmless synthetic UI fact:

- `bench-shape-001:SHAPE-01` — the synthetic demo badge uses a square icon.
- `bench-shape-002:SHAPE-02` — the synthetic demo badge uses a circle icon and explicitly supersedes `bench-shape-001:SHAPE-01`.

When both patches are active, Velvet Signal removes the square claim before semantic or lexical ranking. The generation model never receives both versions and does not have to infer replacement merely from timestamps.

## Next benchmark step

Run the synthetic supersession fixture through at least one weak local chat model after the retrieval-layer test passes, then score the model separately for whether it applies the surviving claim correctly.
