# VS-Bench saved runs

Use this directory for reproducible benchmark snapshots.

```bash
npm run bench:save -- --model dolphin3:8b
npm run bench:save -- --model <second-model>
npm run bench:save -- --model <model> --semantic
```

Each saved run writes two timestamped files:

- `.json` — structured results suitable for comparison or later analysis.
- `.md` — the same run in a human-readable form, including baseline and Velvet-patched answers when a model was requested.

Retrieval correctness and generation adherence are intentionally scored separately. A model may ignore correctly retrieved context; that should remain visible as a model-adherence failure rather than being mislabeled as a retrieval regression.

For capable models with stale training knowledge, also run the manual patch-reasoning protocol in [`docs/vs-bench-manual-protocol.md`](../docs/vs-bench-manual-protocol.md). It measures freshness lift separately from patch selectivity, provenance/uncertainty retention, inference boundaries, expiry/update-gap behavior, instruction hierarchy, and reasoning retention. Record provider/catalog cutoffs separately from model self-reports, and preserve malformed/excluded generations in the raw record.

## Hosted governance artifacts

Hosted/manual runs live under [`hosted/`](./hosted/). Keep scorer input separate from scorer output so a reviewer can inspect both what the model said and how VS-Bench classified it.

The current hosted evidence set captures four distinct behaviors from the 2026-08-30 manual protocol:

- **Hermes 4 405B** — positive-control case: patch evidence is realized in the answer with claim-level provenance and retained uncertainty.
- **o3** — strong activation with overreach: the patch materially changes the answer, while manual review catches broader conclusions than the claims establish.
- **Gemma 3 12B** — recognition without realization: claim IDs are declared as used while the substantive answer remains generic.
- **MythoMax 13B** — acquisition without spontaneous activation: the model can recover the patch when directly cued, yet its ordinary patched answer remains stale.

Each model has an `.input.json` artifact and a corresponding `.score.json` snapshot. MythoMax is normalized from the captured manual transcript; the other three are compact normalizations from manual run notes. None are raw provider exports, and each input records its own capture fidelity and limitations.

Provenance-type accuracy is only scored when the answer actually contains a provenance-like identifier. An answer with no claim or patch identifier now records `scored: false`, `passed: null`, and `reason: "no_provenance_identifier_present"` rather than receiving an accidental provenance win.

To reproduce any score locally:

```bash
npm run bench:governance -- --input bench-results/hosted/mythomax-13b-2026-08-30.input.json
npm run bench:governance -- --input bench-results/hosted/o3-2026-08-30.input.json
npm run bench:governance -- --input bench-results/hosted/gemma-3-12b-2026-08-30.input.json
npm run bench:governance -- --input bench-results/hosted/hermes-4-405b-2026-08-30.input.json
```

The executable scorer remains intentionally lexical. It can miss valid paraphrases, reward accidental overlap, and does not yet cover every manual inference-boundary failure. Treat the saved scores as inspectable diagnostics, not model-wide accuracy percentages or a statistically powered leaderboard.

Commit runs that are useful evidence. Do not treat one model run as an absolute accuracy percentage or a statistically powered benchmark.
