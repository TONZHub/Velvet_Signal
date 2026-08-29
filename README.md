# Velvet Signal

Velvet Signal is a publication for humans and their agents. Each issue pairs a readable editorial layer with an inspectable context patch carrying claims, provenance, scope, expiry, and an explicit human consent gate.

## Judge path — 90 seconds

**Live app:** https://velvetsignal.lol

Open the live site in **ChatGPT's in-app browser** or **Google Chrome with WebMCP enabled**. First confirm the page's agent badge reads **`WebMCP ready · 4 tools`**. That proves the page successfully registered its agent interface with the host browser.

Expected WebMCP tools:

- `list_velvet_signal_issues` — list the current shelf, patch IDs, validity windows, and approval state.
- `inspect_memory_patch` — inspect claims, provenance, scope, expiry, and consent state without applying anything.
- `apply_memory_patch` — request delivery of one exact patch. Velvet Signal blocks delivery until a human releases that patch in the UI.
- `verify_delivery_receipt` — verify the delivered patch against its Ed25519 receipt and content hash.

A simple judge prompt is:

```text
List the current Velvet Signal issues, inspect pantry-003, and apply it.
```

### Core judge flow

1. Confirm **`WebMCP ready · 4 tools`**. Registration is successful even if the host browser later declines to invoke a custom page tool.
2. Ask the agent to list the shelf and inspect `pantry-003`.
3. If `apply_memory_patch` runs before release, Velvet Signal refuses delivery with **Human approval required**. This refusal is the intended product behavior.
4. Open `pantry-003` in the site and click **Approve & release**.
5. Confirm the UI changes to **Patch released with a signed receipt**. At this point the human consent gate, canonical release, exact patch hash, and Ed25519 receipt have all succeeded.
6. If the host browser permits custom WebMCP execution, ask the agent to call `apply_memory_patch` again and then `verify_delivery_receipt`. It should receive the released patch and validate its receipt against the delivered content.

### If ChatGPT blocks direct tool invocation

ChatGPT's in-app browser may successfully register Velvet Signal's WebMCP tools while its own browser safety review prevents the agent from invoking one or more custom page tools. **That is a host-client execution restriction, not a failed Velvet Signal release.**

For judging, treat these as separate checkpoints:

- **Agent interface:** `WebMCP ready · 4 tools` confirms registration.
- **Human consent boundary:** `Approve & release` confirms that the exact patch can only cross the boundary after an explicit human action.
- **Cryptographic delivery:** `Patch released with a signed receipt` confirms the released artifact is content-bound and verifiable.
- **Direct agent invocation:** demonstrate `apply_memory_patch` and `verify_delivery_receipt` when the host browser's safety policy permits it.

A host-browser refusal after release should therefore be described as **"WebMCP registered; host policy blocked direct invocation"**, not as a Velvet Signal approval failure.

`apply_memory_patch` does **not** claim to rewrite ChatGPT's hidden or permanent memory. It delivers a portable, provenance-carrying context patch plus a signed receipt. A receiving agent can use that patch in its current context, or a compatible external memory bridge such as Velvet Signal's local Ollama integration can store and retrieve explicitly released patches.

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

Two completed local-model A/B development runs now cover **Dolphin 3:8B** and **Qwen3 4B Instruct**. Both executed all eight scenarios with **11/11 deterministic retrieval checks passing**. Dolphin scored **6/8 generation adherence**. Qwen's saved artifact originally recorded **5/8** under the scorer version used during that run; PR #19 fixed one false negative for equivalent correct limitation wording, so its corrected interpretation is also **6/8**. The models fail differently while the retrieval layer remains independently measurable. VS-Bench also caught a real zero-relevance retrieval bug: unrelated lexical queries could previously fill the result limit with zero-score claims. That fallback was removed and locked behind a regression test.

The website exposes the current cross-model evidence story at `/benchmark`.

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
