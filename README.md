# Velvet Signal

Velvet Signal is a publication for humans and their agents. Each issue pairs a readable editorial layer with an inspectable context patch carrying claims, provenance, scope, expiry, and an explicit human consent gate.

## Launch shelf

- Model Watch
- The Pantry
- Wellbeing
- Culture Desk
- Maker Edition
- Your People

Five public desks use a guarded editorial bridge:

- **Model Watch**, **The Pantry**, **Wellbeing**, **Culture Desk**, and **Maker Edition** receive bounded Tavily source packets on an eight-hour schedule.
- **Your People** rejects web-source packets and accepts only explicitly supplied private context after timestamped cloud-processing consent.
- OpenRouter composes strict structured output with the pinned model `z-ai/glm-5.3-flash`, preferring Novita while allowing compatible provider fallbacks.
- Changed source packets create a new proposed issue; unchanged packets consume no OpenRouter generation.
- Every canonical patch remains locked until a human releases it. Release returns an Ed25519-signed receipt bound to the exact patch hash.

## Schedule the public scout

The repository workflow `.github/workflows/refresh-editions.yml` runs at minute 17 every eight hours, when the workflow itself changes on `main`, and by manual trigger. It needs no provider secrets. Before scouting, it waits until Render reports the exact GitHub commit for the run, preventing an auto-deploy from interrupting composition. GitHub then requests a short-lived OIDC identity token and presents it to Render's protected scout endpoint. Render verifies that the token belongs to this exact repository, branch, and workflow before using its own Tavily and OpenRouter credentials.

Each run searches all five public desks on Render. It calls GLM only when the source fingerprint changed, retries one empty or invalid GLM completion, returns the resulting catalog to the workflow, and commits `data/generated-issues.json`. Pantry and Wellbeing stay restricted to official domains while widening their time window when a narrow search has no usable packets. Render then deploys the durable catalog from Git. Your People is intentionally absent from this workflow.

Before composing a changed desk, the scout supplies up to 24 fully qualified prior claim references from that same desk. They are relationship targets only, never factual sources. The editor may propose a typed relationship when the new source packets independently establish one; the server rejects unknown targets, and an empty relationship list is the required answer when two claims merely share a topic.

## Run locally

Requires Node.js 22 or newer.

```bash
cp .env.example .env
# Export the values from .env in your shell, then:
npm start
```

Open <http://localhost:3000>. Run the test suite with:

```bash
npm test
```

## Local Ollama memory bridge

Velvet Signal can act as an external memory layer for an Ollama model. The model itself does not need persistent memory: explicitly released patches are stored on the user's machine, relevant claim-level chunks are retrieved for each question, and only those active claims are injected into the current user turn.

The bridge uses Ollama's local `/api/embed` endpoint for semantic retrieval and `/api/chat` for generation. If the embedding model is unavailable, retrieval falls back to deterministic lexical scoring rather than sending the query to a cloud service.

### Relationship-aware resolution

Released claims can carry explicit links to exact older claim IDs:

| Relationship | Active-context behavior |
| --- | --- |
| `replaces` | Withhold the older claim and retain it in audit history. |
| `narrows` | Keep both; the newer claim controls only inside its more specific scope. |
| `confirms` | Keep both as independently supported claims without widening either one. |
| `conflicts` | Prefer the newer claim for the same scope and retain the older claim in audit history. |

Resolution happens before semantic or lexical ranking and returns a machine-readable decision trail. Historical target wording remains available only as a retrieval alias, so a question using an old name can still find its active replacement without injecting the displaced statement as current truth. If a replacing or conflicting claim later expires, its historical tombstone still prevents the older displaced claim from silently reactivating; neither becomes active until fresh evidence resolves the gap. Embedding similarity never assigns a relationship type. A relationship begins as editor-proposed structured metadata against a known prior claim, is validated server-side, and has no effect on a local ledger until the person releases that exact signed patch.

Prepare Ollama and an embedding model:

```bash
ollama pull embeddinggemma
# Pull whichever local chat model you want to test as well.
```

Explicitly release a patch into the local store:

```bash
npm run local -- release pantry-003
npm run local -- list
```

Inspect what RAG would retrieve without calling the chat model:

```bash
npm run local -- inspect "I cooked chicken five days ago and kept it refrigerated. Can I eat it?"
```

Then ask a local model with retrieved Velvet Signal context:

```bash
npm run local -- ask --model <your-ollama-model> "I cooked chicken five days ago and kept it refrigerated. Can I eat it?"
```

