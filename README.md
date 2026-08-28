# Velvet Signal

Velvet Signal is a publication for humans and their agents. Each issue pairs a readable editorial layer with an inspectable context patch carrying claims, provenance, scope, expiry, and an explicit human consent gate.

## How to install Velvet Signal on your laptop

This setup gives a local Ollama model access to Velvet Signal's user-approved memory patches. Your local prompts stay on your machine; Velvet Signal only contacts the hosted publication when you explicitly release a public patch into your local store.

### What you need

Before installing Velvet Signal, install:

1. **Git** — used to download and update Velvet Signal.
2. **Node.js 22 or newer** — includes `npm`, which runs Velvet Signal.
3. **Ollama** — runs the local language model and embedding model.

On Windows, you can install Node.js from PowerShell with:

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell afterward, then check:

```powershell
node -v
npm.cmd -v
ollama --version
git --version
```

If each command prints a version number, you are ready.

> **Windows note:** PowerShell may block `npm.ps1` with a message saying that running scripts is disabled. You do not need to change your security settings. Use `npm.cmd` instead of `npm` in the commands below.

### 1. Download Velvet Signal

Open PowerShell or a terminal in your user folder. On Windows:

```powershell
cd $HOME
git clone https://github.com/TONZHub/Velvet_Signal.git
cd Velvet_Signal
```

On macOS or Linux, the same Git commands work from your home folder:

```bash
cd ~
git clone https://github.com/TONZHub/Velvet_Signal.git
cd Velvet_Signal
```

During development of the local memory bridge, switch to the preview branch:

```bash
git switch codex/local-rag-ollama
```

Once that branch is merged into `main`, this step can be skipped.

### 2. Install Velvet Signal's Node dependencies

**Windows PowerShell:**

```powershell
npm.cmd install
```

**macOS/Linux:**

```bash
npm install
```

Make sure you run this command from inside the `Velvet_Signal` folder. If npm says it cannot find `package.json`, run:

```powershell
cd $HOME\Velvet_Signal
```

If npm tries to write to `C:\Windows\System32`, you are in the wrong folder. Do not run the setup from System32 and do not run it as Administrator; return to your user folder and enter `Velvet_Signal` first.

### 3. Install the local embedding model

Velvet Signal uses a small local embedding model to decide which claims are relevant to a question:

```bash
ollama pull embeddinggemma
```

Then make sure you have a local chat model. For example:

```bash
ollama pull dolphin3:8b
```

You can see your installed Ollama models with:

```bash
ollama list
```

### 4. Release a Velvet Signal patch into local memory

A patch is not silently written into memory. You explicitly choose which released patches your local installation stores.

On Windows:

```powershell
npm.cmd run local -- release pantry-003
npm.cmd run local -- list
```

On macOS/Linux:

```bash
npm run local -- release pantry-003
npm run local -- list
```

By default, released patches are stored at:

```text
~/.velvet-signal/patches.json
```

That file survives terminal, Ollama, and computer restarts. The language model itself does not need persistent memory; Velvet Signal retrieves the relevant active claims again whenever you ask a question.

### 5. Check what Velvet Signal remembers

Before involving a chat model, inspect the retrieval result directly.

**Windows:**

```powershell
npm.cmd run local -- inspect "I cooked chicken five days ago and kept it refrigerated. It smells fine. Can I eat it?"
```

**macOS/Linux:**

```bash
npm run local -- inspect "I cooked chicken five days ago and kept it refrigerated. It smells fine. Can I eat it?"
```

The output should show relevant claims from `pantry-003`, including their patch IDs, claim IDs, sources, validity dates, and retrieval scores.

### 6. Ask your local model using Velvet Signal memory

Replace `dolphin3:8b` with any Ollama chat model you have installed.

**Windows:**

```powershell
npm.cmd run local -- ask --model dolphin3:8b "I cooked chicken five days ago and kept it refrigerated. It smells fine. Can I eat it?"
```

**macOS/Linux:**

```bash
npm run local -- ask --model dolphin3:8b "I cooked chicken five days ago and kept it refrigerated. It smells fine. Can I eat it?"
```

Velvet Signal will retrieve the most relevant active claims, attach their provenance, and give that context to the local model for the current turn.

### Updating Velvet Signal later

Return to the repository folder and pull the newest code:

```bash
cd ~/Velvet_Signal
git pull
```

On Windows PowerShell, this also works:

```powershell
cd $HOME\Velvet_Signal
git pull
```

Your locally released patch ledger is stored outside the repository, so updating the code does not erase it.

### Common Windows problems

**`npm` is not recognized**  
Install Node.js, close PowerShell, reopen it, then try `npm.cmd -v`.

**`npm.ps1 cannot be loaded because running scripts is disabled`**  
Use `npm.cmd` instead of `npm`.

**`EPERM ... C:\Windows\System32\package-lock.json`**  
You are running npm from System32. Run `cd $HOME\Velvet_Signal` first.

**`ENOENT ... C:\Users\<you>\package.json`**  
You are in your user folder instead of the repository. Run `cd $HOME\Velvet_Signal` first.

**Ollama cannot find the model**  
Run `ollama list`, then `ollama pull <model-name>` for the model you want to use.

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

Only delivered, approved, unexpired patches participate in retrieval. Expired patches remain in the local ledger for provenance but are not injected as active context. Local questions and conversation text are sent only to the configured Ollama server; the hosted Velvet Signal service is contacted only when the user explicitly runs `release` to fetch a public patch and its receipt.

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
- Your People cannot receive Tavily or other web-source packets.
- Newer explicit user instructions outrank publication patches.
- Subscribing permits proposals; it never permits silent memory writes.
- Composer metadata is provenance only; a receiving agent must not impersonate Velvet Signal's editor or claim access to its pipeline.
- Receipt signatures prove that Velvet Signal issued a receipt for the exact patch hash. They do not identify the human approver.
