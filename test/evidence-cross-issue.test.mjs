import assert from "node:assert/strict";
import test from "node:test";
import { evidenceReport } from "../src/evidence-aware-rag.mjs";

function claim(patchId, claimId, sourceId, url) {
  return {
    id: `${patchId}:${claimId}`,
    patch_id: patchId,
    claim_id: claimId,
    desk: "VS-Bench",
    title: "Cross-issue evidence fixture",
    scope: "Synthetic provenance",
    published_at: "2026-08-28T12:00:00.000Z",
    valid_until: "2027-08-28",
    statement: `Synthetic claim ${claimId}`,
    relationships: [],
    source_ids: [sourceId],
    sources: [
      {
        id: sourceId,
        name: "Same upstream article",
        publisher: "example.test",
        url,
      },
    ],
  };
}

test("different issue-local source IDs do not make one upstream URL look like independent evidence", () => {
  const report = evidenceReport([
    claim(
      "issue-one",
      "A",
      "ONE-SRC-7",
      "https://www.example.test/report?utm_source=first",
    ),
    claim(
      "issue-two",
      "B",
      "TWO-SRC-2",
      "https://example.test/report?utm_medium=second#summary",
    ),
  ]);

  assert.equal(report.distinct_evidence_count, 1);
  assert.equal(report.shared_evidence_group_count, 1);
  assert.equal(report.max_claims_on_one_evidence, 2);
  assert.equal(report.status, "single-evidence-lineage");
  assert.deepEqual(
    report.bundles[0].supports.sort(),
    ["issue-one:A", "issue-two:B"],
  );
});
