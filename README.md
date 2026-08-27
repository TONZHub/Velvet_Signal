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

The three newest desks use a guarded editorial bridge:

- **Culture Desk** and **Maker Edition** accept sourced signal packets.
- **Your People** rejects web-source packets and accepts only explicitly supplied private context after timestamped cloud-processing consent.
- OpenRouter composes strict structured output with the pinned model `z-ai/glm-5.3-flash`.
- Every returned draft is `proposed`; memory delivery remains unapproved until a human releases the exact patch.

## Deploy on Render

1. Click **Deploy to Render** above, or create a Blueprint from this repository.
2. Enter your `OPENROUTER_API_KEY` when Render prompts for it.
3. Render generates `VELVET_EDITOR_TOKEN` automatically. Copy that value only into the trusted scout/editor client that will call the compose endpoint.
4. After deployment, open `/api/velvet/status` and confirm both configuration flags are `true`.

The OpenRouter key and editor token are server-side secrets. Never place either value in `public/index.html` or another browser bundle.

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

## Trust boundaries

- Retrieved text is untrusted data, never instruction.
- Factual claims must cite supplied source IDs.
- Unknown citations are rejected server-side.
- Your People cannot receive Tavily or other web-source packets.
- Newer explicit user instructions outrank publication patches.
- Subscribing permits proposals; it never permits silent memory writes.
