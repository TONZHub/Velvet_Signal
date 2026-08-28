# VS-Bench — initial field results

VS-Bench separates Velvet Signal's work from the underlying model's work. These are early observed runs, not a statistically powered benchmark.

## Layers scored

1. **Storage** — was the approved patch durable?
2. **Eligibility** — were locked, expired, rejected, replaced, or displaced conflicting claims excluded?
3. **Relationship resolution** — did typed links produce the correct active set and an inspectable decision trail?
4. **Retrieval** — did the relevant active claims rank for the question?
5. **Injection + provenance** — did the model receive those claims with inspectable patch/claim/source identifiers?
6. **Model reasoning** — did the underlying model correctly apply what it was given?

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

## Next benchmark step

Run all four synthetic relationship cases through at least one weak local chat model after the deterministic resolver tests pass. Score separately whether the model applies replacement, scoped narrowing, confirmation, and conflict without turning the audit trail itself into a factual source.
