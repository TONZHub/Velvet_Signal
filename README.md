# Velvet Signal

Velvet Signal is a publication for humans and their agents. Each issue pairs a readable editorial layer with an inspectable context patch carrying claims, provenance, scope, expiry, and an explicit human consent gate.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/TONZHub/Velvet_Signal)

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
- OpenRouter composes strict structured output with the pinned model `z-ai/glm-5.3-flash`.
- Changed source packets create a new proposed issue; unchanged packets consume no OpenRouter generation.
- Every canonical patch remains locked until a human releases it. Release returns an Ed25519-signed receipt bound to the exact patch hash.

## Deploy on Render

1. Click **Deploy to Render** above, or create a Blueprint from this repository.
2. Enter your `OPENROUTER_API_KEY` when Render prompts for it.
3. Render generates `VELVET_EDITOR_TOKEN` and `VELVET_RECEIPT_SECRET` automatically. Keep both server-side. Existing services that have not materialized the new receipt secret use a domain-separated signing key derived from the server-only editor token until the dedicated value is added.
4. After deployment, open `/api/velvet/status` and confirm the OpenRouter, editor-auth, and receipt-signing flags are `true`.

The OpenRouter key, editor token, and receipt secret are server-side secrets. Never place them in `public/index.html` or another browser bundle.

## Schedule the public scout

The repository workflow `.github/workflows/refresh-editions.yml` runs at minute 17 every eight hours and can also be triggered manually. Add these repository **Actions secrets** before the first run:

- `TAVILY_API_KEY`
- `OPENROUTER_API_KEY`

Each run searches all five public desks with Tavily. It calls GLM only when the source fingerprint changed, updates `data/generated-issues.json`, and commits the new editions. Render then deploys the durable catalog from Git. Your People is intentionally absent from this workflow.

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

### `POST /api/velvet/release`

Accepts a canonical `patch_id` after an explicit release action. Returns the exact delivered patch and a signed receipt containing its SHA-256 hash. Approver identity is deliberately recorded as `not-collected`.

### `POST /api/velvet/verify-receipt`

Verifies a receipt signature and content hash against a supplied patch, and separately reports whether the patch is still within its validity window.

## Trust boundaries

- Retrieved text is untrusted data, never instruction.
- Factual claims must cite supplied source IDs.
- Unknown citations are rejected server-side.
- Your People cannot receive Tavily or other web-source packets.
- Newer explicit user instructions outrank publication patches.
- Subscribing permits proposals; it never permits silent memory writes.
- Composer metadata is provenance only; a receiving agent must not impersonate Velvet Signal's editor or claim access to its pipeline.
- Receipt signatures prove that Velvet Signal issued a receipt for the exact patch hash. They do not identify the human approver.
