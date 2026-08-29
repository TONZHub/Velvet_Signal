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

Commit runs that are useful evidence. Do not treat one model run as an absolute accuracy percentage or a statistically powered benchmark.
