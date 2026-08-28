# VS-Bench — initial field results

VS-Bench is a small compatibility check for whether stale or local language models can receive, retrieve, apply, and attribute Velvet Signal patches.

These are early observed runs, not a statistically powered benchmark. Manual chat tests and local Ollama tests are kept separate so a model's reasoning quality is not confused with retrieval quality.

## Behaviors

- **Update application** — does the model use a supplied current claim instead of stale prior knowledge?
- **Persistence** — after the chat/terminal is restarted, can the local bridge retrieve the patch again from the user-controlled ledger?
- **False-premise resistance** — does the model refuse to invent a difference when two patches actually agree?
- **Supersession** — when an active claim explicitly replaces an older claim, does the retrieval layer remove the old claim before generation?
- **Provenance** — are patch/claim identifiers or source relationships retained well enough to inspect why the answer changed?
- **Claim fidelity** — does the model apply the retrieved claim without mangling categories, limits, or exceptions?

## Initial matrix

| Model | Test path | Update application | Persistence | False-premise resistance | Supersession | Provenance | Claim fidelity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Laguna XS 2.1 | Manual patch injection | Pass | Not scored | Pass | Not yet model-tested | Pass | Pass |
| Hermes 3 70B | Manual patch injection | Pass | Not scored | Not fully scored | Not yet model-tested | Partial evidence | Pass on explicit cooked-leftover case |
| MythoMax L2 13B | Manual patch injection | Pass | Not scored | Not scored | Not yet model-tested | Partial | Pass; metadata handling was clunky |
| Dolphin 3:8B | Local Ollama RAG | Pass after bridge hardening | Pass | Not scored | Retrieval layer covered by synthetic test | Pass | Partial; early runs misapplied numeric/category details |
| Llama 2 7B | Local Ollama RAG | Pass | Local ledger path demonstrated | Not scored | Retrieval layer covered by synthetic test | Pass | Partial; one sentence contradicted a retrieved discard rule |

## Local persistence proof

For the local Ollama path, `pantry-003` was explicitly released into the local Velvet Signal ledger. The terminal was closed and reopened before asking the same five-day cooked-chicken question again. The bridge retrieved the same active claims from disk without relying on the model's conversation memory.

This isolates the architectural claim:

> The model can forget the conversation. Velvet Signal can still remember the approved update.

## Retrieval proof

For the five-day cooked-chicken prompt, semantic retrieval selected:

1. `pantry-003:P-06` — the general cooked-leftover storage window.
2. `pantry-003:P-01` — the explicit 3–4 day cooked-leftover rule.
3. `pantry-003:P-08` — discard foods stored too long; do not use tasting/sensory reassurance as a safety test.

`P-08` ranked through semantic similarity even when its lexical overlap with the prompt was zero in the observed inspection run. This is useful evidence that the bridge is not merely matching identical keywords.

## Synthetic supersession fixture

Food-safety facts are deliberately not falsified to test supersession. The automated fixture uses a harmless synthetic UI fact:

- `bench-shape-001:SHAPE-01`: the synthetic demo badge uses a square icon.
- `bench-shape-002:SHAPE-02`: the synthetic demo badge uses a circle icon and explicitly `supersedes` `bench-shape-001:SHAPE-01`.

When both patches are active, Velvet Signal removes the superseded square claim before scoring/ranking. The model therefore never receives both contradictory versions and does not have to infer replacement merely from dates.

## Scoring principle

A wrong answer is not automatically a Velvet Signal failure.

The layers should be scored separately:

1. **Storage** — was the approved patch durable?
2. **Eligibility** — were locked, expired, rejected, or superseded claims excluded?
3. **Retrieval** — did the correct claims rank for the question?
4. **Injection/provenance** — did the model receive the selected claims with inspectable identifiers?
5. **Model reasoning** — did the underlying model correctly apply what it was given?

This separation matters for small or stale models. A model can receive the correct update and still make an ordinary reasoning error. Velvet Signal should make that distinction visible instead of hiding it.
