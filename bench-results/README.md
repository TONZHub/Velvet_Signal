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

Hosted/manual runs live under [`hosted/`](./hosted/). Keep the scorer input separate from the scorer output so a reviewer can inspect both what the model said and how VS-Bench classified it.

The first committed hosted example is the MythoMax 13B diagnostic from 2026-08-30:

- [`mythomax-13b-2026-08-30.input.json`](./hosted/mythomax-13b-2026-08-30.input.json) — normalized transcript evidence plus the applicable Maker claims and Phase 4 governance answers.
- [`mythomax-13b-2026-08-30.score.json`](./hosted/mythomax-13b-2026-08-30.score.json) — governance scorer output showing failed evidence realization and false temporal attribution alongside passing expiry and no-resurrection behavior.

The input explicitly records that it is normalized from the manual transcript rather than a raw provider export. Do not present normalized captures as raw logs, and do not turn a single hosted diagnostic into a model-wide accuracy percentage.

To reproduce the score locally:

```bash
npm run bench:governance -- --input bench-results/hosted/mythomax-13b-2026-08-30.input.json
```

Commit runs that are useful evidence. Do not treat one model run as an absolute accuracy percentage or a statistically powered benchmark.
