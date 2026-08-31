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

Commit runs that are useful evidence. Do not treat one model run as an absolute accuracy percentage or a statistically powered benchmark.