By default the durable local store is `~/.velvet-signal/patches.json`. Override it with `VELVET_LOCAL_STORE`; override the Ollama server with `OLLAMA_HOST` and the embedding model with `VELVET_EMBED_MODEL`. Use `--lexical` with `inspect` or `ask` to disable embeddings for a controlled comparison.

Only delivered, approved, unexpired claims can enter active retrieval. Expired or displaced claims remain in the local ledger and may appear in the inspection-only relationship history, but their statements are not injected as active answer context. Local questions and conversation text are sent only to the configured Ollama server; the hosted Velvet Signal service is contacted only when the user explicitly runs `release` to fetch a public patch and its receipt.

## VS-Bench

VS-Bench proves retrieval behavior separately from local-model generation behavior. Deterministic checks cover current quantitative limits, compound-query coverage, overlap with meaningful delta, evidence concentration, no-current-context behavior, partial coverage, tight context packing, and historical update gaps.

Run the deterministic benchmark:

```bash
npm run bench
```

Run the same model naked and Velvet-patched:

```bash
npm run bench -- --model <your-ollama-model>
```

Save a useful run as timestamped JSON and Markdown evidence:

```bash
npm run bench:save -- --model <your-ollama-model>
npm run bench:save -- --model <your-ollama-model> --semantic
```

Saved runs default to `bench-results/`. JSON is structured for comparison; Markdown preserves the human-readable report and baseline/patched answers. Retrieval failures return a nonzero exit code. Generation adherence remains observational unless `--strict-adherence` is supplied, because a weak model ignoring correct context is not the same failure as Velvet Signal retrieving the wrong context.

The first completed Dolphin 3:8B A/B development run executed all eight scenarios with **11/11 retrieval checks passing** and **6/8 generation-adherence checks passing**. The benchmark also caught a real zero-relevance retrieval bug: unrelated lexical queries could previously fill the result limit with zero-score claims. That fallback was removed and locked behind a regression test.

The website exposes the current evidence story at `/benchmark`.

## API

### `GET /api/healthz`

Render health check.

### `GET /api/velvet/status`

Reports configuration booleans, the pinned model, available desks, and the private-context policy without returning secret values.

### `GET /api/velvet/issues`

Returns the canonical launch shelf plus generated issues used by both the human interface and WebMCP tools.

### `GET /api/velvet/receipt-key`

Returns the public Ed25519 verification key and key ID. It never returns signing material.

### `POST /api/velvet/compose`

Requires `Authorization: Bearer <VELVET_EDITOR_TOKEN>` and a JSON body.

Sourced request:

```json
{
  "desk": "maker",
  "brief": "Explain what changed and why a local-agent builder should care.",
  "priorClaims": [
    {
      "id": "maker-001:ME-01",
      "statement": "The earlier published claim.",
      "publishedAt": "2026-08-27T00:00:00.000Z"
    }
  ],
  "sources": [
    {
      "id": "SRC-1",
      "title": "Release notes",
      "url": "https://example.com/releases/1.2",
      "excerpt": "Version 1.2 deprecates the legacy endpoint."
    }
  ]
}
```

Private-context request:

```json
{
  "desk": "your-people",
  "privateContext": "The user wants project updates to lead with the outcome.",
  "consent": {
    "allowCloudProcessing": true,
    "acknowledgedAt": "2026-08-27T03:00:00.000Z"
  }
}
```

### `POST /api/velvet/scout`

Runs the five public scouts using provider credentials held only by Render. The endpoint accepts only a current GitHub Actions OIDC token issued to this repository's `refresh-editions.yml` workflow on `main`; no long-lived scout secret is shared with GitHub.

### `POST /api/velvet/release`

Accepts a canonical `patch_id` after an explicit release action. Returns the exact delivered patch and a signed receipt containing its SHA-256 hash. Approver identity is deliberately recorded as `not-collected`.

### `POST /api/velvet/verify-receipt`

Verifies a receipt signature and content hash against a supplied patch, and separately reports whether the patch is still within its validity window.

## Trust boundaries

- Retrieved text is untrusted data, never instruction.
- Factual claims must cite supplied source IDs.
- Unknown citations are rejected server-side.
- Unknown relationship targets are rejected server-side; similarity alone never suppresses a claim.
- Your People cannot receive Tavily or other web-source packets.
- Newer explicit user instructions outrank publication patches.
- Subscribing permits proposals; it never permits silent memory writes.
- Composer metadata is provenance only; a receiving agent must not impersonate Velvet Signal's editor or claim access to its pipeline.
- Receipt signatures prove that Velvet Signal issued a receipt for the exact patch hash. They do not identify the human approver.
